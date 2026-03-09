import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { API_BASE } from '../../config/constants';

export default function DeploymentModule({ initialToken }) {
    const [appName, setAppName] = useState('');
    const [file, setFile] = useState(null);
    const [token, setToken] = useState(initialToken || '');
    const [status, setStatus] = useState('');
    const [progress, setProgress] = useState(0);
    const [isExpanded, setIsExpanded] = useState(false);


    const doDeploy = async () => {
        if (!file || !appName || !token) return setStatus('MISSING PARAMS');
        setStatus('ESTABLISHING UPLINK...');
        setProgress(10);

        const interval = setInterval(() => {
            setProgress(p => {
                if (p >= 90) {
                    clearInterval(interval);
                    return 90;
                }
                return p + Math.random() * 15;
            });
        }, 200);

        const fd = new FormData();
        fd.append('bundle', file);

        try {
            const res = await fetch(`${API_BASE}/deploy/${appName}`, {
                method: 'POST', headers: { 'x-deploy-token': token }, body: fd
            });
            clearInterval(interval);
            setProgress(100);
            setStatus(res.ok ? 'UPLINK SUCCESSFUL' : 'UPLINK FAILED');
        } catch (e) {
            clearInterval(interval);
            setProgress(0);
            setStatus('CONNECTION LOST');
        }
    };

    return (
        <div className="cockpit-panel border-cyan-dark hover:border-[#00d4ff]/50 transition-colors w-full overflow-hidden">
            <div
                className="flex justify-between items-center p-6 cursor-pointer hover:bg-[#00d4ff]/5 transition-colors group"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-4">
                    <div className="h-6 w-1 bg-[#00d4ff] group-hover:shadow-neon-cyan transition-shadow"></div>
                    <div>
                        <h2 className="text-lg font-bold text-[#00d4ff] tracking-[0.15em]">{'>>'} DATA_UPLINK_MODULE</h2>
                        <p className="text-[10px] text-gray-500 font-mono tracking-widest">{isExpanded ? 'EXPANDED_PROTOCOL_ACTIVE' : 'READY_FOR_ENGAGEMENT'}</p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    {status && (
                        <div className="hidden md:flex flex-col items-end">
                            <span className="text-[10px] text-[#00d4ff] font-mono animate-pulse">{status}</span>
                        </div>
                    )}
                    <div className="w-10 h-10 border border-[#00d4ff]/30 flex justify-center items-center relative overflow-hidden bg-[#003344]/10 group-hover:border-[#00d4ff]/60 transition-colors">
                        {isExpanded ? <ChevronUp size={20} className="text-[#00d4ff]" /> : <ChevronDown size={20} className="text-[#00d4ff]" />}
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.4, ease: [0.04, 0.62, 0.23, 0.98] }}
                    >
                        <div className="px-6 pb-6 pt-2 border-t border-[#00d4ff]/10">
                            <div className="flex flex-col lg:flex-row gap-6 items-end">
                                <div className="flex-1 w-full space-y-4">
                                    <div className="relative border border-dashed border-[#00d4ff]/40 bg-black/40 h-28 flex items-center justify-center text-xs text-gray-500 hover:border-[#00d4ff] hover:text-[#00d4ff] cursor-pointer transition-all w-full group/upload overflow-hidden">
                                        <input type="file" onChange={e => setFile(e.target.files[0])} accept=".zip" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                                        <div className="absolute inset-0 bg-[#00d4ff]/5 w-0 group-hover/upload:w-full transition-all duration-500 ease-out"></div>
                                        <span className="relative z-10 tracking-widest">{file ? `[ ${file.name} ]` : '[ DROP COMPILED SHARD .ZIP ]'}</span>
                                    </div>

                                    <div className="w-full bg-black/50 border border-cyan-dark h-4 relative">
                                        <div
                                            className="absolute top-0 left-0 bottom-0 bg-[#00d4ff] transition-all duration-300 shadow-neon-cyan"
                                            style={{ width: `${progress}%` }}
                                        ></div>
                                        <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white z-10 mix-blend-difference">
                                            {Math.round(progress)}%
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 w-full lg:w-48">
                                    <input type="text" value={appName} onChange={e => setAppName(e.target.value)} className="input-field text-xs py-2 bg-black/80" placeholder="SHARD_ID (e.g. comms)" />
                                    <input type="password" value={token} onChange={e => setToken(e.target.value)} className="input-field text-xs py-2 bg-black/80" placeholder="ACCESS_TOKEN" />
                                    <button onClick={doDeploy} className="btn-primary text-xs w-full py-2">INITIALIZE UPLINK</button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

