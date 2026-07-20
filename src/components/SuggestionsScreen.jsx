import { Play, Scissors, Sparkles } from 'lucide-react';
import React from 'react';

const SuggestionsScreen = ({ highlights, videoFile, minClipSeconds, onTrimSuggestion, onManualTrim }) => {
    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const getDuration = (clip) => {
        const dur = clip.end_time - clip.start_time;
        return formatTime(dur);
    };

    return (
        <div className="screen screen--top animate-fade-in" style={{ maxWidth: '1000px', margin: '0 auto', alignItems: 'stretch' }}>
            <div>
                <h2 style={{ fontSize: 'clamp(22px, 6vw, 32px)', fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Sparkles size={28} color="var(--primary-color)" style={{ flexShrink: 0 }} />
                    Suggested Clips
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 'clamp(14px, 3.5vw, 16px)' }}>
                    AI found {highlights.length} engaging moments
                    {minClipSeconds ? `, each at least ${minClipSeconds}s long` : ''}. Tap a clip to preview &amp; fine-tune.
                </p>
            </div>

            {/* min() keeps the minimum column width under the viewport, so a
                single card can't push the grid wider than a 320px phone. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: '16px' }}>
                {highlights.map((clip, idx) => (
                    <div 
                        key={idx} 
                        className="glass-panel suggestion-card"
                        onClick={() => onTrimSuggestion(clip)}
                        style={{ 
                            padding: '20px', 
                            borderRadius: '16px', 
                            cursor: 'pointer',
                            border: '1px solid var(--border-color)',
                            transition: 'all 0.25s ease',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', gap: '8px' }}>
                            {/* minWidth:0 lets the title shrink; without it a long
                                AI-generated title forces the card to overflow. */}
                            <h3 style={{ fontSize: '17px', fontWeight: '600', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{clip.title}</h3>
                            <div style={{ 
                                background: 'rgba(99, 102, 241, 0.15)', padding: '4px 10px', borderRadius: '6px', 
                                fontSize: '12px', fontWeight: '600', color: 'var(--primary-color)', whiteSpace: 'nowrap'
                            }}>
                                {formatTime(clip.start_time)} – {formatTime(clip.end_time)}
                            </div>
                        </div>
                        <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.5', marginBottom: '12px', overflowWrap: 'anywhere' }}>{clip.reason}</p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', color: 'var(--primary-color)', fontWeight: '500' }}>
                                AI Confidence: {Math.round(clip.score * 100)}%
                            </span>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {getDuration(clip)} clip
                            </span>
                        </div>
                        <div style={{ 
                            marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)',
                            display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--primary-color)', fontSize: '13px', fontWeight: '500'
                        }}>
                            <Play size={14} fill="currentColor" />
                            Preview & Trim
                        </div>
                    </div>
                ))}
            </div>

            {/* Manual trim button — matches mobile's OutlinedButton.icon */}
            <div className="btn-row">
                <button className="btn-secondary" onClick={onManualTrim} style={{ gap: '10px' }}>
                    <Scissors size={18} />
                    Or trim a custom range manually
                </button>
            </div>
        </div>
    );
};

export default SuggestionsScreen;
