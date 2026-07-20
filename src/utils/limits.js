// src/utils/limits.js
//
// Size ceilings. These exist mostly for phones: FFmpeg WASM loads the whole
// input into the worker's heap, so a large file doesn't degrade gracefully — it
// takes the browser tab down with it. Failing early with a readable message
// beats an unexplained crash.

// Practical ceiling for in-browser handling. Desktop can survive more, but the
// same build serves phones, so the limit is set where the weakest device holds.
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB

// Groq's Whisper endpoint rejects audio above this on the free tier.
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB

export const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
};

/**
 * Returns an error string when the file can't be handled, or null when it can.
 */
export const checkVideoSize = (file) => {
    if (!file) return null;
    if (file.size > MAX_VIDEO_BYTES) {
        return `That video is ${formatBytes(file.size)}. The browser can only handle ` +
               `up to ${formatBytes(MAX_VIDEO_BYTES)} — trim it down or use a smaller export first.`;
    }
    return null;
};
