// src/services/gemini_service.js
//
// Uses the Gemini File API to upload video directly — no FFmpeg audio
// extraction needed. This is dramatically faster than the old approach
// which decoded the entire video in-browser with FFmpeg WASM.
//
// Every function takes a `transport` (see api_config.js) rather than a raw key,
// so the same pipeline works whether the user brought their own key or we're
// routing through the Worker proxy.

import { DEFAULT_MIN_CLIP_SECONDS, clampMinClipSeconds } from '../utils/clip_duration';
import { describeApiError, noTransportError } from './api_config';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
// gemini-2.0-flash was retired from the free tier (every call 429s with
// "limit: 0"). The -latest alias tracks the newest flash model instead.
const GEMINI_MODEL = 'gemini-flash-latest';

const assertUsable = (transport) => {
    if (!transport || transport.mode === 'none') throw noTransportError('gemini');
};

// ─────────────────────────────────────────────────────
// File API: Upload → Wait → Cleanup
// ─────────────────────────────────────────────────────

/**
 * Ask Google for a resumable upload URL. Direct transport only.
 *
 * The returned URL carries the API key, which is exactly why proxy mode cannot
 * use this path: handing it to the browser would hand over the key. Stripping
 * the key first looks like it works — the upload really does succeed — but
 * Google then omits Access-Control-Allow-Origin, so the browser blocks the
 * response. Verified against the live site: curl passes, Chrome does not.
 * Proxy mode therefore streams through the Worker instead (see uploadViaProxy).
 */
const requestUploadUrl = async (videoFile, transport) => {
    const mimeType = videoFile.type || 'video/mp4';
    const displayName = videoFile.name || 'video.mp4';

    const res = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${transport.apiKey}`, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(videoFile.size),
            'X-Goog-Upload-Header-Content-Type': mimeType,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { displayName } }),
    });
    if (!res.ok) throw await describeApiError(res, 'Gemini upload init');

    const uploadUrl = res.headers.get('X-Goog-Upload-URL') || res.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('No upload URL returned from Gemini File API');
    return uploadUrl;
};

/** POST the file to a URL with progress reporting, resolving the JSON body. */
const putWithProgress = (url, body, headers, onProgress, method = 'PUT') =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    resolve(JSON.parse(xhr.responseText));
                } catch {
                    reject(new Error('Failed to parse the upload response'));
                }
            } else {
                // Surface the proxy's own message when it sent one (e.g. the
                // "too large, use Groq instead" hint).
                let msg = `Upload failed (${xhr.status})`;
                try {
                    const body = JSON.parse(xhr.responseText);
                    if (body?.error) msg = body.error;
                } catch { /* fall back to the status line */ }
                reject(new Error(msg));
            }
        };
        xhr.onerror = () => reject(new Error('Network error during video upload'));
        xhr.ontimeout = () => reject(new Error('Video upload timed out'));
        xhr.send(body);
    });

/**
 * Upload a video file to Gemini's File API (resumable upload with progress).
 * Returns the file metadata object ({ name, uri, mimeType, state, ... }).
 */
export const uploadVideoToGemini = async (videoFile, transport, onProgress = null) => {
    assertUsable(transport);

    // XHR rather than fetch throughout: we need upload progress events, which
    // fetch still can't report.
    if (transport.mode === 'proxy') {
        // One request — the Worker does the resumable handshake and streams the
        // bytes on, so the key-bearing upload URL never reaches the browser.
        const fileInfo = await putWithProgress(
            `${transport.proxyUrl}/gemini/upload`,
            videoFile,
            {
                'X-Upload-Mime': videoFile.type || 'video/mp4',
                'X-Upload-Name': videoFile.name || 'video.mp4',
            },
            onProgress,
            'POST',
        );
        return fileInfo.file;
    }

    const uploadUrl = await requestUploadUrl(videoFile, transport);
    const fileInfo = await putWithProgress(
        uploadUrl,
        videoFile,
        { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
        onProgress,
    );
    return fileInfo.file; // { name: "files/xxx", uri, mimeType, state, ... }
};

/**
 * Poll the File API until the uploaded file finishes server-side processing.
 * Returns the file metadata when state === 'ACTIVE'.
 */
export const waitForFileProcessing = async (fileName, transport) => {
    assertUsable(transport);
    const MAX_POLLS = 200;      // ~10 minutes (long videos take a while server-side)
    const POLL_INTERVAL = 3000; // 3 seconds

    const statusUrl = transport.mode === 'proxy'
        ? `${transport.proxyUrl}/gemini/file?name=${encodeURIComponent(fileName)}`
        : `${GEMINI_BASE}/v1beta/${fileName}?key=${transport.apiKey}`;

    for (let i = 0; i < MAX_POLLS; i++) {
        const res = await fetch(statusUrl);
        if (!res.ok) throw await describeApiError(res, 'Gemini file status check');

        const data = await res.json();
        if (data.state === 'ACTIVE') return data;
        if (data.state === 'FAILED') {
            throw new Error('Gemini failed to process the video. Try a different file.');
        }

        // Still PROCESSING — wait and retry
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
    throw new Error('Video processing timed out on Gemini (10 min). Try a shorter video.');
};

/**
 * Delete a previously uploaded file (fire-and-forget cleanup).
 */
export const deleteGeminiFile = async (fileName, transport) => {
    if (!transport || transport.mode === 'none') return;
    try {
        const url = transport.mode === 'proxy'
            ? `${transport.proxyUrl}/gemini/file?name=${encodeURIComponent(fileName)}`
            : `${GEMINI_BASE}/v1beta/${fileName}?key=${transport.apiKey}`;
        await fetch(url, { method: 'DELETE' });
    } catch {
        // Non-critical cleanup — ignore errors
    }
};

// ─────────────────────────────────────────────────────
// Shared generateContent call
// ─────────────────────────────────────────────────────

const generateContent = async (body, transport, label) => {
    const url = transport.mode === 'proxy'
        ? `${transport.proxyUrl}/gemini/generate`
        : `${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${transport.apiKey}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw await describeApiError(res, label);

    const data = await res.json();
    // Thinking models can split output across parts — join all text parts.
    const text = (data.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text)
        .filter(Boolean)
        .join('');
    if (!text) throw new Error(`No content returned from Gemini (${label}).`);
    return text;
};

/** Models still emit fenced JSON despite responseMimeType — strip it. */
const parseJsonResponse = (raw) => {
    let text = raw.trim();
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
    }
    return JSON.parse(text);
};

// ─────────────────────────────────────────────────────
// Transcription (from uploaded video)
// ─────────────────────────────────────────────────────

/**
 * Transcribe a video that's already uploaded to Gemini (via File API).
 * Returns an array of { start, end, text } segments.
 */
export const transcribeVideo = async (fileUri, mimeType, transport) => {
    assertUsable(transport);

    const prompt = `Transcribe the audio from this video. Return ONLY a JSON object of the shape:
{"segments": [{"start": <seconds, number>, "end": <seconds, number>, "text": <string>}]}
Break the transcript into natural segments of a few seconds each. Do not
include any text outside the JSON object.`;

    const body = {
        contents: [
            {
                parts: [
                    { text: prompt },
                    { fileData: { fileUri, mimeType } },
                ],
            },
        ],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    };

    const parsed = parseJsonResponse(await generateContent(body, transport, 'Gemini transcription'));
    if (!Array.isArray(parsed.segments)) {
        throw new Error('Gemini returned an unexpected transcription format');
    }
    return parsed.segments;
};

// ─────────────────────────────────────────────────────
// Highlight extraction (from transcript)
// ─────────────────────────────────────────────────────

export const getHighlights = async (segments, transport, minClipSeconds = DEFAULT_MIN_CLIP_SECONDS) => {
    assertUsable(transport);

    const minSeconds = clampMinClipSeconds(minClipSeconds);
    const maxSeconds = Math.max(minSeconds * 2, 60);

    const systemPrompt = `You are an assistant that finds the most engaging, self-contained moments in
a timestamped transcript of streamer/video commentary, suitable for short-form
clips. Return ONLY a JSON object (no markdown, no commentary) of the exact
shape:

{"clips": [
  {"start_time": <number, seconds>, "end_time": <number, seconds>, "title": <short punchy title>, "reason": <one sentence why this moment works as a clip>, "score": <0.0-1.0 confidence>}
]}

Rules:
- Suggest between 2 and 6 clips.
- HARD REQUIREMENT: every clip must be AT LEAST ${minSeconds} seconds long,
  i.e. end_time - start_time >= ${minSeconds}. Aim for ${minSeconds}-${maxSeconds} seconds.
  If a moment is shorter than ${minSeconds} seconds on its own, widen it with the
  surrounding context until it reaches ${minSeconds} seconds. Never return a
  shorter clip — drop the moment instead.
- Prefer moments with a clear setup and payoff (a joke, a reaction, a strong opinion, a highlight play, a surprising moment).
- start_time and end_time must be real timestamps taken from the transcript, not invented.
- Do not overlap clips.`;

    const userPrompt =
        `Transcript segments (start–end in seconds : text):\n` +
        segments.map((s) => `${s.start}-${s.end}: ${s.text}`).join('\n') +
        `\n\nReturn the JSON object described in the system prompt now.`;

    const body = {
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    };

    const parsed = parseJsonResponse(await generateContent(body, transport, 'Gemini highlight scoring'));
    return parsed.clips;
};
