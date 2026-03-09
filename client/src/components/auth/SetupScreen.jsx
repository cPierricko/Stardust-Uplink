import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { startRegistration } from '@simplewebauthn/browser';
import { API_BASE } from '../../config/constants';

export default function SetupScreen({ setupToken, onComplete }) {
    const [info, setInfo] = useState(null);
    const [error, setError] = useState('');
    const [customUsername, setCustomUsername] = useState('');

    useEffect(() => {
        fetch(`${API_BASE}/auth/setup-info?token=${setupToken}`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : Promise.reject('INVALID OR EXPIRED UPLINK TOKEN'))
            .then(setInfo)
            .catch(setError);
    }, [setupToken]);

    const handleSetup = async () => {
        try {
            const usernameToUse = info.username || customUsername;
            if (!usernameToUse) throw new Error('Operator ID required');

            const res = await fetch(`${API_BASE}/auth/generate-registration-options`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ setupToken, username: usernameToUse })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Uplink Setup failed');
            }
            const { options, userId } = await res.json();
            const attResp = await startRegistration(options);

            const vRes = await fetch(`${API_BASE}/auth/verify-registration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ userId, body: attResp })
            });

            if (!vRes.ok) throw new Error('Verification failed');
            onComplete();
        } catch (err) { setError(err.message); }
    };

    if (error) return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4">
            <div className="text-empire-red mb-4 font-mono">{'>>'} ERROR: {error}</div>
            <button onClick={() => window.location.reload()} className="btn-primary px-4 py-2">RETRY_UPLINK</button>
        </div>
    );
    if (!info) return <div className="min-h-screen flex items-center justify-center text-[#00d4ff] font-mono animate-pulse">VERIFYING UPLINK TOKEN...</div>;

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="cockpit-panel p-8 max-w-md w-full">
                <h2 className="text-xl font-bold text-[#00d4ff] tracking-widest mb-4 text-center">{'>>'} NEW OPERATOR ENROLLMENT</h2>

                {info.username ? (
                    <p className="text-sm text-gray-300 mb-8 font-mono tracking-wider text-center">
                        IDENTIFY AS <strong className="text-white">[{info.username}]</strong>
                    </p>
                ) : (
                    <div className="mb-8 space-y-4">
                        <label className="text-[10px] text-gray-500 tracking-widest uppercase font-bold">SET OPERATOR CALLSIGN</label>
                        <input
                            type="text"
                            className="input-field w-full py-3 bg-black/60 text-center uppercase tracking-[0.2em]"
                            placeholder="NAME_REQUIRED..."
                            value={customUsername}
                            onChange={e => setCustomUsername(e.target.value)}
                        />
                    </div>
                )}

                <button
                    onClick={handleSetup}
                    disabled={!info.username && !customUsername}
                    className="btn-primary w-full py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    REGISTER BIOMETRICS
                </button>
            </motion.div>
        </div>
    );
}

