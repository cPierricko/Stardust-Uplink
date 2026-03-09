import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { API_BASE } from '../../config/constants';

export default function LoginScreen({ onLogin }) {
    const [searchParams] = useSearchParams();
    const isInvite = searchParams.get('token');
    const isConfig = searchParams.get('config');
    const [error, setError] = useState('');

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

                <h2 className="text-2xl font-bold text-empire-red mb-2 tracking-[0.3em]">RESTRICTED ACCESS</h2>
                <p className="text-xs text-gray-400 mb-12 tracking-widest font-mono">AUTHORIZED PERSONNEL ONLY</p>

                {error && <div className="text-empire-red text-xs mb-4 font-mono uppercase">{error}</div>}

                <button onClick={handleLogin} className="btn-primary text-[#00d4ff] border-[#00d4ff] bg-[#00d4ff]/10 w-full py-4 tracking-widest hover:bg-[#00d4ff]/30 transition-all duration-500 shadow-neon-cyan group relative overflow-hidden">
                    <span className="relative z-10 group-hover:block hidden absolute inset-0 bg-[#00d4ff]/20 blur-md"></span>
                    IDENTIFICATION BIOMÉTRIQUE
                </button>
            </motion.div>
        </div>
    );
}
