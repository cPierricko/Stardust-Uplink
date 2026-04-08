import { useState, ChangeEvent, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Radio, HardDrive, Cpu, Terminal, Github } from 'lucide-react';
import { API_BASE } from '../../config/constants';
import { DeploymentStatus, ApiResponse, ShardUploadResponse } from '../../../../shared/types';

export interface DeploymentModuleProps {
    initialToken?: string;
    onSuccess?: (shard: ShardUploadResponse) => void;
}

export default function DeploymentModule({ initialToken, onSuccess }: DeploymentModuleProps) {
    const [callsign, setCallsign] = useState<string>('');
    const [routingSlug, setRoutingSlug] = useState<string>('');
    const [file, setFile] = useState<File | null>(null);
    const [gitUrl, setGitUrl] = useState<string>('');
    const [status, setStatus] = useState<string>('');
    const [progress, setProgress] = useState<number>(0);
    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const [deploymentState, setDeploymentState] = useState<DeploymentStatus>('idle');

    // Auto-generate slug from callsign
    useEffect(() => {
        const slug = callsign
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        setRoutingSlug(slug);
    }, [callsign]);

    const doDeploy = async () => {
        if (!callsign || !routingSlug) {
            console.warn('[UPLINK] Missing required parameters:', { callsign, routingSlug });
            setStatus('UPLINK_ERROR: MISSING_PARAMETERS');
            setDeploymentState('error');
            return;
        }

        setDeploymentState('uploading');
        setStatus('ESTABLISHING UPLINK...');
        setProgress(5);

        const interval = setInterval(() => {
            setProgress(p => {
                if (p >= 95) {
                    clearInterval(interval);
                    return 95;
                }
                return p + Math.random() * 5;
            });
        }, 150);

        const fd = new FormData();
        if (file) {
            fd.append('app', file);
            fd.append('deploy_method', 'manual');
        } else if (gitUrl) {
            fd.append('gitUrl', gitUrl);
            fd.append('deploy_method', 'auto'); // Auto satisfies the database constraint
        } else {
            // Case for Shell / Empty Shard
            fd.append('deploy_method', 'manual');
        }

        fd.append('name', callsign);
        fd.append('slug', routingSlug);

        try {
            const res = await fetch(`${API_BASE}/shards/upload`, {
                method: 'POST',
                body: fd
            });

            const result: ApiResponse<ShardUploadResponse> = await res.json();

            clearInterval(interval);

            if (res.ok && result.success && result.data) {
                setProgress(100);
                setDeploymentState('completed');
                setStatus(`UPLINK_COMPLETE: ${routingSlug.toUpperCase()} ACTIVE`);
                if (onSuccess) onSuccess(result.data);
            } else {
                setProgress(0);
                setDeploymentState('error');
                setStatus(result.error || 'UPLINK_CRITICAL_FAILURE');
            }
        } catch (e) {
            clearInterval(interval);
            setProgress(0);
            setDeploymentState('error');
            setStatus('SIGNAL_LOST: CONNECTION_INTERRUPTED');
        }
    };

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
            setGitUrl(''); // Clear alternative
            if (!callsign) {
                const name = e.target.files[0].name.replace('.zip', '');
                setCallsign(name);
            }
        }
    };

    const handleGitUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
        const url = e.target.value;
        setGitUrl(url);
        if (url) {
            setFile(null); // Clear alternative
            if (!callsign) {
                // Try to extract repo name from github URL
                try {
                    const parts = url.split('/');
                    const repoName = parts[parts.length - 1].replace('.git', '');
                    if (repoName) setCallsign(repoName);
                } catch { }
            }
        }
    };

    const resetForm = () => {
        setCallsign('');
        setRoutingSlug('');
        setFile(null);
        setGitUrl('');
        setDeploymentState('idle');
        setStatus('');
        setProgress(0);
    };

    const isError = deploymentState === 'error';
    const isSuccess = deploymentState === 'completed';
    const isProcessing = deploymentState === 'uploading' || deploymentState === 'extracting';

    const accentColor = isError ? 'text-[#ff1a1a]' : isProcessing ? 'text-amber-500' : isSuccess ? 'text-emerald-500' : 'text-cyan-500';
    const borderColor = isError ? 'border-[#ff1a1a]/40' : isProcessing ? 'border-amber-500/40' : isSuccess ? 'border-emerald-500/40' : 'border-cyan-950';

    return (
        <div className={`cockpit-panel ${borderColor} hover:border-cyan-400/30 transition-all duration-500 w-full overflow-hidden bg-black/40 backdrop-blur-md border`}>
            {/* Header */}
            <div
                className="flex justify-between items-center px-6 py-4 cursor-pointer hover:bg-cyan-400/5 transition-colors group"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-6">
                    <div className="relative">
                        <Radio size={20} className={`${accentColor} transition-all duration-500 ${isExpanded ? 'rotate-0 opacity-100' : 'rotate-[-90deg] opacity-60'}`} />
                        {isProcessing && (
                            <div className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full animate-ping opacity-60"></div>
                        )}
                        {isError && (
                            <div className="absolute -top-1 -right-1 w-2 h-2 bg-[#ff1a1a] rounded-full animate-pulse opacity-80"></div>
                        )}
                    </div>

                    <div className="flex flex-col">
                        <span className="text-[10px] font-mono text-cyan-800 tracking-[0.3em] uppercase group-hover:text-cyan-600 transition-colors">
                            {isExpanded ? 'SYS_UPLINK_EXPANDED' : 'UPLINK_STANDBY'}
                        </span>
                        {status && (
                            <motion.span
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={`text-[9px] ${accentColor} font-mono tracking-widest uppercase mt-0.5`}
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
                        <div className="px-6 pb-6 pt-2 border-t border-cyan-900/10">
                            {isSuccess ? (
                                <motion.div 
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="py-12 flex flex-col items-center justify-center space-y-6 text-center"
                                >
                                    <div className="w-16 h-16 border border-emerald-500/40 bg-emerald-500/5 flex items-center justify-center relative">
                                        <div className="absolute inset-0 animate-pulse bg-emerald-500/10"></div>
                                        <HardDrive className="text-emerald-500" size={32} />
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-emerald-500 font-mono text-xs tracking-[0.4em] uppercase">Uplink Successful</h3>
                                        <p className="text-cyan-800 font-mono text-[10px] tracking-widest">SHARD [{routingSlug.toUpperCase()}] IS NOW BROADCASTING</p>
                                    </div>
                                    <button 
                                        onClick={resetForm}
                                        className="px-8 py-2 bg-cyan-950/20 border border-cyan-800 text-cyan-500 text-[9px] font-mono tracking-[0.3em] hover:bg-cyan-500/10 hover:border-cyan-400 transition-all uppercase"
                                    >
                                        Establish New Connection
                                    </button>
                                </motion.div>
                            ) : (
                                <div className="space-y-6 mt-4">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        {/* Left Side: Inputs */}
                                        <div className="space-y-4">
                                            <div className="group/input">
                                                <label className="text-[9px] font-mono text-cyan-900 tracking-widest uppercase mb-1.5 block group-focus-within/input:text-cyan-500 transition-colors flex items-center gap-2">
                                                    <Terminal size={10} /> CALLSIGN_ID
                                                </label>
                                                <input 
                                                    type="text" 
                                                    value={callsign} 
                                                    onChange={(e) => setCallsign(e.target.value)} 
                                                    disabled={isProcessing}
                                                    className="w-full bg-black/60 border border-cyan-900/30 text-cyan-400 text-[11px] py-2.5 px-4 font-mono focus:outline-none focus:border-cyan-500/50 transition-all tracking-widest disabled:opacity-50" 
                                                    placeholder="APP_NAME" 
                                                />
                                            </div>

                                            <div className="group/input">
                                                <label className="text-[9px] font-mono text-cyan-900 tracking-widest uppercase mb-1.5 block group-focus-within/input:text-cyan-500 transition-colors flex items-center gap-2">
                                                    <Cpu size={10} /> ROUTING_SLUG
                                                </label>
                                                <input 
                                                    type="text" 
                                                    value={routingSlug} 
                                                    readOnly
                                                    className="w-full bg-cyan-400/5 border border-cyan-900/20 text-cyan-600 text-[11px] py-2.5 px-4 font-mono focus:outline-none transition-all tracking-widest cursor-not-allowed" 
                                                    placeholder="auto-generated-slug" 
                                                />
                                            </div>
                                        </div>

                                        {/* Right Side: File Upload or Git Link */}
                                        <div className="flex flex-col h-full justify-between gap-4">
                                            <div className="flex-1 space-y-4">
                                                <div>
                                                    <label className="text-[9px] font-mono text-cyan-900 tracking-widest uppercase mb-1.5 block">DATA_BUNDLE_PACKAGE</label>
                                                    <div className="relative border border-dashed border-cyan-900/40 bg-black/40 h-[70px] flex flex-col items-center justify-center text-[10px] text-cyan-900 font-mono hover:border-cyan-400/60 hover:text-cyan-400/80 cursor-pointer transition-all w-full group/upload overflow-hidden"
                                                        style={{ clipPath: 'polygon(2% 0%, 100% 0%, 100% 85%, 98% 100%, 0% 100%, 0% 15%)' }}>
                                                        <input 
                                                            type="file" 
                                                            onChange={handleFileChange} 
                                                            accept=".zip" 
                                                            disabled={isProcessing}
                                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                                                        />
                                                        <div className="absolute inset-0 bg-cyan-400/5 w-0 group-hover/upload:w-full transition-all duration-700 ease-out"></div>
                                                        <span className="relative z-10 tracking-[0.2em] px-4 text-center">
                                                            {file ? `[ SHARD: ${file.name.toUpperCase()} ]` : '[ SELECT DATA SHARD .ZIP ]'}
                                                        </span>
                                                    </div>
                                                </div>
                                                
                                                <div className="relative flex items-center py-1">
                                                    <div className="flex-grow border-t border-cyan-900/30"></div>
                                                    <span className="flex-shrink-0 mx-4 text-cyan-900 text-[10px] font-mono">OR</span>
                                                    <div className="flex-grow border-t border-cyan-900/30"></div>
                                                </div>

                                                <div className="group/input">
                                                    <label className="text-[9px] font-mono text-cyan-900 tracking-widest uppercase mb-1.5 block group-focus-within/input:text-cyan-500 transition-colors flex items-center gap-2">
                                                        <Github size={10} /> PUBLIC_GIT_REPO
                                                    </label>
                                                    <input 
                                                        type="text" 
                                                        value={gitUrl} 
                                                        onChange={handleGitUrlChange} 
                                                        disabled={isProcessing}
                                                        className="w-full bg-black/60 border border-cyan-900/30 text-cyan-400 text-[11px] py-2 px-4 font-mono focus:outline-none focus:border-cyan-500/50 transition-all tracking-widest disabled:opacity-50" 
                                                        placeholder="https://github.com/user/repo" 
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-3 mt-4">
                                                <div className="w-full bg-cyan-950/10 border border-cyan-900/30 h-1.5 relative overflow-hidden">
                                                    <motion.div
                                                        className={`absolute top-0 left-0 bottom-0 ${isError ? 'bg-[#ff1a1a]' : 'bg-cyan-500'} shadow-[0_0_10px_rgba(6,182,212,0.3)]`}
                                                        animate={{ width: `${progress}%` }}
                                                        transition={{ duration: 0.5 }}
                                                    ></motion.div>
                                                </div>

                                                <button
                                                    onClick={doDeploy}
                                                    disabled={isProcessing || !callsign}
                                                    className={`w-full py-3 ${isProcessing ? 'bg-amber-500/10 border-amber-500 text-amber-500' : 'bg-[#ff1a1a]/5 border-[#ff1a1a]/40 text-[#ff1a1a] hover:bg-[#ff1a1a]/10 hover:border-[#ff1a1a]'} border text-[10px] font-mono tracking-[0.4em] transition-all duration-500 uppercase disabled:opacity-20 disabled:cursor-not-allowed`}
                                                >
                                                    {isProcessing ? (
                                                        <span className="flex items-center justify-center gap-2">
                                                            <span className="w-1 h-1 bg-current animate-bounce"></span>
                                                            <span className="w-1 h-1 bg-current animate-bounce [animation-delay:0.2s]"></span>
                                                            <span className="w-1 h-1 bg-current animate-bounce [animation-delay:0.4s]"></span>
                                                            TRANSF_INITIATED
                                                        </span>
                                                    ) : (file || gitUrl) ? 'Execute Uplink' : 'Initialize Shell'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <style>{`
                .cockpit-panel {
                    clip-path: polygon(
                        0 15px,
                        15px 0,
                        100% 0,
                        100% calc(100% - 15px),
                        calc(100% - 15px) 100%,
                        0 100%
                    );
                }
            `}</style>
        </div>
    );
}
