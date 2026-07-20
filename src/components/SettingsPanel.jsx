import { Settings, X, Key, Sparkles, Zap, Eye, EyeOff } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { STORAGE_KEY_PROVIDER, STORAGE_KEYS, getSelectedProvider, hasProxy } from '../services/api_config';

const PROVIDERS = [
    { id: 'gemini', name: 'Gemini', icon: Sparkles, color: '#818cf8', description: 'Google Gemini Flash' },
    { id: 'groq', name: 'Groq', icon: Zap, color: '#f59e0b', description: 'Groq Whisper + Llama' },
];

const KEY_HELP_URLS = {
    gemini: 'https://aistudio.google.com/apikey',
    groq: 'https://console.groq.com/keys',
};

// ─── Settings Panel Component ───

const SettingsPanel = ({ isOpen, onClose }) => {
    const [provider, setProvider] = useState(getSelectedProvider);
    const [keys, setKeys] = useState({ gemini: '', groq: '' });
    const [showKey, setShowKey] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setProvider(getSelectedProvider());
            setKeys({
                gemini: localStorage.getItem(STORAGE_KEYS.gemini) || '',
                groq: localStorage.getItem(STORAGE_KEYS.groq) || '',
            });
            setShowKey(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSave = () => {
        // Safari private mode and hardened browser settings make localStorage
        // throw on write. Losing the preference is survivable; a crashed panel
        // that traps the user isn't.
        try {
            localStorage.setItem(STORAGE_KEY_PROVIDER, provider);
            for (const id of Object.keys(STORAGE_KEYS)) {
                const value = (keys[id] || '').trim();
                if (value) {
                    localStorage.setItem(STORAGE_KEYS[id], value);
                } else {
                    localStorage.removeItem(STORAGE_KEYS[id]);
                }
            }
        } catch {
            // Ignore — the app falls back to the shared proxy transport.
        }
        onClose();
    };

    const activeProvider = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];
    // No key pasted, but a proxy is configured — the app works out of the box on
    // the shared (rate-limited) quota.
    const usingSharedProxy = !keys[provider]?.trim() && hasProxy();

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
            }}
        >
            <div
                className="glass-panel animate-fade-in"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Settings"
                // The panel scrolls internally rather than overflowing: on a
                // short phone viewport (or with the keyboard open) the Save
                // button would otherwise sit off-screen and be unreachable.
                style={{
                    width: '100%', maxWidth: '440px',
                    padding: 'clamp(20px, 5vw, 32px)',
                    borderRadius: 'clamp(16px, 4vw, 24px)',
                    maxHeight: '85dvh',
                    overflowY: 'auto',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Settings size={22} color="var(--primary-color)" />
                        <h2 style={{ fontSize: '20px', fontWeight: '700' }}>Settings</h2>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close settings"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {usingSharedProxy ? (
                    <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: '8px',
                        padding: '10px 14px', marginBottom: '20px', borderRadius: '12px',
                        background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.4)',
                    }}>
                        <span style={{ fontSize: '16px', lineHeight: 1.4 }}>✅</span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#22c55e', lineHeight: 1.4 }}>
                            Shared quota active — works with no setup. Rate-limited;
                            add your own key below for unrestricted use.
                        </span>
                    </div>
                ) : !keys[provider]?.trim() && (
                    <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: '8px',
                        padding: '10px 14px', marginBottom: '20px', borderRadius: '12px',
                        background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.4)',
                    }}>
                        <span style={{ fontSize: '16px', lineHeight: 1.4 }}>🔑</span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#f59e0b', lineHeight: 1.4 }}>
                            An API key is required. Paste one below to start clipping.
                        </span>
                    </div>
                )}

                <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    AI Provider
                </p>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
                    {PROVIDERS.map((p) => {
                        const Icon = p.icon;
                        const selected = p.id === provider;
                        return (
                            <button
                                key={p.id}
                                onClick={() => { setProvider(p.id); setShowKey(false); }}
                                style={{
                                    flex: 1, padding: '14px 12px', borderRadius: '14px', cursor: 'pointer',
                                    background: selected ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                                    border: `1px solid ${selected ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                    color: 'inherit', textAlign: 'left',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <Icon size={18} color={p.color} />
                                    <span style={{ fontWeight: '600', fontSize: '15px' }}>{p.name}</span>
                                </div>
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{p.description}</span>
                            </button>
                        );
                    })}
                </div>

                <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    <Key size={12} style={{ marginRight: '6px', verticalAlign: '-1px' }} />
                    {activeProvider.name} API Key {usingSharedProxy && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span>}
                </p>
                <div style={{ position: 'relative', marginBottom: '8px' }}>
                    <input
                        className="trim-input"
                        type={showKey ? 'text' : 'password'}
                        value={keys[provider] || ''}
                        onChange={(e) => setKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
                        placeholder={`Paste your ${activeProvider.name} API key`}
                        autoComplete="off"
                        spellCheck={false}
                        style={{ width: '100%', paddingRight: '44px' }}
                    />
                    <button
                        onClick={() => setShowKey((v) => !v)}
                        aria-label={showKey ? 'Hide API key' : 'Show API key'}
                        style={{
                            position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px',
                        }}
                    >
                        {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '24px' }}>
                    {usingSharedProxy
                        ? "Using the app's shared quota — no setup needed. Paste your own key here to bypass rate limits; it stays in this browser and never reaches our servers."
                        : <>Stored only in this browser. Get a free key at{' '}
                            <a href={KEY_HELP_URLS[provider]} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)' }}>
                                {KEY_HELP_URLS[provider].replace('https://', '')}
                            </a>.
                        </>}
                </p>

                <button className="btn-primary" onClick={handleSave} style={{ width: '100%' }}>
                    Save
                </button>
            </div>
        </div>
    );
};

// ─── Settings Button (for navbar) ───
export const SettingsButton = () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                className="btn-secondary"
                onClick={() => setIsOpen(true)}
                aria-label="Open settings"
                style={{ padding: '10px 14px' }}
            >
                <Settings size={20} />
            </button>
            <SettingsPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
};

export default SettingsPanel;
