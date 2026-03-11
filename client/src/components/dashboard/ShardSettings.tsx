import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Save, Copy, Check, X, Terminal, AlertTriangle, Cpu, ChevronDown, ChevronUp } from 'lucide-react';
import { API_BASE } from '../../config/constants';
import { Shard, ApiResponse } from '../../../../shared/types';

interface ShardSettingsProps {
    shard: Shard;
    onClose: () => void;
    onUpdate: () => void;
    onDelete: () => void;
}

export default function ShardSettings({ shard, onClose, onUpdate, onDelete }: ShardSettingsProps) {
    const [envVars, setEnvVars] = useState(shard.env_vars);
    const [token, setToken] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [copied, setCopied] = useState(false);
    const [showWorkflow, setShowWorkflow] = useState(false);
    const [workflowCopied, setWorkflowCopied] = useState(false);

    useEffect(() => {
        // Fetch token on mount
        fetch(`${API_BASE}/shards/${shard.id}/token`, { credentials: 'include' })
            .then(async r => {
                if (!r.ok) throw new Error(`HTTP_STATUS_${r.status}`);
                return r.json();
            })
            .then(res => {
                console.log(`[DEBUG] Token fetch for ${shard.name}:`, res);
                if (res.success) setToken(res.api_token);
                else setToken('ERROR_RETRIEVING');
            })
            .catch(err => {
                console.error('Failed to fetch token:', err);
                setToken('AUTH_OR_SYSTEM_FAIL');
            });
    }, [shard.id, shard.name]);

    const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 3000);
    };

    const handleSaveEnv = async () => {
        setIsSaving(true);
        try {
            // Validate JSON
            try {
                JSON.parse(envVars);
            } catch (e) {
                showNotification('INVALID_JSON_FORMAT', 'error');
                setIsSaving(false);
                return;
            }

            const res = await fetch(`${API_BASE}/shards/${shard.id}/env`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ env_vars: envVars }),
                credentials: 'include'
            });

            const data = await res.json();
            if (data.success) {
                showNotification('ENVIRONMENT_UPDATED');
                onUpdate();
            } else {
                showNotification(data.error || 'UPDATE_FAILED', 'error');
            }
        } catch (err) {
            showNotification('SYSTEM_ERROR', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            console.log(`[DEBUG] Initiating delete for shard: ${shard.id}`);
            const res = await fetch(`${API_BASE}/shards/${shard.id}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!res.ok) {
                const text = await res.text();
                console.error(`[DEBUG] Delete failed with status ${res.status}:`, text);
                showNotification(`DELETE_FAIL_${res.status}`, 'error');
                setIsDeleting(false);
                setShowConfirmDelete(false);
                return;
            }

            const data = await res.json();
            console.log(`[DEBUG] Delete response:`, data);
            if (data.success) {
                showNotification('SHARD_DELETED_SUCCESSFULLY');
                setTimeout(() => {
                    onDelete();
                    onClose();
                }, 1000);
            } else {
                showNotification(data.error || 'DELETE_FAILED', 'error');
                setIsDeleting(false);
                setShowConfirmDelete(false);
            }
        } catch (err: any) {
            console.error('[DEBUG] Delete system error:', err);
            showNotification(`SYS_ERROR: ${err.message}`, 'error');
            setIsDeleting(false);
            setShowConfirmDelete(false);
        }
    };

    const copyToken = () => {
        if (token) {
            navigator.clipboard.writeText(token);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const workflowTemplate = `name: Stardust Shard Deploy
on:
  push:
    branches: [ main ]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - name: Package & Push
        run: |
          cd dist && zip -r ../deploy.zip . && cd ..
          curl -X POST "\${{ secrets.STARDUST_API_URL }}/api/shards/push" \\
            -H "X-Stardust-Token: \${{ secrets.STARDUST_SHARD_TOKEN }}" \\
            -F "app=@deploy.zip"`;

    const copyWorkflow = () => {
        navigator.clipboard.writeText(workflowTemplate);
        setWorkflowCopied(true);
        setTimeout(() => setWorkflowCopied(false), 2000);
    };

    return (
        <div className="flex flex-col gap-4 p-4 bg-[#0a0f18]/90 backdrop-blur-md border border-cyan-900/50 h-full overflow-y-auto custom-scrollbar relative">
            {/* Notifications (Self-contained) */}
            <AnimatePresence>
                {notification && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className={`absolute top-2 left-2 right-2 z-20 px-4 py-2 font-mono text-[8px] tracking-[0.2em] border shadow-lg ${
                            notification.type === 'error' ? 'text-[#ff003c] border-[#ff003c] bg-[#ff003c]/10' : 'text-emerald-500 border-emerald-500 bg-emerald-500/10'
                        }`}
                    >
                        {notification.message.toUpperCase()}
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex justify-between items-center border-b border-cyan-900/30 pb-2">
                <h2 className="text-cyan-500 font-mono text-[10px] tracking-[0.2em] uppercase flex items-center gap-2">
                    <Terminal size={12} /> MGMT_SESSION: {shard.name}
                </h2>
                <button 
                    onClick={onClose} 
                    className="text-cyan-800 hover:text-cyan-400 transition-colors"
                >
                    <X size={16} />
                </button>
            </div>

            <div className="space-y-4 flex-1">
                {/* Env Vars */}
                <div className="space-y-2">
                    <label className="text-[9px] font-mono text-cyan-900 tracking-widest uppercase flex items-center gap-2">
                        <Terminal size={10} /> ENVIRONMENT_VARS
                    </label>
                    <textarea
                        value={envVars}
                        onChange={(e) => setEnvVars(e.target.value)}
                        className="w-full h-24 bg-black/40 border border-cyan-900/30 p-2 text-cyan-400 font-mono text-[10px] focus:outline-none focus:border-cyan-500/40 transition-all resize-none"
                        spellCheck={false}
                    />
                    <button
                        onClick={handleSaveEnv}
                        disabled={isSaving}
                        className="w-full flex items-center justify-center gap-2 py-2 bg-cyan-500/5 border border-cyan-500/40 text-cyan-500 font-mono text-[9px] tracking-widest hover:bg-cyan-500/10 transition-all uppercase disabled:opacity-30"
                    >
                        {isSaving ? 'SYNCING...' : <><Save size={12} /> COMMIT_CHANGES</>}
                    </button>
                </div>

                {/* Deployment Token */}
                <div className="space-y-2">
                    <label className="text-[9px] font-mono text-cyan-900 tracking-widest uppercase flex items-center gap-2">
                        <Copy size={10} /> API_TOKEN
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            readOnly
                            value={token || 'RETRIEVING...'}
                            className="flex-1 bg-cyan-950/10 border border-cyan-900/20 px-3 py-1.5 text-cyan-700 font-mono text-[9px] tracking-wider outline-none"
                        />
                        <button
                            onClick={copyToken}
                            disabled={!token}
                            className="px-3 py-1.5 border border-cyan-800 text-cyan-500 hover:bg-cyan-500/10 transition-all flex items-center gap-2 disabled:opacity-20"
                        >
                            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            <span className="text-[8px] font-mono tracking-widest uppercase">Copy</span>
                        </button>
                    </div>
                </div>

                {/* Automation Help */}
                <div className="pt-2 border-t border-cyan-900/20">
                    <button
                        onClick={() => setShowWorkflow(!showWorkflow)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-cyan-950/20 border border-cyan-900/30 text-cyan-500 font-mono text-[9px] tracking-widest hover:bg-cyan-500/5 transition-all uppercase"
                    >
                        <span className="flex items-center gap-2"><Cpu size={12} /> Github_Actions_Setup</span>
                        {showWorkflow ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    
                    <AnimatePresence>
                        {showWorkflow && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="p-3 bg-black/40 border-x border-b border-cyan-900/30 space-y-3">
                                    <p className="text-[8px] text-cyan-800 leading-relaxed font-mono">
                                        COPY_PASTE WORKFLOW INTO: <br/>
                                        <span className="text-cyan-600">.github/workflows/deploy.yml</span>
                                    </p>
                                    <pre className="p-2 bg-black/60 text-[7px] text-cyan-400 font-mono overflow-x-auto custom-scrollbar border border-cyan-900/20 leading-tight">
                                        {workflowTemplate}
                                    </pre>
                                    <button
                                        onClick={copyWorkflow}
                                        className="w-full py-1.5 border border-cyan-800 text-cyan-500 text-[8px] font-mono tracking-widest hover:bg-cyan-500/10 flex items-center justify-center gap-2 uppercase"
                                    >
                                        {workflowCopied ? <Check size={10} /> : <Copy size={10} />}
                                        {workflowCopied ? 'Template_Copied' : 'Copy_Yaml_Template'}
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Danger Zone */}
                <div className="pt-2 border-t border-red-900/20">
                    {!showConfirmDelete ? (
                        <button
                            onClick={() => setShowConfirmDelete(true)}
                            className="w-full py-2 border border-red-500/30 text-red-500 font-mono text-[9px] tracking-widest hover:bg-red-500/10 transition-all uppercase"
                        >
                            <Trash2 size={12} className="inline mr-2" /> Delete Shard
                        </button>
                    ) : (
                        <div className="flex flex-col gap-2 animate-in fade-in duration-300">
                            <span className="text-red-500 font-mono text-[8px] tracking-widest text-center flex items-center justify-center gap-2">
                                <AlertTriangle size={12} className="animate-pulse" /> CONFIRM_PURGE?
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="flex-1 py-1.5 bg-red-600/80 text-white font-mono text-[9px] tracking-widest hover:bg-red-500 transition-all uppercase disabled:opacity-50"
                                >
                                    {isDeleting ? 'PURGING...' : 'EXECUTE'}
                                </button>
                                <button
                                    onClick={() => setShowConfirmDelete(false)}
                                    className="flex-1 py-1.5 border border-gray-800 text-gray-500 font-mono text-[9px] tracking-widest hover:text-white transition-colors"
                                >
                                    ABORT
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 2px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(0, 212, 255, 0.1);
                }
            `}</style>
        </div>
    );
}
