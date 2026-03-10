import { useState, ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Radio } from 'lucide-react';
import { API_BASE } from '../../config/constants';
import { DeploymentStatus, ApiResponse } from '../../../../shared/types';

export interface DeploymentModuleProps {
    initialToken?: string;
}

export default function DeploymentModule({ initialToken }: DeploymentModuleProps) {
    const [appName, setAppName] = useState<string>('');
    const [file, setFile] = useState<File | null>(null);
    const [token, setToken] = useState<string>(initialToken || '');
    const [status, setStatus] = useState<string>('');
    const [progress, setProgress] = useState<number>(0);
    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [deploymentState, setDeploymentState] = useState<DeploymentStatus>('idle');


    const doDeploy = async () => {
        if (!file || !appName || !token) {
            setStatus('MISSING PARAMS');
            return;
        }

        setDeploymentState('uploading');
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
        fd.append('app', file); // Changed from 'bundle' to 'app' to match server/routes/deploy.ts

        try {
            const res = await fetch(`${API_BASE}/deploy/upload`, {
                method: 'POST',
                headers: {
                    'x-deploy-token': token
                },
                body: fd
            });

            const result: ApiResponse<{ url: string }> = await res.json();

            clearInterval(interval);

            if (res.ok && result.success) {
                setProgress(100);
                setDeploymentState('completed');
                setStatus('UPLINK SUCCESSFUL');
            } else {
                setProgress(0);
                setDeploymentState('error');
                setStatus(result.error || 'UPLINK FAILED');
            }
        } catch (e) {
            clearInterval(interval);
            setProgress(0);
            setDeploymentState('error');
            setStatus('CONNECTION LOST');
        }
    };

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const handleAppNameChange = (e: ChangeEvent<HTMLInputElement>) => {
        setAppName(e.target.value);
    };

    const handleTokenChange = (e: ChangeEvent<HTMLInputElement>) => {
        setToken(e.target.value);
    };

    return (
        <div className="cockpit-panel border-cyan-950 hover:border-cyan-400/30 transition-all duration-500 w-full overflow-hidden bg-black/20 backdrop-blur-sm">
            <div
                className="flex justify-between items-center px-6 py-4 cursor-pointer hover:bg-cyan-400/5 transition-colors group"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-6">
                    <div className="relative">
                        <Radio size={20} className={`text-cyan-500 transition-all duration-500 ${isExpanded ? 'rotate-0 opacity-100' : 'rotate-[-90deg] opacity-60'}`} />
                        {!isExpanded && (
                            <div className="absolute -top-1 -right-1 w-2 h-2 bg-cyan-500 rounded-full animate-ping opacity-40"></div>
                        )}
                    </div>

                    <div className="flex flex-col">
                        <span className="text-[10px] font-mono text-cyan-800 tracking-[0.3em] uppercase group-hover:text-cyan-600 transition-colors">
                            {isExpanded ? 'SYS_UPLINK_EXPANDED' : 'UPLINK_STANDBY'}
                        </span>
                        {status && (
                            <motion.span
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-[9px] text-cyan-400 font-mono tracking-widest uppercase mt-0.5"
                            >
                                {status}
                            </motion.span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="w-8 h-8 border border-cyan-900/30 flex justify-center items-center relative overflow-hidden bg-cyan-950/20 group-hover:border-cyan-400/40 transition-colors"
                        style={{ clipPath: 'polygon(15% 0%, 100% 0%, 100% 85%, 85% 100%, 0% 100%, 0% 15%)' }}>
                        {isExpanded ? <ChevronUp size={16} className="text-cyan-700" /> : <ChevronDown size={16} className="text-cyan-700" />}
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
                        <div className="px-6 pb-6 pt-2 border-t border-cyan-900/20">
                            <div className="flex flex-col lg:flex-row gap-8 items-end">
                                <div className="flex-1 w-full space-y-4">
                                    <div className="relative border border-dashed border-cyan-900/40 bg-black/40 h-24 flex items-center justify-center text-[10px] text-cyan-900 font-mono hover:border-cyan-400/60 hover:text-cyan-400/80 cursor-pointer transition-all w-full group/upload overflow-hidden"
                                        style={{ clipPath: 'polygon(2% 0%, 100% 0%, 100% 90%, 98% 100%, 0% 100%, 0% 10%)' }}>
                                        <input type="file" onChange={handleFileChange} accept=".zip" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                                        <div className="absolute inset-0 bg-cyan-400/5 w-0 group-hover/upload:w-full transition-all duration-700 ease-out"></div>
                                        <span className="relative z-10 tracking-[0.2em]">{file ? `[ SHARD: ${file.name.toUpperCase()} ]` : '[ SELECT DATA SHARD .ZIP ]'}</span>
                                    </div>

                                    <div className="w-full bg-cyan-950/10 border border-cyan-900/30 h-1.5 relative overflow-hidden">
                                        <motion.div
                                            className="absolute top-0 left-0 bottom-0 bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]"
                                            animate={{ width: `${progress}%` }}
                                            transition={{ duration: 0.5 }}
                                        ></motion.div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 w-full lg:w-56">
                                    <input type="text" value={appName} onChange={handleAppNameChange} className="bg-black/80 border border-cyan-900/50 text-cyan-400 text-[10px] py-2 px-3 font-mono focus:outline-none focus:border-cyan-400/50 transition-colors tracking-widest" placeholder="SHARD_IDENTIFIER" />
                                    <input type="password" value={token} onChange={handleTokenChange} className="bg-black/80 border border-cyan-900/50 text-cyan-400 text-[10px] py-2 px-3 font-mono focus:outline-none focus:border-cyan-400/50 transition-colors tracking-widest" placeholder="UPLINK_CIPHER" />
                                    <button
                                        onClick={doDeploy}
                                        disabled={deploymentState === 'uploading' || deploymentState === 'extracting'}
                                        className="w-full py-2 bg-cyan-950/30 border border-cyan-800 text-cyan-500 text-[9px] font-mono tracking-[0.3em] hover:bg-cyan-500/10 hover:border-cyan-400 hover:text-cyan-400 transition-all duration-300 uppercase disabled:opacity-50"
                                    >
                                        {deploymentState === 'uploading' || deploymentState === 'extracting' ? 'Uplink active...' : 'Initialize Uplink'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>

    );
}
