// src/services/api_config.js
//
// Decides how the app talks to the AI providers. There are two transports and
// the difference matters for security:
//
//   'direct' — the user pasted their own key in Settings. It stays in their
//              browser's localStorage and goes straight to the provider. Their
//              key, their quota, never touches our infrastructure.
//
//   'proxy'  — no user key, so we route through the Cloudflare Worker, which
//              holds the shared keys as server-side secrets.
//
// What we deliberately do NOT do any more is bake keys into the bundle. Anything
// shipped to the browser is readable by anyone who opens DevTools, so a "hidden"
// key in the JS is not hidden at all.

// Injected at build time. This is a public URL, not a secret — publishing it is
// fine; it's protected by the Worker's origin allowlist and rate limiter.
export const PROXY_URL = (import.meta.env.VITE_API_PROXY_URL || '').replace(/\/+$/, '');

export const STORAGE_KEY_PROVIDER = 'clip_mvp_ai_provider';
export const STORAGE_KEYS = {
    gemini: 'clip_mvp_gemini_key',
    groq: 'clip_mvp_groq_key',
};

// localStorage throws in Safari private mode and when storage is disabled;
// falling back to "no key" degrades to the proxy rather than crashing the app.
const readStorage = (key) => {
    try {
        return localStorage.getItem(key) || '';
    } catch {
        return '';
    }
};

export const getSelectedProvider = () => readStorage(STORAGE_KEY_PROVIDER) || 'groq';

export const getUserApiKey = (provider) => readStorage(STORAGE_KEYS[provider] || '').trim();

export const hasProxy = () => Boolean(PROXY_URL);

/**
 * Resolve the transport for a provider. Callers pass the result straight into
 * the service functions instead of an API key.
 */
export const getTransport = (provider = getSelectedProvider()) => {
    const apiKey = getUserApiKey(provider);
    if (apiKey) return { mode: 'direct', provider, apiKey };
    if (PROXY_URL) return { mode: 'proxy', provider, proxyUrl: PROXY_URL };
    return { mode: 'none', provider };
};

/** Shared message for the case where there is neither a user key nor a proxy. */
export const noTransportError = (provider) =>
    new Error(
        `No ${provider === 'groq' ? 'Groq' : 'Gemini'} access configured. ` +
        `Open Settings and paste your own API key to continue.`,
    );

/**
 * Parse a proxy/provider error response into something worth showing a user.
 * Both shapes are handled: our Worker's `{ error }` and the providers' own
 * `{ error: { message } }`.
 */
export const describeApiError = async (res, label) => {
    let detail = '';
    try {
        const body = await res.json();
        detail = body?.error?.message || body?.error || body?.detail || '';
    } catch {
        detail = await res.text().catch(() => '');
    }
    if (res.status === 429) {
        return new Error(
            'Rate limit reached. Wait a minute and try again, or add your own ' +
            'API key in Settings for unrestricted use.',
        );
    }
    if (res.status === 403) {
        return new Error('This app is not authorized to use the shared API proxy from here.');
    }
    return new Error(`${label} failed (${res.status})${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
};
