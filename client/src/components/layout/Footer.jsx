import { motion } from 'framer-motion';
import { Terminal } from 'lucide-react';

export default function Footer() {
    return (
        <motion.footer
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
            className="mt-12 w-full max-w-6xl flex flex-col gap-2"
        >
            <div className="cockpit-panel p-3 flex items-center gap-3 text-xs w-full bg-black/80 border-t-0 shadow-[inset_0_4px_20px_rgba(0,0,0,0.5)]">
                <Terminal size={14} className="text-[#00d4ff] animate-pulse" />
                <span className="text-gray-400 font-mono typing-anim">{'>'} WAITING FOR NEW DATA PACKET...</span>
            </div>
            <div className="flex justify-between text-[10px] text-gray-600 font-mono tracking-widest px-2">
                <span>ROGUE ONE CLOUD © 2026 // ALL SYSTEMS NOMINAL</span>
                <span>SECURE SHARD: 0x9F41C</span>
            </div>
        </motion.footer>
    );
}
