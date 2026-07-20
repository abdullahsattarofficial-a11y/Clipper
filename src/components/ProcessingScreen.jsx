import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import {
    uploadVideoToGemini,
    waitForFileProcessing,
    transcribeVideo,
    getHighlights,
    deleteGeminiFile,
} from '../services/gemini_service';
import { transcribeAudioGroq, getHighlightsGroq } from '../services/groq_service';
import { getSelectedProvider, getTransport } from '../services/api_config';
import { extractAudio } from '../services/ffmpeg_service';
import {
    DEFAULT_MIN_CLIP_SECONDS,
    clampMinClipSeconds,
    enforceMinClipDuration,
} from '../utils/clip_duration';

const ProcessingScreen = ({
    videoFile,
    minClipSeconds = DEFAULT_MIN_CLIP_SECONDS,
    videoDuration = null,
    onProcessingComplete,
    onError,
}) => {
    // 0: uploading/extracting, 1: transcribing, 2: scoring highlights
    const [step, setStep] = useState(0);
    const [progress, setProgress] = useState(0);
    // Gemini path: upload finished, waiting for server-side processing
    const [serverProcessing, setServerProcessing] = useState(false);
    // Which file the pipeline has already been started for.
    const startedForRef = useRef(null);
    const aliveRef = useRef(true);

    const provider = getSelectedProvider();

    // Deliberately its own effect: React runs *every* cleanup before it re-runs
    // the setups, so under StrictMode's mount/unmount/mount this flag lands back
    // on `true`. A flag owned by the pipeline effect below cannot do that — the
    // second setup bails out early and never gets to reset it.
    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    useEffect(() => {
        if (!videoFile) return;
        // StrictMode invokes this twice for a single mount. Run the pipeline
        // once per file — and never cancel it from this effect's cleanup, or
        // the first run would be killed by its own teardown while the second
        // invocation bails out here, leaving nothing running at all.
        if (startedForRef.current === videoFile) return;
        startedForRef.current = videoFile;

        let uploadedFileName = null;

        // Resolved once per run: either the user's own key or the shared proxy.
        const transport = getTransport(provider);
        const minSeconds = clampMinClipSeconds(minClipSeconds);

        // The prompt asks for clips of at least minSeconds, but models drift —
        // re-check and repair whatever comes back before showing it.
        const finish = (clips) => {
            if (!aliveRef.current) return;
            const usable = enforceMinClipDuration(clips, minSeconds, videoDuration);
            if (usable.length === 0) {
                onError(
                    `The AI couldn't find a moment at least ${minSeconds}s long in this video. ` +
                    `Try lowering the minimum clip length, or trim a range manually.`,
                );
                return;
            }
            onProcessingComplete(usable);
        };

        // ─── Gemini path: upload video directly (no FFmpeg needed) ───
        const runGeminiProcess = async () => {
            try {
                // ── Step 0: Upload video directly to Gemini ──
                setStep(0);
                setProgress(0);

                const fileInfo = await uploadVideoToGemini(videoFile, transport, (p) => {
                    if (aliveRef.current) setProgress(p);
                });
                uploadedFileName = fileInfo.name;
                if (!aliveRef.current) return;

                // Wait for Gemini to finish processing the file
                setProgress(100);
                setServerProcessing(true);
                const activeFile = await waitForFileProcessing(fileInfo.name, transport);
                if (!aliveRef.current) return;

                // ── Step 1: Transcribe ──
                setStep(1);
                setProgress(0);

                const segments = await transcribeVideo(
                    activeFile.uri,
                    activeFile.mimeType,
                    transport,
                );
                if (!aliveRef.current) return;

                // ── Step 2: Score highlights ──
                setStep(2);
                setProgress(0);

                const highlights = await getHighlights(segments, transport, minSeconds);
                if (!aliveRef.current) return;

                finish(highlights);
            } catch (err) {
                if (!aliveRef.current) return;
                console.error(err);
                onError(err.message || "An error occurred during processing.");
            } finally {
                // Cleanup: delete uploaded file from Gemini servers
                if (uploadedFileName) {
                    deleteGeminiFile(uploadedFileName, transport);
                }
            }
        };

        // ─── Groq path: FFmpeg audio extraction → Whisper → Llama ───
        const runGroqProcess = async () => {
            try {
                // ── Step 0: Extract audio (Whisper needs audio, not video) ──
                setStep(0);
                setProgress(0);

                const audioBlob = await extractAudio(videoFile, (p) => {
                    if (aliveRef.current) setProgress(p);
                });

                if (!aliveRef.current) return;
                audioBlob.name = 'audio.wav';

                // ── Step 1: Transcribe with Whisper ──
                setStep(1);
                setProgress(0);

                const segments = await transcribeAudioGroq(audioBlob, transport);
                if (!aliveRef.current) return;

                setProgress(100);

                // ── Step 2: Score highlights with Llama ──
                setStep(2);
                setProgress(0);

                const highlights = await getHighlightsGroq(segments, transport, minSeconds);
                if (!aliveRef.current) return;

                finish(highlights);
            } catch (err) {
                if (!aliveRef.current) return;
                console.error(err);
                onError(err.message || "An error occurred during processing.");
            }
        };

        if (provider === 'groq') {
            runGroqProcess();
        } else {
            runGeminiProcess();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoFile]);

    const steps = provider === 'groq'
        ? ["Extracting audio...", "Transcribing with Whisper...", "Finding best highlights..."]
        : [
            serverProcessing ? "Preparing video on server..." : "Uploading video...",
            "Transcribing audio...",
            "Finding best highlights...",
        ];

    return (
        <div className="screen animate-fade-in">
            <div className="glass-panel panel panel--narrow">
                <h2 style={{ fontSize: 'clamp(20px, 5vw, 24px)', marginBottom: '32px', textAlign: 'center' }}>Analyzing Video</h2>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {steps.map((text, index) => {
                        const isCurrent = step === index;
                        const isPast = step > index;
                        
                        return (
                            <div key={index} style={{ 
                                display: 'flex', alignItems: 'center', gap: '16px',
                                opacity: isCurrent || isPast ? 1 : 0.4
                            }}>
                                {isPast ? (
                                    <CheckCircle2 color="var(--success-color)" size={24} />
                                ) : isCurrent ? (
                                    <Loader2 color="var(--primary-color)" size={24} style={{ animation: 'spin 2s linear infinite' }} />
                                ) : (
                                    <Circle color="var(--border-color)" size={24} />
                                )}
                                <span style={{ fontSize: 'clamp(15px, 4vw, 18px)', fontWeight: isCurrent ? '600' : '400' }}>
                                    {text}
                                    {isCurrent && index === 0 && progress > 0 && !serverProcessing && ` (${Math.round(progress)}%)`}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
            
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default ProcessingScreen;
