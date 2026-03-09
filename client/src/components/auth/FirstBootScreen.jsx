import { useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { API_BASE } from '../../config/constants';

export default function FirstBootScreen({ onComplete }) {
    const [token, setToken] = useState('');
    const [username, setUsername] = useState('admin');
    const [error, setError] = useState('');

    const handleSetup = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${API_BASE}/auth/generate-registration-options`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ setupToken: token, username })
            });

            if (!res.ok) throw new Error('Invalid token or setup failed');
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
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="cockpit-panel p-8 max-w-md w-full relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-2 bg-[repeating-linear-gradient(45deg,#ff003c,#ff003c_10px,transparent_10px,transparent_20px)] opacity-50"></div>
                <h2 className="text-xl font-bold text-empire-red mb-2 mt-2 tracking-widest">{'>>'} CRITICAL: FIRST BOOT</h2>
                <p className="text-xs text-gray-400 mb-6">REGISTER BIOMETRICS FOR ROOT ADMIN.</p>
                {error && <div className="text-empire-red text-xs mb-4">{error}</div>}
                <form onSubmit={handleSetup} className="flex flex-col gap-4">
                    <input type="text" className="input-field" placeholder="INITIAL_SETUP_TOKEN" value={token} onChange={e => setToken(e.target.value)} required />
                    <input type="text" className="input-field" placeholder="Admin Username" value={username} onChange={e => setUsername(e.target.value)} required />
                    <button type="submit" className="btn-primary w-full mt-4">ENROLL PASSKEY</button>
                </form>
            </div>
        </div>
    );
}
