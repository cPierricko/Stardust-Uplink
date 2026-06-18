import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, ExternalLink, Terminal, AlertTriangle, Loader2 } from 'lucide-react';
import { Shard } from '../../../../shared/types';
import ShardSettings from './ShardSettings';
import { API_BASE } from '../../config/constants';

export interface AppShardProps {
    shard: Shard;
    onAccess: (shard: Shard) => void;
    onUpdate: () => void;
    onDelete: () => void;
    user: any;
}

export default function AppShard({ shard, onAccess, onUpdate, onDelete, user }: AppShardProps) {
    const [showSettings, setShowSettings] = useState(false);
    const [showLogs, setShowLogs] = useState(false);
    const [showUnderConstruction, setShowUnderConstruction] = useState(false);
    const [logsContent, setLogsContent] = useState('');
    const logsEndRef = useRef<HTMLDivElement>(null);

    const status = shard.status || 'READY'; 

    // Auto-refresh logs when viewing
    useEffect(() => {
        if (!showLogs) return;

        // 1. Fonction pour charger l'historique initial
        const fetchHistory = async () => {
            try {
                const res = await fetch(`${API_BASE}/shards/${shard.slug}/logs?t=${Date.now()}`, { credentials: 'include' });
                const text = await res.text();
                if (text && text !== "NO_LOGS_AVAILABLE") {
                    setLogsContent(text);
                }
            } catch (e) {
                console.error("Erreur chargement historique:", e);
            }
        };

        fetchHistory();

        // 2. Initialisation du Stream SSE
        const eventSource = new EventSource(`${API_BASE}/shards/${shard.slug}/logs/stream`);

        eventSource.onmessage = (event) => {
            const newLine = event.data;
            console.log("DEBUG: Nouvelle ligne reçue via SSE:", newLine);
            setLogsContent(prev => {
                const newLogs = prev === "NO_LOGS_AVAILABLE" || !prev ? newLine : prev + "\n" + newLine;
                return newLogs.split('\n').slice(-200).join('\n');
            });
        };

        eventSource.onerror = (err) => {
            console.error("Erreur Stream SSE:", err);
            eventSource.close();
        };

        return () => eventSource.close();
    }, [shard.slug, showLogs]);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logsContent]);

    const handleAccess = (e: any) => {
        e.preventDefault();
        if (status === 'BUILDING') {
            setShowUnderConstruction(true);
            return;
        }
        onAccess(shard);
    };

    return (
        <div className="relative group/card h-full min-h-[220px]">
            <motion.div 
                whileHover={{ scale: 1.02 }} 
                className="shard-card h-full group transition-all duration-500 flex flex-col"
            >
                <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-[#00d4ff]/50 group-hover:border-[#00d4ff] transition-colors"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-dark group-hover:border-[#00d4ff]/80 transition-colors"></div>

                <div className="flex justify-between items-start mb-2">
                    <h3 className="text-sm font-bold text-white tracking-widest filter drop-shadow-[0_0_2px_#fff]">{'>>'} SHARD: {shard.name}</h3>
                    <div className="flex gap-2">
                        {user?.role === 'administrator' && (
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowSettings(true);
                                }}
                                className="p-1.5 border border-cyan-900/30 text-cyan-800 hover:text-cyan-400 hover:border-cyan-400/50 transition-all bg-cyan-950/20"
                            >
                                <Settings size={14} />
                            </button>
                        )}
                    </div>
                </div>
                <div className="w-full h-[1px] bg-gradient-to-r from-[#00d4ff]/50 to-transparent mb-4"></div>

                <div className="flex flex-col gap-2 text-xs text-gray-400 mb-6 flex-1">
                    <div className="flex justify-between items-center bg-black/40 p-2 rounded border border-cyan-900/30">
                        <span>CONNECTION:</span>
                        {status === 'BUILDING' && (
                            <span className="text-blue-400 font-bold flex items-center gap-2">
                                <Loader2 size={12} className="animate-spin" /> BUILDING
                            </span>
                        )}
                        {(status === 'READY' || status === 'DEPLOYED') && (
                            <span className="text-green-400 font-bold flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_#4ade80]"></span> STABLE_UPLINK
                            </span>
                        )}
                        {status === 'FAILED' && (
                            <span className="text-red-500 font-bold flex items-center gap-2">
                                <AlertTriangle size={12} /> CRITICAL_ERROR
                            </span>
                        )}
                    </div>
                    
                    <div className="flex justify-between items-center px-2">
                        <span>MOUNT_POINT:</span>
                        <span className="text-gray-300 font-mono">/mnt/{shard.slug}</span>
                    </div>

                    {(status === 'BUILDING' || status === 'FAILED') && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowLogs(true);
                            }}
                            className={`mt-2 flex items-center justify-center gap-2 p-1.5 text-[10px] tracking-widest font-bold border transition-colors ${
                                status === 'FAILED' 
                                ? 'text-red-400 border-red-500/30 bg-red-950/20 hover:bg-red-900/40' 
                                : 'text-blue-400 border-blue-500/30 bg-blue-950/20 hover:bg-blue-900/40'
                            }`}
                        >
                            <Terminal size={12} /> VIEW_BUILD_LOGS
                        </button>
                    )}
                </div>

                <button 
                    onClick={handleAccess}
                    className={`btn-primary text-[10px] w-full py-2 flex items-center justify-center gap-2 tracking-[0.2em] uppercase ${
                        status === 'BUILDING' ? 'opacity-50 cursor-wait' : 'group-hover:bg-[#00d4ff]/20'
                    }`}
                >
                    <ExternalLink size={12} /> Access Shard
                </button>
            </motion.div>

            {/* LOGS MODAL */}
            <AnimatePresence>
                {showLogs && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
                        onClick={() => setShowLogs(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 10 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            className="w-full max-w-3xl h-[70vh] flex flex-col bg-[#0a0f18] border border-cyan-500/30 shadow-2xl shadow-cyan-900/20 relative"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex justify-between items-center p-4 border-b border-cyan-dark/50 bg-black/40">
                                <h3 className="text-cyan-400 font-mono tracking-widest flex items-center gap-2">
                                    <Terminal size={16} /> BUILD_CONSOLE // {shard.slug.toUpperCase()}
                                </h3>
                                <button onClick={() => setShowLogs(false)} className="text-gray-400 hover:text-white pb-1 border-b border-transparent hover:border-white transition-all text-xs tracking-widest">
                                    [CLOSE_TERMINAL]
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed text-gray-300 bg-black/60 custom-scrollbar log-container">
                                <pre className="text-xs font-mono p-4 overflow-x-auto whitespace-pre-wrap">
                                    {logsContent === "NO_LOGS_AVAILABLE" || !logsContent ? "Aucun log disponible pour le moment..." : logsContent}
                                </pre>
                                <div ref={logsEndRef} />
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* UNDER CONSTRUCTION MODAL */}
            <AnimatePresence>
                {showUnderConstruction && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[110] bg-black/90 flex flex-col items-center justify-center p-4"
                        onClick={() => setShowUnderConstruction(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            className="flex flex-col items-center text-center"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="w-24 h-24 mb-6 relative">
                                <div className="absolute inset-0 border-4 border-t-[#00d4ff] border-r-[#00d4ff]/30 border-b-[#00d4ff]/10 border-l-[#00d4ff]/60 rounded-full animate-spin"></div>
                                <div className="absolute inset-2 border-4 border-l-orange-500 border-r-orange-500/20 border-t-transparent border-b-transparent rounded-full animate-[spin_2s_reverse_infinite]"></div>
                                <div className="absolute inset-0 flex items-center justify-center text-[#00d4ff]">
                                    <Loader2 size={32} className="animate-pulse" />
                                </div>
                            </div>
                            
                            <h2 className="text-2xl font-bold tracking-[0.3em] text-white mb-2 filter drop-shadow-[0_0_5px_#00d4ff]">
                                SHARD UNDER CONSTRUCTION
                            </h2>
                            <p className="text-cyan-400/80 font-mono text-sm max-w-md tracking-wider">
                                UPLINK INITIATED. WAITING FOR DEPLOYMENT SEQUENCE TO COMPLETE BEFORE ROUTING TRAFFIC.
                            </p>
                            
                            <button
                                onClick={() => setShowUnderConstruction(false)}
                                className="mt-12 text-xs font-mono tracking-widest text-gray-500 hover:text-white transition-colors border border-gray-800 hover:border-gray-500 px-6 py-2"
                            >
                                [ ACKNOWLEDGE ]
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* SETTINGS MODAL */}
            <AnimatePresence>
                {showSettings && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) setShowSettings(false);
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden relative shadow-2xl shadow-cyan-900/20"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <ShardSettings 
                                shard={shard} 
                                user={user}
                                onClose={() => setShowSettings(false)} 
                                onUpdate={onUpdate}
                                onDelete={onDelete}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
