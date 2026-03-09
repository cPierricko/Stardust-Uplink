import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { API_BASE } from '../../config/constants';

export default function LoginScreen({ onLogin }) {
    const [searchParams] = useSearchParams();
    const isInvite = searchParams.get('token');
    const isConfig = searchParams.get('config');

    const [needsSetup, setNeedsSetup] = useState(false);
    const [setupToken, setSetupToken] = useState('');
    const [username, setUsername] = useState('admin');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${API_BASE}/auth/status`, { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
                setNeedsSetup(data.needsSetup);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const handleLogin = async () => {
        try {
            const res = await fetch(`${API_BASE}/auth/generate-authentication-options`, { credentials: 'include' });
            const options = await res.json();
            const asseResp = await startAuthentication(options);

            const vRes = await fetch(`${API_BASE}/auth/verify-authentication`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ body: asseResp })
            });

            if (!vRes.ok) throw new Error('Biometric check failed');
            onLogin();
        } catch (err) { setError(err.message); }
    };

    const handleSetup = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${API_BASE}/auth/generate-registration-options`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ setupToken, username })
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
            onLogin();
        } catch (err) { setError(err.message); }
    };

    if (loading) return null;

    return (
        <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute inset-0 bg-black opacity-90"></div>

            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="cockpit-panel p-12 max-w-md w-full z-10 text-center border-empire-red/30 shadow-neon-red">
                {(isInvite || isConfig) && (
                    <div className="mb-6 py-1 px-3 border border-[#00d4ff]/30 bg-[#00d4ff]/5 text-[10px] text-[#00d4ff] font-mono tracking-widest animate-pulse">
                        {isInvite ? ' [ OPERATOR_SETUP_TOKEN_DETECTED ]' : ' [ DEPLOYMENT_CIPHER_DETECTED ]'}
                    </div>
                )}


                <div className="w-20 h-20 border-2 border-empire-red mx-auto mb-6 flex justify-center items-center rotate-45 relative">
                    <div className="absolute inset-2 border border-empire-red/50 -rotate-45"></div>
                    <span className="text-empire-red -rotate-45 block font-bold text-3xl animate-pulse">!</span>
                </div>

                <h2 className="text-2xl font-bold text-empire-red mb-2 tracking-[0.3em] uppercase">
                    {needsSetup ? 'Initial Setup' : 'Restricted Access'}
                </h2>
                <p className="text-xs text-gray-400 mb-12 tracking-widest font-mono uppercase">
                    {needsSetup ? 'Register Root Administrator' : 'Authorized Personnel Only'}
                </p>

                {error && <div className="text-empire-red text-xs mb-4 font-mono uppercase border border-empire-red/30 p-2 bg-empire-red/5">{error}</div>}

                {needsSetup ? (
                    <form onSubmit={handleSetup} className="flex flex-col gap-4">
                        <input
                            type="text"
                            className="input-field bg-black/60 border-empire-red/30 focus:border-empire-red text-center tracking-widest"
                            placeholder="SETUP_TOKEN_REQUIRED"
                            value={setupToken}
                            onChange={e => setSetupToken(e.target.value)}
                            required
                        />
                        <input
                            type="text"
                            className="input-field bg-black/60 border-empire-red/30 focus:border-empire-red text-center tracking-widest"
                            placeholder="ADMIN_CALLSIGN"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                        />
                        <button type="submit" className="btn-primary text-empire-red border-empire-red bg-empire-red/10 w-full py-4 tracking-widest hover:bg-empire-red/30 transition-all duration-500 shadow-neon-red">
                            INITIALIZE SYSTEM
                        </button>
                    </form>
                ) : (
                    <button onClick={handleLogin} className="btn-primary text-[#00d4ff] border-[#00d4ff] bg-[#00d4ff]/10 w-full py-4 tracking-widest hover:bg-[#00d4ff]/30 transition-all duration-500 shadow-neon-cyan group relative overflow-hidden">
                        <span className="relative z-10 group-hover:block hidden absolute inset-0 bg-[#00d4ff]/20 blur-md"></span>
                        IDENTIFICATION BIOMÉTRIQUE
                    </button>
                )}
            </motion.div>
        </div>
    );
}
