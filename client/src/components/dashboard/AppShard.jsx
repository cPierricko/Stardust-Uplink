import { motion } from 'framer-motion';

export default function AppShard({ title = 'COMMS_HUB', mountPoint = '/mnt/comms_hub' }) {
    return (
        <motion.div whileHover={{ scale: 1.02 }} className="shard-card group cursor-pointer">
            <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-[#00d4ff]/50 group-hover:border-[#00d4ff] transition-colors"></div>
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-dark group-hover:border-[#00d4ff]/80 transition-colors"></div>

            <h3 className="text-sm font-bold text-white mb-2 tracking-widest filter drop-shadow-[0_0_2px_#fff]">{'>>'} SHARD: {title}</h3>
            <div className="w-full h-[1px] bg-gradient-to-r from-[#00d4ff]/50 to-transparent mb-4"></div>

            <div className="flex flex-col gap-2 text-xs text-gray-400 mb-6 flex-1">
                <div className="flex justify-between items-center">
                    <span>CONNECTION:</span>
                    <span className="text-[#00d4ff] font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] shadow-neon-cyan"></span> STABLE
                    </span>
                </div>
                <div className="flex justify-between items-center">
                    <span>MOUNT_POINT:</span>
                    <span className="text-gray-300 font-mono">{mountPoint}</span>
                </div>
            </div>

            <button className="btn-primary text-xs w-full py-2 group-hover:bg-[#00d4ff]/20">ACCESS SHARD</button>
        </motion.div>
    );
}
