import React, { useState } from 'react';
import UploadScreen from './components/UploadScreen';
import VideoImportedScreen from './components/VideoImportedScreen';
import ProcessingScreen from './components/ProcessingScreen';
import SuggestionsScreen from './components/SuggestionsScreen';
import ManualTrimScreen from './components/ManualTrimScreen';
import ExportingScreen from './components/ExportingScreen';
import ExportResultScreen from './components/ExportResultScreen';
import { SettingsButton } from './components/SettingsPanel';
import {
    DEFAULT_MIN_CLIP_SECONDS,
    clampMinClipSeconds,
    getVideoDuration,
} from './utils/clip_duration';

function App() {
    // States: UPLOAD, VIDEO_IMPORTED, PROCESSING, SUGGESTIONS, MANUAL_TRIM, EXPORTING, RESULT, ERROR
    const [state, setState] = useState('UPLOAD');
    const [videoFile, setVideoFile] = useState(null);
    const [highlights, setHighlights] = useState([]);
    const [trimConfig, setTrimConfig] = useState(null);
    const [selectedSuggestion, setSelectedSuggestion] = useState(null);
    const [exportedBlob, setExportedBlob] = useState(null);
    const [errorMessage, setErrorMessage] = useState("");
    const [minClipSeconds, setMinClipSeconds] = useState(DEFAULT_MIN_CLIP_SECONDS);
    const [videoDuration, setVideoDuration] = useState(null);

    const handleVideoSelected = async (file) => {
        setVideoFile(file);
        setVideoDuration(null);
        setState('VIDEO_IMPORTED');
        // Read metadata in the background — the screen renders without it and
        // fills in the length check once it resolves.
        setVideoDuration(await getVideoDuration(file));
    };

    const handleAnalyze = () => {
        // The button is disabled in this case; this is the belt-and-braces check.
        if (Number.isFinite(videoDuration) && videoDuration > 0 && videoDuration < minClipSeconds) {
            setErrorMessage(
                `This video is ${videoDuration.toFixed(1)}s long, which is shorter than the ` +
                `${minClipSeconds}s minimum clip length you selected. Lower the minimum or ` +
                `upload a longer video.`,
            );
            setState('ERROR');
            return;
        }
        setState('PROCESSING');
    };

    const handleSkipToManualTrim = () => {
        setSelectedSuggestion(null);
        setState('MANUAL_TRIM');
    };

    const handleProcessingComplete = (hl) => {
        setHighlights(hl);
        setState('SUGGESTIONS');
    };

    const handleTrimSuggestion = (clip) => {
        setSelectedSuggestion(clip);
        setState('MANUAL_TRIM');
    };

    const handleManualTrimFromSuggestions = () => {
        setSelectedSuggestion(null);
        setState('MANUAL_TRIM');
    };

    const handleExport = (start, end, title) => {
        setTrimConfig({ start, end, title });
        setState('EXPORTING');
    };

    const handleExportComplete = (blob) => {
        setExportedBlob(blob);
        setState('RESULT');
    };

    const handleError = (msg) => {
        setErrorMessage(msg);
        setState('ERROR');
    };

    const handleBackToSuggestions = () => {
        if (highlights.length > 0) {
            setState('SUGGESTIONS');
        } else {
            setState('VIDEO_IMPORTED');
        }
    };

    const handleStartOver = () => {
        setVideoFile(null);
        setHighlights([]);
        setTrimConfig(null);
        setSelectedSuggestion(null);
        setExportedBlob(null);
        setErrorMessage("");
        setVideoDuration(null);
        setState('UPLOAD');
    };

    return (
        <div className="app-shell">
            <nav className="app-nav">
                <div className="app-brand">CLIP <span style={{ color: 'var(--primary-color)' }}>MVP</span></div>
                <SettingsButton />
            </nav>

            <main className="app-main">
                {state === 'UPLOAD' && (
                    <UploadScreen onVideoSelected={handleVideoSelected} />
                )}

                {state === 'VIDEO_IMPORTED' && (
                    <VideoImportedScreen
                        videoFile={videoFile}
                        videoDuration={videoDuration}
                        minClipSeconds={minClipSeconds}
                        onMinClipSecondsChange={(v) => setMinClipSeconds(clampMinClipSeconds(v))}
                        onAnalyze={handleAnalyze}
                        onManualTrim={handleSkipToManualTrim}
                    />
                )}

                {state === 'PROCESSING' && (
                    <ProcessingScreen
                        videoFile={videoFile}
                        minClipSeconds={minClipSeconds}
                        videoDuration={videoDuration}
                        onProcessingComplete={handleProcessingComplete}
                        onError={handleError}
                    />
                )}

                {state === 'SUGGESTIONS' && (
                    <SuggestionsScreen
                        highlights={highlights}
                        videoFile={videoFile}
                        minClipSeconds={minClipSeconds}
                        onTrimSuggestion={handleTrimSuggestion}
                        onManualTrim={handleManualTrimFromSuggestions}
                    />
                )}

                {state === 'MANUAL_TRIM' && (
                    <ManualTrimScreen
                        videoFile={videoFile}
                        initialSuggestion={selectedSuggestion}
                        onExport={handleExport}
                        onBack={handleBackToSuggestions}
                    />
                )}

                {state === 'EXPORTING' && (
                    <ExportingScreen 
                        videoFile={videoFile} 
                        start={trimConfig.start} 
                        end={trimConfig.end} 
                        onComplete={handleExportComplete} 
                        onError={handleError} 
                    />
                )}

                {state === 'RESULT' && (
                    <ExportResultScreen 
                        videoBlob={exportedBlob} 
                        onBackToSuggestions={handleBackToSuggestions} 
                        onStartOver={handleStartOver} 
                    />
                )}

                {state === 'ERROR' && (
                    <div className="screen animate-fade-in">
                        <div className="glass-panel panel panel--narrow" style={{ textAlign: 'center' }}>
                            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
                                <span style={{ fontSize: '32px' }}>⚠️</span>
                            </div>
                            <h2 style={{ fontSize: 'clamp(20px, 5vw, 24px)', marginBottom: '16px', color: 'var(--error-color)' }}>Something went wrong</h2>
                            {/* overflowWrap stops long API error strings from
                                widening the panel past the viewport. */}
                            <p style={{ color: 'var(--text-muted)', marginBottom: '32px', overflowWrap: 'anywhere' }}>{errorMessage}</p>
                            <div className="btn-row">
                                <button className="btn-secondary" onClick={handleStartOver}>Try Again</button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
