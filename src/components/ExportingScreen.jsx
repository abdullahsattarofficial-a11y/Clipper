import { Loader2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { trimVideo } from '../services/ffmpeg_service';

const ExportingScreen = ({ videoFile, start, end, onComplete, onError }) => {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const runTrim = async () => {
            try {
                const blob = await trimVideo(videoFile, start, end, (p) => setProgress(p));
                onComplete(blob);
            } catch (err) {
                console.error(err);
                onError(err.message || "Failed to trim video");
            }
        };
        runTrim();
    }, [videoFile, start, end, onComplete, onError]);

    return (
        <div className="screen animate-fade-in">
            <div className="glass-panel panel panel--narrow" style={{ textAlign: 'center' }}>
                <Loader2 className="animate-pulse" color="var(--primary-color)" size={48} style={{ animation: 'spin 2s linear infinite', margin: '0 auto 24px auto' }} />

                <h2 style={{ fontSize: 'clamp(20px, 5vw, 24px)', marginBottom: '16px' }}>Trimming Video...</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>Please wait while we cut the clip.</p>
                
                <div style={{ width: '100%', height: '8px', background: 'var(--surface-color)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ 
                        height: '100%', 
                        width: `${progress}%`, 
                        background: 'linear-gradient(to right, var(--primary-color), var(--primary-hover))',
                        transition: 'width 0.2s ease'
                    }} />
                </div>
                <p style={{ marginTop: '12px', fontSize: '14px', color: 'var(--text-muted)' }}>{Math.round(progress)}%</p>
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

export default ExportingScreen;
