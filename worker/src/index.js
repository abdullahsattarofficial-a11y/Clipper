/**
 * clip_web API proxy.
 *
 * Holds the Gemini and Groq API keys as Worker secrets so they never reach the
 * browser. The frontend (GitHub Pages) calls this Worker; the Worker calls the
 * upstream provider with the secret attached.
 *
 * Design notes:
 *
 *  - The routes below are a fixed allowlist. The client never supplies an
 *    upstream URL, host, or path segment that we interpolate — otherwise this
 *    would be an open SSRF relay that signs requests with our own keys.
 *
 *  - Video bytes DO flow through /gemini/upload, and it's worth recording why,
 *    because the obvious optimisation does not work. Gemini's resumable upload
 *    URL self-authorizes via its `upload_id`, so we can mint it with our key,
 *    strip the key out, and hand the browser a bare URL. That upload genuinely
 *    succeeds — but only from a server. Google returns no
 *    Access-Control-Allow-Origin on the key-stripped URL, so a browser blocks
 *    the response and the upload fails. Verified end-to-end: curl passes, a real
 *    browser does not. Hence we stream the bytes through instead, capped at
 *    MAX_PROXY_UPLOAD_BYTES to stay inside Cloudflare's request body limit.
 *
 *  - A proxy protects the *key* but exposes the *quota*: anyone who finds this
 *    URL can spend it. Origin allowlisting plus per-IP rate limiting is what
 *    keeps that honest.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

// Pinned server-side so a caller can't select an expensive model on our budget.
const GEMINI_MODEL = 'gemini-flash-latest';
const WHISPER_MODEL = 'whisper-large-v3';
const GROQ_LLM_MODEL = 'llama-3.1-8b-instant';

// Groq's Whisper endpoint caps free-tier uploads at 25MB; reject earlier so the
// caller gets a clear error instead of a truncated upstream failure.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// Transcripts are text. Anything this large is abuse, not a real request.
const MAX_JSON_BYTES = 2 * 1024 * 1024;

// Cloudflare's free plan caps request bodies at 100MB; stay under it so the
// client gets our readable error instead of an opaque platform rejection.
const MAX_PROXY_UPLOAD_BYTES = 95 * 1024 * 1024;

// Gemini file resource names look like "files/abc123". Anchored, no slashes, so
// a caller can't traverse out of the files collection into another API surface.
const FILE_NAME_RE = /^files\/[a-zA-Z0-9_-]{1,128}$/;

// ─────────────────────────────────────────────────────
// CORS / origin allowlist
// ─────────────────────────────────────────────────────

const allowedOrigins = (env) =>
    (env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

/**
 * An allowlisted Origin is a real (if modest) control: browsers set it and
 * won't let page JS forge it, so this stops other *websites* from spending our
 * quota. It does not stop curl. Rate limiting is what covers that case.
 */
const corsHeaders = (request, env) => {
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    const headers = {
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Mime, X-Upload-Name',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
    if (origin && allowed.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
};

const isOriginAllowed = (request, env) => {
    const allowed = allowedOrigins(env);
    // Misconfigured (no origins set) fails closed rather than open.
    if (allowed.length === 0) return false;
    const origin = request.headers.get('Origin');
    // Same-origin and non-browser callers omit Origin; those still have to pass
    // the rate limiter, they just can't be identified as a rogue website.
    if (!origin) return true;
    return allowed.includes(origin);
};

const json = (body, status, extraHeaders) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
    });

// ─────────────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────────────

/**
 * Uses Cloudflare's built-in rate limiting binding (free tier). If the binding
 * isn't configured we fail *closed* on the assumption that an unmetered public
 * proxy is worse than a broken one.
 */
const checkRateLimit = async (request, env) => {
    if (!env.RATE_LIMITER) return { ok: false, reason: 'Rate limiter not configured' };
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    return success ? { ok: true } : { ok: false, reason: 'Rate limit exceeded' };
};

// ─────────────────────────────────────────────────────
// Upstream helpers
// ─────────────────────────────────────────────────────

/**
 * Upstream errors are echoed with their status so the UI can say something
 * useful, but the body is truncated — provider error payloads have been known
 * to quote the request back, and we don't want a key landing in a client log.
 */
const relayError = async (res, label, cors) => {
    const text = await res.text().catch(() => res.statusText);
    return json({ error: `${label} failed (${res.status})`, detail: text.slice(0, 500) }, res.status, cors);
};

const requireKey = (key, provider, cors) =>
    key ? null : json({ error: `${provider} is not configured on this server.` }, 503, cors);

// ─────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────

/**
 * Upload a video to the Gemini File API on the caller's behalf.
 *
 * Does the resumable handshake and the byte transfer in one request so the
 * upload URL — which carries our key — never leaves this Worker. The client
 * sends raw bytes and gets the finished file metadata back.
 *
 * The bytes are streamed rather than buffered: `request.body` is piped straight
 * into the upstream PUT, so a large video doesn't have to fit in Worker memory.
 */
const geminiUpload = async (request, env, cors) => {
    const missing = requireKey(env.GEMINI_API_KEY, 'Gemini', cors);
    if (missing) return missing;

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
        return json({ error: 'A Content-Length header is required.' }, 411, cors);
    }
    if (contentLength > MAX_PROXY_UPLOAD_BYTES) {
        return json({
            error: 'Video too large for the shared proxy. Use the Groq provider ' +
                   '(it only uploads extracted audio), or add your own Gemini key in Settings.',
        }, 413, cors);
    }

    const mimeType = request.headers.get('X-Upload-Mime') || 'video/mp4';
    const displayName = (request.headers.get('X-Upload-Name') || 'video.mp4').slice(0, 200);

    // 1) Start the resumable session.
    const initRes = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(contentLength),
            'X-Goog-Upload-Header-Content-Type': mimeType,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { displayName } }),
    });
    if (!initRes.ok) return relayError(initRes, 'Gemini upload init', cors);

    const uploadUrl = initRes.headers.get('X-Goog-Upload-URL')
                   || initRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) return json({ error: 'Gemini returned no upload URL.' }, 502, cors);

    // 2) Stream the caller's bytes into it.
    const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Content-Length': String(contentLength),
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize',
        },
        body: request.body,
    });
    if (!putRes.ok) return relayError(putRes, 'Gemini upload', cors);

    return json(await putRes.json(), 200, cors);
};

const geminiFileStatus = async (request, env, cors, fileName) => {
    const missing = requireKey(env.GEMINI_API_KEY, 'Gemini', cors);
    if (missing) return missing;

    const res = await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${env.GEMINI_API_KEY}`);
    if (!res.ok) return relayError(res, 'Gemini file status', cors);
    return json(await res.json(), 200, cors);
};

const geminiFileDelete = async (request, env, cors, fileName) => {
    const missing = requireKey(env.GEMINI_API_KEY, 'Gemini', cors);
    if (missing) return missing;

    await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${env.GEMINI_API_KEY}`, { method: 'DELETE' });
    // Cleanup is best-effort; the client fires and forgets.
    return json({ ok: true }, 200, cors);
};

/**
 * Forwards a generateContent call. We accept only the three fields the app
 * actually sends and rebuild the payload, so nothing else the client puts on
 * the wire reaches Google under our key.
 */
const geminiGenerate = async (request, env, cors) => {
    const missing = requireKey(env.GEMINI_API_KEY, 'Gemini', cors);
    if (missing) return missing;

    const { contents, systemInstruction, generationConfig } = await request.json();
    if (!Array.isArray(contents)) {
        return json({ error: '"contents" must be an array.' }, 400, cors);
    }

    const body = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (generationConfig) body.generationConfig = generationConfig;

    const res = await fetch(
        `${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
    );

    if (!res.ok) return relayError(res, 'Gemini generation', cors);
    return json(await res.json(), 200, cors);
};

/**
 * Whisper needs the raw audio, so this one genuinely does stream through the
 * Worker. Audio is small (16kHz mono WAV) compared to the source video, and the
 * 25MB cap keeps it bounded.
 */
const groqTranscribe = async (request, env, cors) => {
    const missing = requireKey(env.GROQ_API_KEY, 'Groq', cors);
    if (missing) return missing;

    const inbound = await request.formData();
    const file = inbound.get('file');
    if (!file || typeof file === 'string') {
        return json({ error: 'An audio "file" part is required.' }, 400, cors);
    }
    if (file.size > MAX_AUDIO_BYTES) {
        return json({ error: 'Audio exceeds the 25MB transcription limit.' }, 413, cors);
    }

    // Rebuilt rather than forwarded: the model and response format are ours to
    // choose, not the caller's.
    const outbound = new FormData();
    outbound.append('file', file, 'audio.wav');
    outbound.append('model', WHISPER_MODEL);
    outbound.append('response_format', 'verbose_json');
    outbound.append('timestamp_granularities[]', 'segment');

    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: outbound,
    });

    if (!res.ok) return relayError(res, 'Groq transcription', cors);
    return json(await res.json(), 200, cors);
};

const groqChat = async (request, env, cors) => {
    const missing = requireKey(env.GROQ_API_KEY, 'Groq', cors);
    if (missing) return missing;

    const { messages, temperature } = await request.json();
    if (!Array.isArray(messages)) {
        return json({ error: '"messages" must be an array.' }, 400, cors);
    }

    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
            model: GROQ_LLM_MODEL,
            messages,
            temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.3,
            response_format: { type: 'json_object' },
        }),
    });

    if (!res.ok) return relayError(res, 'Groq highlight scoring', cors);
    return json(await res.json(), 200, cors);
};

// ─────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        const cors = corsHeaders(request, env);
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        if (path === '/' || path === '/health') {
            return json({ ok: true, service: 'clip_web api proxy' }, 200, cors);
        }

        if (!isOriginAllowed(request, env)) {
            return json({ error: 'Origin not allowed.' }, 403, cors);
        }

        const limited = await checkRateLimit(request, env);
        if (!limited.ok) {
            return json({ error: limited.reason }, 429, cors);
        }

        // Reject oversized bodies up front where the header lets us. The
        // multipart route re-checks the real size after parsing, since
        // Content-Length can lie.
        const declared = Number(request.headers.get('Content-Length') || 0);
        const cap = path === '/groq/transcribe' ? MAX_AUDIO_BYTES
                  : path === '/gemini/upload' ? MAX_PROXY_UPLOAD_BYTES
                  : MAX_JSON_BYTES;
        if (declared > cap) {
            return json({ error: 'Request body too large.' }, 413, cors);
        }

        try {
            if (request.method === 'POST') {
                if (path === '/gemini/upload') return await geminiUpload(request, env, cors);
                if (path === '/gemini/generate') return await geminiGenerate(request, env, cors);
                if (path === '/groq/transcribe') return await groqTranscribe(request, env, cors);
                if (path === '/groq/chat') return await groqChat(request, env, cors);
            }

            // Gemini file routes carry the resource name in the query string so
            // the embedded slash never has to survive a path segment.
            if (path === '/gemini/file') {
                const fileName = url.searchParams.get('name') || '';
                if (!FILE_NAME_RE.test(fileName)) {
                    return json({ error: 'Invalid file name.' }, 400, cors);
                }
                if (request.method === 'GET') return await geminiFileStatus(request, env, cors, fileName);
                if (request.method === 'DELETE') return await geminiFileDelete(request, env, cors, fileName);
            }

            return json({ error: 'Not found.' }, 404, cors);
        } catch (err) {
            // Never surface the raw error: stack traces from a key-bearing
            // request are exactly the wrong thing to hand a stranger.
            console.error('Proxy error:', err);
            return json({ error: 'Upstream request failed.' }, 502, cors);
        }
    },
};
