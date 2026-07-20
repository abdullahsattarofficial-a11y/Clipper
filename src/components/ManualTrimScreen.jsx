import { ArrowLeft, Pause, Play, Scissors, Type } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const formatTime = (seconds) => {
    const totalSec = Math.max(0, Math.floor(seconds));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const ManualTrimScreen = ({ videoFile, initialSuggestion, onExport, onBack }) => {
    const videoRef = useRef(null);
    const blobUrlRef = useRef(null);
    const rangeTrackRef = useRef(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [clipTitle, setClipTitle] = useState(initialSuggestion?.title || 'My Clip');
    const [trimStart, setTrimStart] = useState(initialSuggestion?.start_time || 0);
    const [trimEnd, setTrimEnd] = useState(initialSuggestion?.end_time || 30);
    const [activeThumb, setActiveThumb] = useState(null); // 'start' | 'end' | null
    const [videoError, setVideoError] = useState(null);

    // Create blob URL for the video
    useEffect(() => {
        if (!videoFile) return;
        blobUrlRef.current = URL.createObjectURL(videoFile);
        if (videoRef.current) {
            videoRef.current.src = blobUrlRef.current;
        }
        return () => {
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
                blobUrlRef.current = null;
            }
        };
    }, [videoFile]);

    // When video metadata loads, update duration and clamp trimEnd
    const handleLoadedMetadata = useCallback(() => {
        const vid = videoRef.current;
        if (!vid) return;
        const dur = vid.duration;
        if (!Number.isFinite(dur) || dur <= 0) return;
        setDuration(dur);

        // Clamp trim values to actual duration
        setTrimStart(prev => Math.min(prev, dur));
        setTrimEnd(prev => {
            if (initialSuggestion?.end_time) {
                return Math.min(initialSuggestion.end_time, dur);
            }
            return Math.min(prev, dur);
        });
    }, [initialSuggestion]);

    // Track playback position
    const handleTimeUpdate = useCallback(() => {
        const vid = videoRef.current;
        if (!vid) return;
        setCurrentTime(vid.currentTime);
    }, []);

    const handlePlay = useCallback(() => setIsPlaying(true), []);
    const handlePause = useCallback(() => setIsPlaying(false), []);
    const handleVideoError = useCallback(() => {
        setVideoError('Preview unavailable for this video format.\nYou can still set trim range and export.');
    }, []);

    const togglePlayPause = useCallback(() => {
        const vid = videoRef.current;
        if (!vid) return;
        if (vid.paused) {
            // Seek to trim start if before it
            if (vid.currentTime < trimStart || vid.currentTime >= trimEnd) {
                vid.currentTime = trimStart;
            }
            vid.play();
        } else {
            vid.pause();
        }
    }, [trimStart, trimEnd]);

    // Seek to trim start when it changes
    useEffect(() => {
        const vid = videoRef.current;
        if (vid && !isPlaying) {
            vid.currentTime = trimStart;
        }
    }, [trimStart, isPlaying]);

    // Stop playback at trimEnd
    useEffect(() => {
        const vid = videoRef.current;
        if (vid && isPlaying && currentTime >= trimEnd) {
            vid.pause();
            vid.currentTime = trimStart;
        }
    }, [currentTime, trimEnd, trimStart, isPlaying]);

    const clipDuration = Math.max(0, trimEnd - trimStart);
    const MIN_CLIP_LENGTH = 1; // 1 second minimum

    // ─── Range Slider Interaction ───
    const getPositionFromEvent = useCallback((e) => {
        const track = rangeTrackRef.current;
        if (!track || duration <= 0) return 0;
        const rect = track.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return ratio * duration;
    }, [duration]);

    const handleTrackMouseDown = useCallback((e, thumb) => {
        e.preventDefault();
        e.stopPropagation();
        setActiveThumb(thumb);
    }, []);

    useEffect(() => {
        if (!activeThumb) return;

        const handleMove = (e) => {
            const pos = getPositionFromEvent(e);
            if (activeThumb === 'start') {
                const newStart = Math.max(0, Math.min(pos, trimEnd - MIN_CLIP_LENGTH));
                setTrimStart(newStart);
            } else {
                const newEnd = Math.min(duration, Math.max(pos, trimStart + MIN_CLIP_LENGTH));
                setTrimEnd(newEnd);
            }
        };

        const handleUp = () => setActiveThumb(null);

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchmove', handleMove, { passive: false });
        window.addEventListener('touchend', handleUp);

        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
            window.removeEventListener('touchmove', handleMove);
            window.removeEventListener('touchend', handleUp);
        };
    }, [activeThumb, duration, trimStart, trimEnd, getPositionFromEvent]);

    const startPercent = duration > 0 ? (trimStart / duration) * 100 : 0;
    const endPercent = duration > 0 ? (trimEnd / duration) * 100 : 100;
    const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    const handleExportClick = () => {
        if (onExport) {
            onExport(trimStart, trimEnd, clipTitle);
        }
    };

    return (
        <div className="screen screen--top animate-fade-in" style={{ maxWidth: '900px', margin: '0 auto', alignItems: 'stretch', gap: '20px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                {onBack && (
                    <button className="btn-icon" onClick={onBack} aria-label="Go back" style={{
                        width: '44px', height: '44px', flexShrink: 0, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-main)'
                    }}>
                        <ArrowLeft size={20} />
                    </button>
                )}
                <div style={{ minWidth: 0 }}>
                    <h2 style={{ fontSize: 'clamp(20px, 5.5vw, 28px)', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Scissors size={24} color="var(--primary-color)" style={{ flexShrink: 0 }} />
                        Trim Clip
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '4px' }}>
                        Preview, adjust range, and export your clip
                    </p>
                </div>
            </div>

            {/* Video Preview */}
            <div className="glass-panel" style={{ borderRadius: '16px', overflow: 'hidden' }}>
                {videoError ? (
                    <div style={{ aspectRatio: '16/9', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                        <Scissors size={40} style={{ opacity: 0.4, marginBottom: '12px' }} />
                        <p style={{ textAlign: 'center', whiteSpace: 'pre-line', fontSize: '14px' }}>{videoError}</p>
                    </div>
                ) : (
                    <div style={{ position: 'relative', background: '#000', cursor: 'pointer' }} onClick={togglePlayPause}>
                        <video
                            ref={videoRef}
                            onLoadedMetadata={handleLoadedMetadata}
                            onTimeUpdate={handleTimeUpdate}
                            onPlay={handlePlay}
                            onPause={handlePause}
                            onError={handleVideoError}
                            // Capped in vh as well as px so the video never eats
                            // the whole screen on a short phone viewport.
                            style={{ width: '100%', display: 'block', maxHeight: 'min(400px, 45vh)', objectFit: 'contain' }}
                            playsInline
                        />
                        {/* Play/Pause Overlay */}
                        {!isPlaying && (
                            <div style={{
                                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'rgba(0,0,0,0.25)', transition: 'opacity 0.2s'
                            }}>
                                <div style={{
                                    width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(0,0,0,0.5)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    backdropFilter: 'blur(4px)'
                                }}>
                                    <Play size={28} color="white" fill="white" />
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Clip Title */}
            <div>
                <label htmlFor="clip-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '14px', color: 'var(--text-muted)', fontWeight: '500' }}>
                    <Type size={16} />
                    Clip Title
                </label>
                <input
                    id="clip-title"
                    type="text"
                    value={clipTitle}
                    onChange={(e) => setClipTitle(e.target.value)}
                    placeholder="Enter clip title..."
                    className="trim-input"
                />
            </div>

            {/* Range Slider */}
            <div className="glass-panel" style={{ padding: 'clamp(16px, 4vw, 24px)', borderRadius: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="time-badge time-badge-start">Start: {formatTime(trimStart)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="time-badge time-badge-end">End: {formatTime(trimEnd)}</span>
                    </div>
                </div>

                {/* Custom Dual-Thumb Range Slider */}
                <div
                    ref={rangeTrackRef}
                    className="range-track"
                    style={{ position: 'relative', height: '40px', userSelect: 'none', touchAction: 'none' }}
                >
                    {/* Background track */}
                    <div style={{
                        position: 'absolute', top: '16px', left: 0, right: 0, height: '8px',
                        background: 'rgba(255,255,255,0.08)', borderRadius: '4px'
                    }} />

                    {/* Active range */}
                    <div style={{
                        position: 'absolute', top: '16px', height: '8px',
                        left: `${startPercent}%`, right: `${100 - endPercent}%`,
                        background: 'linear-gradient(to right, var(--primary-color), var(--primary-hover))',
                        borderRadius: '4px'
                    }} />

                    {/* Playhead */}
                    {duration > 0 && (
                        <div style={{
                            position: 'absolute', top: '12px',
                            left: `${playheadPercent}%`,
                            width: '2px', height: '16px',
                            background: 'var(--success-color)',
                            transform: 'translateX(-1px)',
                            pointerEvents: 'none',
                            zIndex: 3,
                            borderRadius: '1px',
                            boxShadow: '0 0 6px rgba(16, 185, 129, 0.5)'
                        }} />
                    )}

                    {/* Start thumb */}
                    <div
                        className={`range-thumb ${activeThumb === 'start' ? 'active' : ''}`}
                        style={{ left: `${startPercent}%` }}
                        onMouseDown={(e) => handleTrackMouseDown(e, 'start')}
                        onTouchStart={(e) => handleTrackMouseDown(e, 'start')}
                    >
                        <div className="range-thumb-inner" />
                    </div>

                    {/* End thumb */}
                    <div
                        className={`range-thumb ${activeThumb === 'end' ? 'active' : ''}`}
                        style={{ left: `${endPercent}%` }}
                        onMouseDown={(e) => handleTrackMouseDown(e, 'end')}
                        onTouchStart={(e) => handleTrackMouseDown(e, 'end')}
                    >
                        <div className="range-thumb-inner" />
                    </div>
                </div>

                {/* Duration / time labels below */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>0:00</span>
                    <span style={{
                        color: 'var(--primary-color)', fontWeight: '600', fontSize: '14px',
                        background: 'rgba(99, 102, 241, 0.1)', padding: '2px 10px', borderRadius: '6px'
                    }}>
                        Clip length: {formatTime(clipDuration)}
                    </span>
                    <span>{formatTime(duration)}</span>
                </div>
            </div>

            {/* Export Button */}
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                {onBack && (
                    <button className="btn-secondary" onClick={onBack}>
                        <ArrowLeft size={18} />
                        Back
                    </button>
                )}
                <button
                    className="btn-primary"
                    onClick={handleExportClick}
                    disabled={clipDuration < MIN_CLIP_LENGTH}
                    style={{ minWidth: '160px' }}
                >
                    <Scissors size={18} />
                    Export Clip
                </button>
            </div>
        </div>
    );
};

export default ManualTrimScreen;
