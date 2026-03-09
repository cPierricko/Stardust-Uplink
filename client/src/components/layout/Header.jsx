import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Power, Settings } from 'lucide-react';
import { API_BASE } from '../../config/constants';

const TelemetryBar = ({ label, value }) => (
    <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-mono text-cyan-800 uppercase tracking-tighter">{label}</span>
        <div className="flex gap-0.5">
            {[...Array(10)].map((_, i) => (
                <motion.div
                    key={i}
                    animate={{
                        opacity: i < value ? [0.4, 1, 0.4] : 1,
                        backgroundColor: i < value ? '#0891b2' : '#042f2e'
                    }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.05 }}
                    className="h-1.5 w-0.5 rounded-sm"
                />
            ))}
        </div>
    </div>
);

export default function Header({ user, onAdminOpen }) {
    const role = user?.role === 'administrator' ? 'ADMINISTRATOR' : 'OPERATOR';
    const username = user?.username || 'GUEST';

    const [cpu, setCpu] = useState(4);
    const [mem, setMem] = useState(7);

    useEffect(() => {
        const interval = setInterval(() => {
            setCpu(Math.floor(Math.random() * 5) + 2);
            setMem(Math.floor(Math.random() * 4) + 6);
        }, 2500);
        return () => clearInterval(interval);
    }, []);

    return (
        <motion.header
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="w-full grid grid-cols-3 items-center py-6 border-b border-cyan-950/60 mb-12 px-10 backdrop-blur-md bg-black/40 relative z-20"
        >
            {/* Left Col: SYSTEM STATUS */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_10px_#22c55e]"></div>
                    <span className="text-[10px] font-mono text-cyan-700 tracking-[0.2em] uppercase">[ RO_OS_v1.0 ]</span>
                </div>
                <div className="flex flex-col xl:flex-row gap-x-6 gap-y-1 opacity-80">
                    <TelemetryBar label="CPU" value={cpu} />
                    <TelemetryBar label="MEM" value={mem} />
                </div>
            </div>

            {/* Center Col: PROTOCOL NAME */}
            <div className="flex justify-center items-center">
                <div className="flex flex-col items-end">
                    <motion.div
                        animate={{ opacity: [0.7, 1, 0.7] }}
                        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                        className="flex items-center gap-4 text-cyan-400"
                    >
                        <span className="text-xs opacity-20 font-mono tracking-tighter">:: [</span>
                        <h1 className="text-xl md:text-2xl font-bold tracking-[0.5em] [text-shadow:0_0_20px_rgba(0,212,255,0.3)] uppercase whitespace-nowrap">
                            Rogue One Cloud
                        </h1>
                        <span className="text-xs opacity-20 font-mono tracking-tighter">] ::</span>
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.4 }}
                        className="text-[10px] font-mono text-cyan-500 tracking-[0.2em] uppercase mt-1 mr-8"
                    >
                        Protocole : Stardust Uplink
                    </motion.div>
                </div>
            </div>

            {/* Right Col: OPERATOR INFO */}
            <div className="flex items-center justify-end gap-6 h-full">
                <div className="flex items-center">
                    <div className="h-8 w-px bg-cyan-900/50"></div>
                    <div className="flex flex-col ml-4 items-end">
                        <span className="text-[9px] text-cyan-800 font-mono tracking-[0.2em] uppercase mb-0.5">EST_IDENTITY_SYNC</span>
                        <div className={`text-xs font-mono tracking-widest uppercase flex items-center gap-2 ${user?.role === 'administrator' ? 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'text-cyan-500'}`}>
                            <span className="opacity-30">|</span> {role}: {username}
                        </div>
                    </div>
                </div>

                <div className="flex gap-2">
                    {user?.role === 'administrator' && (
                        <div className="relative group">
                            <button
                                onClick={onAdminOpen}
                                className="relative border border-cyan-900 h-9 w-9 flex items-center justify-center hover:border-cyan-400/50 hover:bg-cyan-400/5 transition-all duration-300"
                                style={{ clipPath: 'polygon(20% 0%, 100% 0%, 100% 80%, 80% 100%, 0% 100%, 0% 20%)' }}
                            >
                                <Settings size={16} className="text-cyan-800 group-hover:text-cyan-400 transition-colors" />
                            </button>
                        </div>
                    )}

                    <div className="relative group">
                        <div className="absolute inset-0 bg-red-500/5 blur-md opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <button
                            onClick={() => {
                                fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).then(() => window.location.reload());
                            }}
                            className="relative border border-cyan-900 h-9 w-9 flex items-center justify-center hover:border-red-500/50 hover:bg-red-500/10 transition-all duration-300 group overflow-hidden"
                            style={{ clipPath: 'polygon(20% 0%, 100% 0%, 100% 80%, 80% 100%, 0% 100%, 0% 20%)' }}
                        >
                            <Power size={16} className="text-cyan-800 group-hover:text-red-500 transition-colors" />
                        </button>
                    </div>
                </div>
            </div>
        </motion.header>
    );
}
