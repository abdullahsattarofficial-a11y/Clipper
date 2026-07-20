import { ArrowLeft, CheckCircle, Download, RotateCcw } from 'lucide-react';
import React, { useEffect, useRef } from 'react';

const ExportResultScreen = ({ videoBlob, onBackToSuggestions, onStartOver }) => {
    const videoRef = useRef(null);
    const blobUrl = useRef(null);

    useEffect(() => {
        if (videoBlob && !blobUrl.current) {
            blobUrl.current = URL.createObjectURL(videoBlob);
            if (videoRef.current) {
                videoRef.current.src = blobUrl.current;
            }
        }
        return () => {
            if (blobUrl.current) {
                URL.revokeObjectURL(blobUrl.current);
                blobUrl.current = null;
            }
        };
    }, [videoBlob]);

    const handleDownload = () => {
        if (blobUrl.current) {
            const a = document.createElement('a');
            a.href = blobUrl.current;
            a.download = `clip_${Date.now()}.mp4`;
            a.click();
        }
    };

    return (
        <div className="screen screen--top animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <div style={{
                    width: '64px', height: '64px', borderRadius: '50%',
                    background: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px'
                }}>
                    <CheckCircle size={32} color="var(--success-color)" />
                </div>
                <h1 style={{ fontSize: 'clamp(24px, 6vw, 32px)', fontWeight: '700' }}>Clip Exported!</h1>
                <p className="screen-subtitle">Your video is ready to preview and download.</p>
            </div>

            <div className="glass-panel panel" style={{ padding: 'clamp(12px, 3vw, 24px)' }}>
                <div style={{ borderRadius: '12px', overflow: 'hidden', background: '#000', width: '100%', aspectRatio: '16/9' }}>
                    <video
                        ref={videoRef}
                        controls
                        autoPlay
                        playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                </div>
            </div>

            {/* btn-row wraps these three buttons instead of pushing the page
                into a horizontal scroll on narrow screens. */}
            <div className="btn-row">
                <button className="btn-primary" onClick={handleDownload}>
                    <Download size={20} />
                    Download Clip
                </button>
                <button className="btn-secondary" onClick={onBackToSuggestions}>
                    <ArrowLeft size={20} />
                    Back to Suggestions
                </button>
                <button className="btn-secondary" onClick={onStartOver}>
                    <RotateCcw size={20} />
                    Start Over
                </button>
            </div>
        </div>
    );
};

export default ExportResultScreen;
