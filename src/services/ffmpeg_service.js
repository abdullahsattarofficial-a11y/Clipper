import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
// @ffmpeg/ffmpeg 0.12 spawns a *module* web worker, which loads the core via
// dynamic `import()` — so we must hand it the ESM core build (the UMD build has
// no default export and fails with "failed to import ffmpeg-core.js").
// The ?url imports make Vite serve/bundle the core from our own origin, so the
// app no longer depends on a third-party CDN being reachable at runtime.
import coreJsURL from '@ffmpeg/core?url';
import coreWasmURL from '@ffmpeg/core/wasm?url';

let ffmpeg = null;
let isLoaded = false;
let loadPromise = null;

export const initFFmpeg = async () => {
    if (ffmpeg && isLoaded) return ffmpeg;
    // De-dupe concurrent callers so we only ever load the ~32MB core once.
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        const instance = new FFmpeg();
        await instance.load({
            coreURL: await toBlobURL(coreJsURL, 'text/javascript'),
            wasmURL: await toBlobURL(coreWasmURL, 'application/wasm'),
        });
        ffmpeg = instance;
        isLoaded = true;
        return ffmpeg;
    })();

    try {
        return await loadPromise;
    } catch (err) {
        // Reset so a later attempt can retry instead of being stuck on a
        // rejected promise forever.
        loadPromise = null;
        throw err;
    }
};

/**
 * Safely clamp progress to 0–100. FFmpeg WASM can report NaN, Infinity,
 * or values > 1 depending on the codec / container.
 */
const safeProgress = (raw) => {
    const p = raw * 100;
    if (!Number.isFinite(p)) return 0;
    return Math.min(100, Math.max(0, p));
};

/**
 * Silently try to delete a file from the FFmpeg virtual FS.
 * Non-critical — avoids stale data between operations.
 */
const tryDeleteFile = async (ff, name) => {
    try { await ff.deleteFile(name); } catch (_) { /* ignore */ }
};

// There is exactly one core instance backed by one worker, so two overlapping
// `exec` calls interleave on the same virtual FS and wedge the worker. Chain
// every operation through this so callers can't collide.
let opQueue = Promise.resolve();
const runExclusive = (task) => {
    const result = opQueue.then(task, task);
    // Keep the chain alive after a failed task, but don't leave an unhandled
    // rejection behind — the caller still gets the real error via `result`.
    opQueue = result.catch(() => {});
    return result;
};

export const extractAudio = (videoFile, onProgress = null) => runExclusive(async () => {
    const ff = await initFFmpeg();
    const inputName = 'input_audio.mp4';
    const outputName = 'audio.wav';

    // Must be the *same* reference to detach later: FFmpeg.off() filters its
    // listener array by identity, so off('progress') alone removes nothing.
    const progressHandler = onProgress
        ? ({ progress }) => { onProgress(safeProgress(progress)); }
        : null;

    try {
        if (progressHandler) {
            ff.on('progress', progressHandler);
        }

        // Clean up any leftover files from a previous run
        await tryDeleteFile(ff, inputName);
        await tryDeleteFile(ff, outputName);

        await ff.writeFile(inputName, await fetchFile(videoFile));

        // -vn: drop video, -ac 1: mono, -ar 16000: 16kHz sample rate (Whisper's
        // native rate, avoids server-side resampling), -y: overwrite if exists.
        const ret = await ff.exec(['-y', '-i', inputName, '-vn', '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', outputName]);

        if (ret !== 0) {
            throw new Error('FFmpeg audio extraction returned a non-zero exit code.');
        }

        const data = await ff.readFile(outputName);
        return new Blob([data], { type: 'audio/wav' });
    } finally {
        // Always detach to prevent handler stacking across runs
        if (progressHandler) ff.off('progress', progressHandler);
        // Clean up virtual FS
        await tryDeleteFile(ff, inputName);
        await tryDeleteFile(ff, outputName);
    }
});

export const trimVideo = (videoFile, startSeconds, endSeconds, onProgress = null) => runExclusive(async () => {
    const ff = await initFFmpeg();
    const inputName = 'input_trim.mp4';
    const outName = 'output.mp4';

    const progressHandler = onProgress
        ? ({ progress }) => { onProgress(safeProgress(progress)); }
        : null;

    try {
        if (progressHandler) {
            ff.on('progress', progressHandler);
        }

        await tryDeleteFile(ff, inputName);
        await tryDeleteFile(ff, outName);

        await ff.writeFile(inputName, await fetchFile(videoFile));
        const duration = endSeconds - startSeconds;

        // Use stream copy (`-c copy`) for speed
        const ret = await ff.exec([
            '-y', '-ss', String(startSeconds), '-i', inputName, '-t', String(duration),
            '-c', 'copy', '-avoid_negative_ts', 'make_zero', outName
        ]);

        if (ret !== 0) {
            // Fallback: re-encode if copy fails
            await ff.exec([
                '-y', '-ss', String(startSeconds), '-i', inputName, '-t', String(duration),
                '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', outName
            ]);
        }

        const data = await ff.readFile(outName);
        return new Blob([data], { type: 'video/mp4' });
    } finally {
        if (progressHandler) ff.off('progress', progressHandler);
        await tryDeleteFile(ff, inputName);
        await tryDeleteFile(ff, outName);
    }
});
