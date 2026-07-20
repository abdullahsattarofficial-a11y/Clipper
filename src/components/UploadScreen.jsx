import { UploadCloud, Video, AlertTriangle } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { checkVideoSize, MAX_VIDEO_BYTES, formatBytes } from '../utils/limits';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.flv', '.wmv', '.3gp', '.ts', '.mts'];

const isVideoFile = (file) => {
    if (file.type && file.type.startsWith('video/')) return true;
    // Fallback: check extension when MIME type is missing or non-standard
    const name = file.name?.toLowerCase() || '';
    return VIDEO_EXTENSIONS.some(ext => name.endsWith(ext));
};

const UploadScreen = ({ onVideoSelected }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [rejection, setRejection] = useState('');
    const fileInputRef = useRef(null);

    /**
     * Both entry points (drop and picker) funnel through here. Previously a
     * rejected file was silently swallowed, which reads as the app being
     * broken — now the reason is shown.
     */
    const acceptFile = (file) => {
        if (!file) return;

        if (!isVideoFile(file)) {
            setRejection(`"${file.name}" doesn't look like a video file.`);
            return;
        }

        // FFmpeg WASM loads the whole file into memory, so an oversized input
        // takes the tab down rather than failing gracefully — especially on
        // phones. Catch it before anything allocates.
        const tooBig = checkVideoSize(file);
        if (tooBig) {
            setRejection(tooBig);
            return;
        }

        setRejection('');
        onVideoSelected(file);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        acceptFile(e.dataTransfer.files[0]);
    };

    const handleFileChange = (e) => {
        acceptFile(e.target.files[0]);
        // Reset value so re-selecting the same file still fires onChange
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div className="screen animate-fade-in">
            <div style={{ textAlign: 'center' }}>
                <h1
                    className="screen-title"
                    style={{
                        marginBottom: '12px',
                        background: 'linear-gradient(to right, #818cf8, #c084fc)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                    }}
                >
                    Clip MVP
                </h1>
                <p className="screen-subtitle">
                    AI-powered video highlights &amp; trimming
                </p>
            </div>

            <div
                className="glass-panel panel panel--medium"
                role="button"
                tabIndex={0}
                aria-label="Upload a video"
                style={{
                    border: `2px dashed ${isDragging ? 'var(--primary-color)' : 'var(--border-color)'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    background: isDragging ? 'rgba(99, 102, 241, 0.1)' : 'rgba(26, 29, 36, 0.6)',
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                    }
                }}
            >
                <div style={{
                    width: 'clamp(56px, 15vw, 80px)',
                    height: 'clamp(56px, 15vw, 80px)',
                    borderRadius: '50%',
                    background: 'rgba(99, 102, 241, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '20px',
                    flexShrink: 0,
                }}>
                    <UploadCloud size={36} color="var(--primary-color)" />
                </div>
                <h2 style={{ fontSize: 'clamp(18px, 5vw, 24px)', marginBottom: '8px' }}>Upload your video</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: '20px', fontSize: 'clamp(13px, 3.5vw, 16px)' }}>
                    Drag and drop, or tap to browse
                </p>

                <button className="btn-primary" type="button">
                    <Video size={20} />
                    Select Video
                </button>

                <p style={{ color: 'var(--text-muted)', marginTop: '16px', fontSize: '12px' }}>
                    MP4, MOV, MKV, WebM and more · up to {formatBytes(MAX_VIDEO_BYTES)}
                </p>

                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="video/*"
                    style={{ display: 'none' }}
                />
            </div>

            {rejection && (
                <div
                    role="alert"
                    style={{
                        display: 'flex', alignItems: 'flex-start', gap: '10px',
                        maxWidth: '600px', width: '100%',
                        padding: '12px 16px', borderRadius: '12px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                    }}
                >
                    <AlertTriangle size={18} color="var(--error-color)" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span style={{ fontSize: '14px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                        {rejection}
                    </span>
                </div>
            )}
        </div>
    );
};

export default UploadScreen;
