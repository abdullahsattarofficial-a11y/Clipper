// src/services/groq_service.js
//
// Uses Groq's API for transcription (Whisper) and highlight extraction (Llama).
// This mirrors the mobile app's approach in clip_mvp.
//
// Like the Gemini service, these take a `transport` rather than a raw key so the
// same code serves both the bring-your-own-key and proxied paths.

import { DEFAULT_MIN_CLIP_SECONDS, clampMinClipSeconds } from '../utils/clip_duration';
import { describeApiError, noTransportError } from './api_config';
import { MAX_AUDIO_BYTES, formatBytes } from '../utils/limits';

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const WHISPER_MODEL = 'whisper-large-v3';
const LLM_MODEL = 'llama-3.1-8b-instant';

const assertUsable = (transport) => {
    if (!transport || transport.mode === 'none') throw noTransportError('groq');
};

// ─────────────────────────────────────────────────────
// Transcription (Whisper — multipart file upload)
// ─────────────────────────────────────────────────────

/**
 * Transcribe audio using Groq's Whisper endpoint.
 * Expects an audio Blob (e.g. WAV extracted by FFmpeg).
 * Returns an array of { start, end, text } segments.
 *
 * Unlike the Gemini path, these bytes really do pass through the proxy — but
 * 16kHz mono WAV is roughly 32KB/s, so even a long video stays small.
 */
export const transcribeAudioGroq = async (audioBlob, transport) => {
    assertUsable(transport);

    // Checked client-side so the user gets a real explanation instead of an
    // opaque 413 from two hops away.
    if (audioBlob.size > MAX_AUDIO_BYTES) {
        throw new Error(
            `The extracted audio is ${formatBytes(audioBlob.size)}, over the ` +
            `${formatBytes(MAX_AUDIO_BYTES)} transcription limit. Try a shorter video, ` +
            `or switch to Gemini in Settings — it handles long videos.`,
        );
    }

    const formData = new FormData();
    formData.append('file', audioBlob, audioBlob.name || 'audio.wav');

    let url;
    const headers = {};
    if (transport.mode === 'proxy') {
        url = `${transport.proxyUrl}/groq/transcribe`;
        // The Worker pins the model and response format itself.
    } else {
        url = `${GROQ_BASE}/audio/transcriptions`;
        headers.Authorization = `Bearer ${transport.apiKey}`;
        formData.append('model', WHISPER_MODEL);
        formData.append('response_format', 'verbose_json');
        formData.append('timestamp_granularities[]', 'segment');
    }

    const res = await fetch(url, { method: 'POST', headers, body: formData });
    if (!res.ok) throw await describeApiError(res, 'Groq transcription');

    const data = await res.json();
    const segments = data.segments;
    if (!segments || !Array.isArray(segments)) {
        throw new Error('No segments returned from Groq Whisper');
    }

    // Map Whisper's segment format to our app's format
    return segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: (s.text || '').trim(),
    }));
};

// ─────────────────────────────────────────────────────
// Highlight extraction (Llama — chat completions)
// ─────────────────────────────────────────────────────

export const getHighlightsGroq = async (segments, transport, minClipSeconds = DEFAULT_MIN_CLIP_SECONDS) => {
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

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    let url;
    const headers = { 'Content-Type': 'application/json' };
    let body;
    if (transport.mode === 'proxy') {
        url = `${transport.proxyUrl}/groq/chat`;
        body = { messages, temperature: 0.3 };
    } else {
        url = `${GROQ_BASE}/chat/completions`;
        headers.Authorization = `Bearer ${transport.apiKey}`;
        body = {
            model: LLM_MODEL,
            messages,
            temperature: 0.3,
            response_format: { type: 'json_object' },
        };
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw await describeApiError(res, 'Groq highlight scoring');

    const data = await res.json();
    let text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('No highlight content returned from Groq');

    text = text.trim();
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(text);
    return parsed.clips;
};
