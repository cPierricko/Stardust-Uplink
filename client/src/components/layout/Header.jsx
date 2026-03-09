import { motion } from 'framer-motion';
import { Activity, Settings, Power } from 'lucide-react';
import { API_BASE } from '../../config/constants';

export default function Header({ user, onAdminOpen }) {
    const role = user?.role === 'administrator' ? 'ADMINISTRATOR' : 'OPERATOR';
    const username = user?.username || 'GUEST';

    return (
        <motion.header
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="w-full max-w-6xl flex flex-col md:flex-row justify-between items-center md:items-end mb-10 border-b border-cyan-dark pb-4 gap-4"
        >
            <div className="flex items-center gap-3 text-xs md:text-sm text-gray-500 tracking-widest uppercase">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]"></div>
                ROGUE-ONE // SECURE_CONNECTION
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-[#00d4ff] tracking-[0.2em] drop-shadow-[0_0_12px_rgba(0,212,255,1)] flex items-center gap-3 text-center">
                <Activity className="animate-pulse" size={28} />
                STARDUST UPLINK
            </h1>

            <div className="flex items-center gap-6">
                <div className="flex flex-col text-right">
                    <span className="text-xs text-[#00d4ff] font-bold tracking-widest uppercase">{role}: {username}</span>
                </div>

                <div className="flex gap-2">
                    <button onClick={onAdminOpen} className="btn-primary p-2 flex items-center justify-center hover:bg-[#00d4ff]/20" title="Admin Settings">
                        <Settings size={18} />
                    </button>
                    <button onClick={() => {
                        fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).then(() => window.location.reload());
                    }} className="btn-danger p-2 flex items-center justify-center hover:bg-empire-red/20">
                        <Power size={18} />
                    </button>
                </div>
            </div>
        </motion.header>
    );
}
