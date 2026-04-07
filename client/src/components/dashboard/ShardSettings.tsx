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
    const [envVars, setEnvVars] = useState(shard.env_vars === '{}' ? '' : shard.env_vars);

    const [token, setToken] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [copied, setCopied] = useState(false);
    const [showWorkflow, setShowWorkflow] = useState(false);
    const [workflowCopied, setWorkflowCopied] = useState(false);
    const [backendStatus, setBackendStatus] = useState<{ status: string; port?: number } | null>(null);
    const [isRestarting, setIsRestarting] = useState(false);
    
    // New controls
    const [isStarting, setIsStarting] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [logs, setLogs] = useState<string>('');
    const [commandInput, setCommandInput] = useState<string>('');
    const [isExecuting, setIsExecuting] = useState(false);
    const [showLogs, setShowLogs] = useState(false);

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/status`, { credentials: 'include' });
            const data = await res.json();
            if (data.success) setBackendStatus({ status: data.status, port: data.port });
        } catch (err) {
            console.error('Failed to fetch shard status:', err);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, [shard.id]);

    useEffect(() => {
        // Fetch token on mount
        fetch(`${API_BASE}/shards/${shard.id}/token`, { credentials: 'include' })
            .then(async r => {
                if (!r.ok) throw new Error(`HTTP_STATUS_${r.status}`);
                return r.json();
            })
            .then(res => {
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
            // No longer forcing JSON - standard .env format (KEY=VALUE) is accepted


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
            const res = await fetch(`${API_BASE}/shards/${shard.id}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (!res.ok) {
                showNotification(`DELETE_FAIL_${res.status}`, 'error');
                setIsDeleting(false);
                setShowConfirmDelete(false);
                return;
            }

            const data = await res.json();
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
            console.error('[ShardSettings] Delete error:', err);
            showNotification(`SYS_ERROR: ${err.message}`, 'error');
            setIsDeleting(false);
            setShowConfirmDelete(false);
        }
    };

    const handleRestart = async () => {
        setIsRestarting(true);
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/restart`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                showNotification('SHARD_RESTARTED');
                fetchStatus();
            } else {
                showNotification(data.error || 'RESTART_FAILED', 'error');
            }
        } catch (err) {
            showNotification('SYSTEM_ERROR', 'error');
        } finally {
            setIsRestarting(false);
        }
    };

    const handleStart = async () => {
        setIsStarting(true);
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/start`, { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                showNotification('SHARD_STARTED');
                fetchStatus();
            } else showNotification(data.error || 'START_FAILED', 'error');
        } catch { showNotification('SYSTEM_ERROR', 'error'); } finally { setIsStarting(false); }
    };

    const handleStop = async () => {
        setIsStopping(true);
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/stop`, { method: 'POST', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                showNotification('SHARD_STOPPED');
                fetchStatus();
            } else showNotification(data.error || 'STOP_FAILED', 'error');
        } catch { showNotification('SYSTEM_ERROR', 'error'); } finally { setIsStopping(false); }
    };

    const handleCommand = async () => {
        if (!commandInput) return;
        setIsExecuting(true);
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: commandInput }),
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success) {
                showNotification('COMMAND_EXECUTED');
                setCommandInput('');
                fetchLogs();
            } else showNotification(data.error || 'COMMAND_FAILED', 'error');
        } catch { showNotification('SYSTEM_ERROR', 'error'); } finally { setIsExecuting(false); }
    };

    const handleClearLogs = async () => {
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/logs`, { method: 'DELETE', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                setLogs('');
                showNotification('LOGS_CLEARED');
            } else {
                showNotification(data.error || 'CLEAR_FAILED', 'error');
            }
        } catch (e) {
            showNotification('SYSTEM_ERROR', 'error');
        }
    };

    const fetchLogs = async () => {
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/logs`, { credentials: 'include' });
            const data = await res.json();
            if (data.success) setLogs(data.logs);
        } catch (e) {
            console.error('Failed to fetch logs', e);
        }
    };

    useEffect(() => {
        if (showLogs) {
            fetchLogs();
            const logInterval = setInterval(fetchLogs, 5000);
            return () => clearInterval(logInterval);
        }
    }, [showLogs, shard.id]);

    const handleWipeDatabase = async () => {
        if (!window.confirm("WARNING: This will instantly DELETE the sqlite.db instance. Are you sure?")) return;
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/database`, { method: 'DELETE', credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                showNotification(data.message || 'DATABASE_WIPED');
                fetchStatus();
            } else showNotification(data.error || 'WIPE_FAILED', 'error');
        } catch { showNotification('SYSTEM_ERROR', 'error'); }
    };

    const [workflowType, setWorkflowType] = useState<'frontend' | 'fullstack'>(shard.has_backend ? 'fullstack' : 'frontend');

    const workflowFrontend = `name: Stardust Deploy — Frontend
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
      - name: Push to Stardust
        run: |
          cd dist && zip -qr ../deploy.zip . && cd ..
          curl -f -sS -X POST "\${{ secrets.STARDUST_API_URL }}/api/shards/push" \\
            -H "X-Stardust-Token: \${{ secrets.STARDUST_SHARD_TOKEN }}" \\
            -F "app=@deploy.zip"`;

    const workflowFullstack = `name: Stardust Deploy — Full-Stack
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
      - run: npm run build --if-present
      - name: Push to Stardust
        run: |
          zip -qr deploy.zip . -x ".git/*" ".github/*" "node_modules/*" "src/*" ".env*"
          curl -f -sS -X POST "\${{ secrets.STARDUST_API_URL }}/api/shards/push" \\
            -H "X-Stardust-Token: \${{ secrets.STARDUST_SHARD_TOKEN }}" \\
            -F "app=@deploy.zip"`;

    const workflowTemplate = workflowType === 'frontend' ? workflowFrontend : workflowFullstack;

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
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className={`absolute top-0 left-0 right-0 z-[100] px-4 py-3 font-mono text-[9px] tracking-[0.3em] border-b shadow-2xl flex items-center justify-center gap-3 backdrop-blur-xl ${
                            notification.type === 'error' 
                                ? 'text-[#ff003c] border-[#ff003c]/40 bg-[#ff003c]/20' 
                                : 'text-emerald-400 border-emerald-500/40 bg-emerald-500/20'
                        }`}
                        style={{ textShadow: '0 0 10px rgba(0,0,0,0.5)' }}
                    >
                        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${notification.type === 'error' ? 'bg-[#ff003c]' : 'bg-emerald-400'}`}></div>
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
                        placeholder="KEY=VALUE
ANOTHER_KEY=VALUE"
                        className="w-full h-32 bg-black/40 border border-cyan-900/30 p-2 text-cyan-400 font-mono text-[10px] focus:outline-none focus:border-cyan-500/40 transition-all resize-none"

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

                {/* Shard Backend Control */}
                <div className="pt-2 border-t border-cyan-900/20 space-y-2">
                    <label className="text-[9px] font-mono text-cyan-900 tracking-widest uppercase flex items-center gap-2">
                        <Cpu size={10} /> SHARD_BACKEND_STATUS
                    </label>
                    <div className="flex items-center justify-between p-2 bg-black/40 border border-cyan-900/30">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-mono text-cyan-400 flex items-center gap-2 uppercase">
                                <span className={`w-1.5 h-1.5 rounded-full ${backendStatus?.status === 'running' ? 'bg-[#00d4ff] shadow-neon-cyan' : 'bg-gray-600'}`}></span>
                                {backendStatus?.status || 'CHECKING...'}
                            </span>
                            {backendStatus?.port && (
                                <span className="text-[8px] text-cyan-800 font-mono">INTERNAL_PORT: {backendStatus.port}</span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2 justify-end">
                            <button
                                onClick={handleStart}
                                disabled={isStarting || backendStatus?.status === 'running' || backendStatus?.status === 'no_backend'}
                                className="px-3 py-1 border border-cyan-500/40 text-cyan-500 font-mono text-[8px] tracking-widest hover:bg-cyan-500/10 transition-all uppercase disabled:opacity-20"
                            >
                                {isStarting ? '...' : 'START'}
                            </button>
                            <button
                                onClick={handleStop}
                                disabled={isStopping || backendStatus?.status !== 'running'}
                                className="px-3 py-1 border border-amber-500/40 text-amber-500 font-mono text-[8px] tracking-widest hover:bg-amber-500/10 transition-all uppercase disabled:opacity-20"
                            >
                                {isStopping ? '...' : 'STOP'}
                            </button>
                            <button
                                onClick={handleRestart}
                                disabled={isRestarting || backendStatus?.status === 'no_backend'}
                                className="px-3 py-1 border border-cyan-500/40 text-cyan-500 font-mono text-[8px] tracking-widest hover:bg-cyan-500/10 transition-all uppercase disabled:opacity-20"
                            >
                                {isRestarting ? 'REBOOTING...' : 'RESTART'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Shard Terminal & Logs */}
                <div className="pt-2 border-t border-cyan-900/20">
                    <button
                        onClick={() => setShowLogs(!showLogs)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-cyan-950/20 border border-cyan-900/30 text-cyan-500 font-mono text-[9px] tracking-widest hover:bg-cyan-500/5 transition-all uppercase"
                    >
                        <span className="flex items-center gap-2"><Terminal size={12} /> Standard_Output_Feed</span>
                        {showLogs ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                    
                    <AnimatePresence>
                        {showLogs && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="p-3 bg-black/40 border-x border-b border-cyan-900/30 space-y-4">
                                    <div className="relative group/logs">
                                        <div className="absolute top-2 right-2 flex opacity-0 group-hover/logs:opacity-100 transition-opacity">
                                            <button 
                                                onClick={handleClearLogs}
                                                className="p-1.5 bg-black/80 border border-cyan-900/50 text-cyan-700 hover:text-red-400 hover:bg-cyan-900/30 transition-colors"
                                                title="Clear Logs"
                                            >
                                                <Trash2 size={10} />
                                            </button>
                                        </div>
                                        <pre className="w-full h-48 bg-black/80 border border-cyan-900/30 p-2 text-cyan-400 font-mono text-[9px] overflow-y-auto custom-scrollbar">
                                            {logs || 'WAITING_FOR_DATA...'}
                                        </pre>
                                    </div>
                                    
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={commandInput}
                                            onChange={(e) => setCommandInput(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleCommand(); }}
                                            placeholder="NPM_COMMAND"
                                            className="flex-1 bg-black/60 border border-cyan-900/40 text-cyan-400 font-mono text-[9px] px-2 py-1.5 focus:outline-none focus:border-cyan-500/50"
                                            disabled={isExecuting}
                                        />
                                        <button
                                            onClick={handleCommand}
                                            disabled={isExecuting || !commandInput}
                                            className="px-3 py-1.5 border border-cyan-500/40 text-cyan-500 font-mono text-[8px] tracking-widest hover:bg-cyan-500/10 transition-all uppercase disabled:opacity-20"
                                        >
                                            {isExecuting ? '...' : 'EXEC'}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
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
                                <div className="p-3 bg-black/40 border-x border-b border-cyan-900/30 space-y-4">
                                    <div className="space-y-3">
                                        <p className="text-[8px] text-cyan-800 leading-relaxed font-mono uppercase tracking-widest border-b border-cyan-900/20 pb-1">
                                            REQUIRED_GITHUB_SECRETS
                                        </p>
                                        
                                        {/* Secret 1: URL */}
                                        <div className="space-y-1">
                                            <div className="flex justify-between items-center text-[7px] font-mono text-cyan-700">
                                                <div className="flex items-center gap-1">
                                                    <span>NAME: STARDUST_API_URL</span>
                                                    <button 
                                                        onClick={() => {
                                                            navigator.clipboard.writeText('STARDUST_API_URL');
                                                            showNotification('NAME_COPIED');
                                                        }}
                                                        className="hover:text-cyan-400 opacity-50 hover:opacity-100 transition-opacity"
                                                        title="Copy Secret Name"
                                                    >
                                                        <Copy size={7} />
                                                    </button>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(window.location.origin);
                                                        showNotification('URL_COPIED');
                                                    }}
                                                    className="hover:text-cyan-400 flex items-center gap-1"
                                                >
                                                    <span className="text-[6px] uppercase opacity-50">Copy Value</span>
                                                    <Copy size={8} />
                                                </button>
                                            </div>
                                            <div className="p-1.5 bg-cyan-950/20 border border-cyan-900/20 text-cyan-500 font-mono text-[8px] truncate">
                                                {window.location.origin}
                                            </div>
                                        </div>

                                        {/* Secret 2: Token */}
                                        <div className="space-y-1">
                                            <div className="flex justify-between items-center text-[7px] font-mono text-cyan-700">
                                                <div className="flex items-center gap-1">
                                                    <span>NAME: STARDUST_SHARD_TOKEN</span>
                                                    <button 
                                                        onClick={() => {
                                                            navigator.clipboard.writeText('STARDUST_SHARD_TOKEN');
                                                            showNotification('NAME_COPIED');
                                                        }}
                                                        className="hover:text-cyan-400 opacity-50 hover:opacity-100 transition-opacity"
                                                        title="Copy Secret Name"
                                                    >
                                                        <Copy size={7} />
                                                    </button>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        if (token) {
                                                            navigator.clipboard.writeText(token);
                                                            showNotification('TOKEN_COPIED');
                                                        }
                                                    }}
                                                    className="hover:text-cyan-400 flex items-center gap-1"
                                                >
                                                    <span className="text-[6px] uppercase opacity-50">Copy Value</span>
                                                    <Copy size={8} />
                                                </button>
                                            </div>
                                            <div className="p-1.5 bg-cyan-950/20 border border-cyan-900/20 text-cyan-500 font-mono text-[8px] truncate">
                                                {token || 'RETRIEVING...'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2 pt-2 border-t border-cyan-900/20">
                                        {/* Template type toggle */}
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => setWorkflowType('frontend')}
                                                className={`flex-1 py-1 font-mono text-[8px] tracking-widest border transition-all uppercase ${workflowType === 'frontend' ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-400' : 'border-cyan-900/30 text-cyan-800 hover:text-cyan-600'}`}
                                            >
                                                Frontend Only
                                            </button>
                                            <button
                                                onClick={() => setWorkflowType('fullstack')}
                                                className={`flex-1 py-1 font-mono text-[8px] tracking-widest border transition-all uppercase ${workflowType === 'fullstack' ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-400' : 'border-cyan-900/30 text-cyan-800 hover:text-cyan-600'}`}
                                            >
                                                Full-Stack
                                            </button>
                                        </div>
                                        <p className="text-[7px] text-cyan-900 font-mono">
                                            {workflowType === 'frontend'
                                                ? '→ Zips dist/ only. Requires npm run build in your project.'
                                                : '→ Zips all files (no node_modules). Stardust runs npm install server-side.'}
                                        </p>
                                        <p className="text-[8px] text-cyan-800 leading-relaxed font-mono">
                                            WORKFLOW_FILE_PATH: <br/>
                                            <span className="text-cyan-600">.github/workflows/deploy.yml</span>
                                        </p>
                                        <pre className="p-2 bg-black/60 text-[7px] text-cyan-400 font-mono overflow-x-auto custom-scrollbar border border-cyan-900/20 leading-tight h-36">
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
                    
                    <button
                        onClick={handleWipeDatabase}
                        className="w-full mt-2 py-1.5 border border-amber-500/30 text-amber-500 font-mono text-[8px] tracking-widest hover:bg-amber-500/10 transition-all uppercase"
                    >
                        <Trash2 size={10} className="inline mr-2" /> WIPE SQLITE.DB
                    </button>
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
