import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, ExternalLink } from 'lucide-react';
import { Shard } from '../../../../shared/types';
import ShardSettings from './ShardSettings';

export interface AppShardProps {
    shard: Shard;
    onAccess: (shard: Shard) => void;
    onUpdate: () => void;
    onDelete: () => void;
}

export default function AppShard({ shard, onAccess, onUpdate, onDelete }: AppShardProps) {
    const [showSettings, setShowSettings] = useState(false);
    const status = 'STABLE'; 
    
    return (
        <div className="relative group/card h-full min-h-[220px]">
            <motion.div 
                whileHover={{ scale: showSettings ? 1 : 1.02 }} 
                className={`shard-card h-full group cursor-pointer transition-all duration-500 ${showSettings ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                onClick={() => onAccess(shard)}
            >
                <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-[#00d4ff]/50 group-hover:border-[#00d4ff] transition-colors"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-dark group-hover:border-[#00d4ff]/80 transition-colors"></div>

                <div className="flex justify-between items-start mb-2">
                    <h3 className="text-sm font-bold text-white tracking-widest filter drop-shadow-[0_0_2px_#fff]">{'>>'} SHARD: {shard.name}</h3>
                    <div className="flex gap-2">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowSettings(true);
                            }}
                            className="p-1.5 border border-cyan-900/30 text-cyan-800 hover:text-cyan-400 hover:border-cyan-400/50 transition-all bg-cyan-950/20"
                        >
                            <Settings size={14} />
                        </button>
                    </div>
                </div>
                <div className="w-full h-[1px] bg-gradient-to-r from-[#00d4ff]/50 to-transparent mb-4"></div>

                <div className="flex flex-col gap-2 text-xs text-gray-400 mb-6 flex-1">
                    <div className="flex justify-between items-center">
                        <span>CONNECTION:</span>
                        <span className="text-[#00d4ff] font-bold flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${status === 'STABLE' ? 'bg-[#00d4ff] shadow-neon-cyan' : status === 'UNSTABLE' ? 'bg-orange-500 shadow-neon-orange' : 'bg-red-500'} `}></span> {status}
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span>MOUNT_POINT:</span>
                        <span className="text-gray-300 font-mono">/mnt/{shard.slug}</span>
                    </div>
                </div>

                <button className="btn-primary text-[10px] w-full py-2 group-hover:bg-[#00d4ff]/20 flex items-center justify-center gap-2 tracking-[0.2em] uppercase">
                    <ExternalLink size={12} /> Access Shard
                </button>
            </motion.div>

            <AnimatePresence>
                {showSettings && (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="absolute inset-0 z-10 bg-[#0a0f18]"
                    >
                        <ShardSettings 
                            shard={shard} 
                            onClose={() => setShowSettings(false)} 
                            onUpdate={onUpdate}
                            onDelete={onDelete}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
