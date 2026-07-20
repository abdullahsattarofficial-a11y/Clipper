import { AlertTriangle, Scissors, Sparkles, Timer } from 'lucide-react';
import React from 'react';
import { MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from '../utils/clip_duration';

const formatTime = (seconds) => {
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const VideoImportedScreen = ({
    videoFile,
    videoDuration,
    minClipSeconds,
    onMinClipSecondsChange,
    onAnalyze,
    onManualTrim,
}) => {
    // videoDuration is null while metadata loads, and stays null if the browser
    // can't report it — in both cases we don't block the user.
    const durationKnown = Number.isFinite(videoDuration) && videoDuration > 0;
    const videoTooShort = durationKnown && videoDuration < minClipSeconds;

    const sliderPercent =
        ((minClipSeconds - MIN_CLIP_SECONDS) / (MAX_CLIP_SECONDS - MIN_CLIP_SECONDS)) * 100;

    return (
        <div className="screen animate-fade-in">
            <div className="glass-panel panel panel--narrow" style={{ textAlign: 'center' }}>
                <div style={{
                    width: 'clamp(56px, 14vw, 72px)', height: 'clamp(56px, 14vw, 72px)', borderRadius: '50%',
                    background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 20px auto'
                }}>
                    <span style={{ fontSize: 'clamp(28px, 7vw, 36px)' }}>🎬</span>
                </div>
                <h2 style={{ fontSize: 'clamp(20px, 5vw, 24px)', fontWeight: '700', marginBottom: '8px' }}>Video Imported</h2>
                {/* Long filenames must break rather than widen the panel. */}
                <p style={{ color: 'var(--text-muted)', marginBottom: '8px', fontSize: '14px', overflowWrap: 'anywhere' }}>
                    {videoFile?.name}
                    {durationKnown && ` · ${formatTime(videoDuration)}`}
                </p>
                <p style={{ color: 'var(--text-muted)', marginBottom: '28px', fontSize: '14px' }}>
                    Choose how you want to create your clip.
                </p>

                {/* ─── Minimum clip length ─── */}
                <div style={{
                    textAlign: 'left', padding: '20px', borderRadius: '16px',
                    background: 'rgba(0, 0, 0, 0.2)', border: '1px solid var(--border-color)',
                    marginBottom: '24px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <label htmlFor="min-clip-seconds" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '600' }}>
                            <Timer size={16} color="var(--primary-color)" />
                            Minimum clip length
                        </label>
                        <span className="time-badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary-color)' }}>
                            {minClipSeconds}s
                        </span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '14px' }}>
                        Every AI suggestion will be at least this long.
                    </p>

                    <input
                        id="min-clip-seconds"
                        type="range"
                        className="length-slider"
                        min={MIN_CLIP_SECONDS}
                        max={MAX_CLIP_SECONDS}
                        step={1}
                        value={minClipSeconds}
                        onChange={(e) => onMinClipSecondsChange(Number(e.target.value))}
                        style={{ '--fill-percent': `${sliderPercent}%` }}
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        <span>{MIN_CLIP_SECONDS}s</span>
                        <span>{MAX_CLIP_SECONDS}s</span>
                    </div>
                </div>

                {videoTooShort && (
                    <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: '10px', textAlign: 'left',
                        padding: '14px 16px', borderRadius: '12px', marginBottom: '20px',
                        background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.35)'
                    }}>
                        <AlertTriangle size={18} color="var(--error-color)" style={{ flexShrink: 0, marginTop: '1px' }} />
                        <span style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-main)' }}>
                            This video is only <strong>{formatTime(videoDuration)}</strong> long, which is
                            shorter than the <strong>{minClipSeconds}s</strong> minimum you picked. Lower the
                            minimum or upload a longer video.
                        </span>
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <button
                        className="btn-primary"
                        onClick={onAnalyze}
                        disabled={videoTooShort}
                        style={{ width: '100%' }}
                    >
                        <Sparkles size={20} />
                        Suggest clips with AI
                    </button>
                    <button className="btn-secondary" onClick={onManualTrim} style={{ width: '100%' }}>
                        <Scissors size={20} />
                        Skip straight to manual trim
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VideoImportedScreen;
