// src/utils/clip_duration.js
//
// Shared rules for the "minimum clip length" the user picks before analysis.
// The AI is asked for clips of at least that length, and whatever it returns
// is re-checked here — models drift off the instruction often enough that the
// prompt alone can't be trusted.

export const MIN_CLIP_SECONDS = 10;
export const MAX_CLIP_SECONDS = 30;
export const DEFAULT_MIN_CLIP_SECONDS = 15;

// Tolerance for float noise when comparing against the minimum.
const EPSILON = 0.05;

export const clampMinClipSeconds = (seconds) => {
    const n = Math.round(Number(seconds));
    if (!Number.isFinite(n)) return DEFAULT_MIN_CLIP_SECONDS;
    return Math.max(MIN_CLIP_SECONDS, Math.min(MAX_CLIP_SECONDS, n));
};

/**
 * Read a video file's duration in seconds without decoding it.
 * Resolves to null when the browser can't determine it (some WebM/streamed
 * files report Infinity) — callers treat null as "unknown, skip the check".
 */
export const getVideoDuration = (file) => new Promise((resolve) => {
    if (!file) {
        resolve(null);
        return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const finish = (value) => {
        URL.revokeObjectURL(url);
        video.removeAttribute('src');
        video.load();
        resolve(value);
    };

    video.onloadedmetadata = () => {
        const dur = video.duration;
        finish(Number.isFinite(dur) && dur > 0 ? dur : null);
    };
    video.onerror = () => finish(null);

    video.src = url;
});

/**
 * Enforce the user's minimum on clips returned by the AI.
 *
 * Short clips are grown around their midpoint and slid back inside the video
 * bounds. Anything that still can't reach the minimum (the moment sits in a
 * video too short to support it) is dropped rather than shipped under-length.
 */
export const enforceMinClipDuration = (clips, minSeconds, videoDuration = null) => {
    if (!Array.isArray(clips)) return [];

    const limit = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : null;

    return clips
        .map((clip) => {
            let start = Number(clip.start_time);
            let end = Number(clip.end_time);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

            start = Math.max(0, start);
            if (limit !== null) end = Math.min(end, limit);

            const shortfall = minSeconds - (end - start);
            if (shortfall > 0) {
                start -= shortfall / 2;
                end += shortfall / 2;

                if (start < 0) {
                    end -= start; // push the overflow onto the tail
                    start = 0;
                }
                if (limit !== null && end > limit) {
                    start = Math.max(0, start - (end - limit));
                    end = limit;
                }
            }

            if (end - start < minSeconds - EPSILON) return null;

            return { ...clip, start_time: start, end_time: end };
        })
        .filter(Boolean);
};
