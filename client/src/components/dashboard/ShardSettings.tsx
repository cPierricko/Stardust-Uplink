import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Save, Copy, Check, X, Terminal, AlertTriangle, Cpu, ChevronDown, ChevronUp, Layers, GitBranch, Globe, ShieldOff, Plus, Zap, Users } from 'lucide-react';
import { API_BASE } from '../../config/constants';
import { Shard, ApiResponse } from '../../../../shared/types';

interface ShardSettingsProps {
    shard: Shard;
    user: any;
    onClose: () => void;
    onUpdate: () => void;
    onDelete: () => void;
}

export default function ShardSettings({ shard, user, onClose, onUpdate, onDelete }: ShardSettingsProps) {
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
    const [isLiveMode, setIsLiveMode] = useState(true);
    const [logFilter, setLogFilter] = useState<'all' | 'stdout' | 'stderr'>('all');
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Compose
    const [composeServices, setComposeServices] = useState<string[]>([]);
    const [composeMainService, setComposeMainService] = useState<string>(shard.compose_main_service || '');
    const [isSavingCompose, setIsSavingCompose] = useState(false);

    // Public routes
    const [publicRoutes, setPublicRoutes] = useState<any[]>([]);
    const [showPublicRoutes, setShowPublicRoutes] = useState(false);
    const [newRoute, setNewRoute] = useState({ path_pattern: '', method: '*', rate_limit_rpm: 60, description: '' });
    const [isAddingRoute, setIsAddingRoute] = useState(false);
    const [isCreatingRoute, setIsCreatingRoute] = useState(false);

    // User Access
    const [operators, setOperators] = useState<any[]>([]);
    const [showAccess, setShowAccess] = useState(false);
    const [selectedOperator, setSelectedOperator] = useState<string>('');

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/status`, { credentials: 'include' });
            const data = await res.json();
            if (data.success) setBackendStatus({ status: data.status, port: data.port });
        } catch (err) {
            console.error('Failed to fetch shard status:', err);
        }
    };

    const fetchComposeServices = async () => {
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/compose-services`, { credentials: 'include' });
            const data = await res.json();
            if (data.success && data.compose_mode) {
                setComposeServices(data.services || []);
                if (!composeMainService && data.compose_main_service) {
                    setComposeMainService(data.compose_main_service);
                }
            }
        } catch (err) {
            console.error('Failed to fetch compose services:', err);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, [shard.id]);

    useEffect(() => {
        if (shard.compose_mode) fetchComposeServices();
    }, [shard.id, shard.compose_mode]);

    const fetchPublicRoutes = async () => {
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/public-routes`, { credentials: 'include' });
            const data = await res.json();
            if (data.success) setPublicRoutes(data.data || []);
        } catch {}
    };

    useEffect(() => {
        if (showPublicRoutes) fetchPublicRoutes();
    }, [showPublicRoutes, shard.id]);

    const fetchOperators = async () => {
        if (user?.role !== 'administrator') return;
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/access`, { credentials: 'include' });
            const data = await res.json();
            if (data.success) setOperators(data.data);
        } catch (err) {
            console.error('Failed to fetch operators', err);
        }
    };

    useEffect(() => {
        if (showAccess) fetchOperators();
    }, [showAccess, shard.id]);

    const handleGrantAccess = async () => {
        if (!selectedOperator) return;
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/access`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: selectedOperator }),
                credentials: 'include'
            });
            if (res.ok) {
                fetchOperators();
                setSelectedOperator('');
                showNotification('Accès accordé');
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleRevokeAccess = async (userId: string) => {
        try {
            const res = await fetch(`${API_BASE}/shards/${shard.id}/access/${userId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (res.ok) {
                fetchOperators();
                showNotification('Accès révoqué');
            }
        } catch (err) {
            console.error(err);
        }
    };

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

    const downloadLogs = () => {
        const blob = new Blob([logs], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${shard.slug}-logs.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Auto-scroll logs to bottom
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    // SSE live mode
    useEffect(() => {
        if (!showLogs || !isLiveMode) return;

        // Load snapshot first
        fetchLogs();

        const es = new EventSource(`${API_BASE}/shards/${shard.id}/logs/stream`);
        es.onmessage = (event) => {
            try {
                const line = JSON.parse(event.data);
                if (logFilter !== 'all' && line.level !== logFilter) return;
                setLogs(prev => {
                    const newLine = `${line.ts} [${line.level?.toUpperCase()}] ${line.msg}`;
                    return prev ? prev + '\n' + newLine : newLine;
                });
            } catch {}
        };
        es.onerror = () => {
            // SSE reconnects automatically; fallback to polling if it fails
        };

        return () => es.close();
    }, [showLogs, isLiveMode, shard.id, logFilter]);

    // Polling fallback when not in live mode
    useEffect(() => {
        if (!showLogs || isLiveMode) return;
        fetchLogs();
        const logInterval = setInterval(fetchLogs, 5000);
        return () => clearInterval(logInterval);
    }, [showLogs, isLiveMode, shard.id]);

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
                        onClick={() => { setShowLogs(!showLogs); if (!showLogs) setLogs(''); }}
                        className="w-full flex items-center justify-between px-3 py-2 bg-cyan-950/20 border border-cyan-900/30 text-cyan-500 font-mono text-[9px] tracking-widest hover:bg-cyan-500/5 transition-all uppercase"
                    >
                        <span className="flex items-center gap-2">
                            <Terminal size={12} /> Standard_Output_Feed
                            {showLogs && isLiveMode && (
                                <span className="flex items-center gap-1 text-emerald-400 text-[7px]">
                                    <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>LIVE
                                </span>
                            )}
                        </span>
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
                                <div className="p-3 bg-black/40 border-x border-b border-cyan-900/30 space-y-3">
                                    {/* Controls bar */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {/* Live/History toggle */}
                                        <div className="flex border border-cyan-900/40 overflow-hidden">
                                            <button
                                                onClick={() => { setIsLiveMode(true); setLogs(''); }}
                                                className={`px-2 py-0.5 font-mono text-[7px] tracking-widest transition-all ${isLiveMode ? 'bg-emerald-500/20 text-emerald-400 border-r border-emerald-500/30' : 'text-cyan-800 hover:text-cyan-600'}`}
                                            >⬤ LIVE</button>
                                            <button
                                                onClick={() => { setIsLiveMode(false); setLogs(''); }}
                                                className={`px-2 py-0.5 font-mono text-[7px] tracking-widest transition-all ${!isLiveMode ? 'bg-cyan-500/20 text-cyan-400' : 'text-cyan-800 hover:text-cyan-600'}`}
                                            >HIST</button>
                                        </div>

                                        {/* Level filter */}
                                        <select
                                            value={logFilter}
                                            onChange={e => { setLogFilter(e.target.value as any); setLogs(''); }}
                                            className="bg-black/60 border border-cyan-900/40 text-cyan-600 font-mono text-[7px] px-1.5 py-0.5 focus:outline-none"
                                        >
                                            <option value="all">ALL</option>
                                            <option value="stdout">STDOUT</option>
                                            <option value="stderr">STDERR</option>
                                        </select>

                                        {/* Download */}
                                        <button
                                            onClick={downloadLogs}
                                            disabled={!logs}
                                            className="ml-auto px-2 py-0.5 border border-cyan-900/40 text-cyan-800 font-mono text-[7px] tracking-widest hover:text-cyan-500 hover:border-cyan-500/40 transition-all disabled:opacity-20 uppercase"
                                        >↓ DL</button>
                                    </div>

                                    {/* Log output */}
                                    <div className="relative">
                                        <pre className="w-full h-56 bg-black/80 border border-cyan-900/30 p-2 text-cyan-400 font-mono text-[9px] overflow-y-auto custom-scrollbar leading-relaxed">
                                            {logs || 'WAITING_FOR_DATA...'}
                                            <div ref={logsEndRef} />
                                        </pre>
                                    </div>
                                    
                                    {/* Command input */}
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={commandInput}
                                            onChange={(e) => setCommandInput(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleCommand(); }}
                                            placeholder="EXEC_COMMAND_IN_CONTAINER"
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

                {/* Docker Compose Config — shown only for compose shards */}
                {shard.compose_mode && (
                    <div className="pt-2 border-t border-cyan-900/20 space-y-2">
                        <label className="text-[9px] font-mono text-cyan-900 tracking-widest uppercase flex items-center gap-2">
                            <Layers size={10} /> COMPOSE_CONFIG
                            <span className="ml-auto text-emerald-500 text-[8px] tracking-normal font-normal animate-pulse">● COMPOSE_MODE</span>
                        </label>
                        <div className="p-2 bg-black/40 border border-cyan-900/30 space-y-3">
                            <p className="text-[8px] font-mono text-cyan-800 leading-relaxed">
                                Ce shard tourne avec <span className="text-cyan-500">docker-compose</span>. Sélectionne le service principal à proxifier.
                            </p>

                            {composeServices.length > 0 ? (
                                <div className="space-y-1">
                                    <label className="text-[8px] font-mono text-cyan-700 uppercase tracking-widest">Service Principal</label>
                                    <select
                                        value={composeMainService}
                                        onChange={(e) => setComposeMainService(e.target.value)}
                                        className="w-full bg-black/60 border border-cyan-900/40 text-cyan-400 font-mono text-[10px] px-2 py-1.5 focus:outline-none focus:border-cyan-500/50 appearance-none"
                                    >
                                        {composeServices.map(s => (
                                            <option key={s} value={s} className="bg-[#0a0f18]">{s}</option>
                                        ))}
                                    </select>
                                    <p className="text-[7px] font-mono text-cyan-900">Actuellement: <span className="text-cyan-600">{shard.compose_main_service || composeServices[0] || '—'}</span></p>
                                </div>
                            ) : (
                                <p className="text-[8px] font-mono text-amber-600">Impossible de lire les services depuis le compose file.</p>
                            )}

                            <button
                                onClick={async () => {
                                    if (!composeMainService) return;
                                    setIsSavingCompose(true);
                                    try {
                                        const res = await fetch(`${API_BASE}/shards/${shard.id}/compose-service`, {
                                            method: 'PATCH',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ service: composeMainService }),
                                            credentials: 'include'
                                        });
                                        const data = await res.json();
                                        if (data.success) {
                                            showNotification('COMPOSE_SERVICE_UPDATED');
                                            onUpdate();
                                        } else {
                                            showNotification(data.error || 'UPDATE_FAILED', 'error');
                                        }
                                    } catch {
                                        showNotification('SYSTEM_ERROR', 'error');
                                    } finally {
                                        setIsSavingCompose(false);
                                    }
                                }}
                                disabled={isSavingCompose || !composeMainService}
                                className="w-full flex items-center justify-center gap-2 py-1.5 bg-cyan-500/5 border border-cyan-500/40 text-cyan-500 font-mono text-[9px] tracking-widest hover:bg-cyan-500/10 transition-all uppercase disabled:opacity-30"
                            >
                                {isSavingCompose ? 'SAVING...' : <><GitBranch size={11} /> SET_MAIN_SERVICE</>}
                            </button>
                        </div>
                    </div>
                )}

                {/* Public Routes (Webhooks) */}
                <div className="pt-2 border-t border-cyan-900/20">
                    <button
                        onClick={() => setShowPublicRoutes(!showPublicRoutes)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-cyan-950/20 border border-cyan-900/30 text-cyan-500 font-mono text-[9px] tracking-widest hover:bg-cyan-500/5 transition-all uppercase"
                    >
                        <span className="flex items-center gap-2">
                            <Globe size={12} /> PUBLIC_ROUTES
                            {publicRoutes.length > 0 && (
                                <span className="px-1 py-0 bg-cyan-500/20 text-cyan-400 text-[7px] rounded">{publicRoutes.length}</span>
                            )}
                        </span>
                        {showPublicRoutes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    <AnimatePresence>
                        {showPublicRoutes && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="p-3 bg-black/40 border-x border-b border-cyan-900/30 space-y-3">
                                    <p className="text-[8px] font-mono text-cyan-800 leading-relaxed">
                                        Les routes publiques permettent à des services externes (N8N, webhooks…) d'accéder à ce shard sans authentification JWT. 
                                        <span className="text-amber-600"> Admin-only.</span>
                                    </p>

                                    {/* Active routes list */}
                                    {publicRoutes.length > 0 && (
                                        <div className="space-y-1">
                                            <label className="text-[7px] font-mono text-cyan-700 uppercase tracking-widest">Routes actives</label>
                                            {publicRoutes.map(r => (
                                                <div key={r.id} className="flex items-start gap-2 p-2 bg-black/60 border border-cyan-900/30 group">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className="text-[8px] font-mono text-cyan-700 border border-cyan-900/30 px-1">{r.method}</span>
                                                            <span className="text-[9px] font-mono text-cyan-400 break-all">{r.path_pattern}</span>
                                                            <span className="text-[7px] font-mono text-emerald-700">{r.rate_limit_rpm} rpm</span>
                                                        </div>
                                                        {r.description && (
                                                            <p className="text-[7px] font-mono text-cyan-900 mt-0.5">{r.description}</p>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={async () => {
                                                            await fetch(`${API_BASE}/shards/${shard.id}/public-routes/${r.id}`, {
                                                                method: 'DELETE',
                                                                credentials: 'include'
                                                            });
                                                            fetchPublicRoutes();
                                                        }}
                                                        className="p-1 text-red-900 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                    >
                                                        <Trash2 size={10} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Templates */}
                                    <div className="space-y-1">
                                        <label className="text-[7px] font-mono text-cyan-700 uppercase tracking-widest">Templates rapides</label>
                                        <div className="flex gap-1.5 flex-wrap">
                                            <button
                                                onClick={() => setNewRoute({ path_pattern: '/webhook/*', method: 'POST', rate_limit_rpm: 120, description: 'N8N Webhooks' })}
                                                className="flex items-center gap-1 px-2 py-1 bg-black/60 border border-cyan-900/30 text-cyan-700 font-mono text-[7px] hover:border-cyan-500/50 hover:text-cyan-500 transition-all"
                                            >
                                                <Zap size={8} /> N8N_WEBHOOK
                                            </button>
                                            <button
                                                onClick={() => setNewRoute({ path_pattern: '/api/webhook', method: '*', rate_limit_rpm: 60, description: 'Generic webhook' })}
                                                className="flex items-center gap-1 px-2 py-1 bg-black/60 border border-cyan-900/30 text-cyan-700 font-mono text-[7px] hover:border-cyan-500/50 hover:text-cyan-500 transition-all"
                                            >
                                                <Globe size={8} /> GENERIC
                                            </button>
                                        </div>
                                    </div>

                                    {/* Add route form */}
                                    {!isAddingRoute ? (
                                        <button
                                            onClick={() => setIsAddingRoute(true)}
                                            className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-cyan-900/40 text-cyan-800 font-mono text-[8px] hover:border-cyan-500/40 hover:text-cyan-600 transition-all"
                                        >
                                            <Plus size={10} /> ADD_ROUTE
                                        </button>
                                    ) : (
                                        <div className="space-y-2 p-2 border border-cyan-900/30 bg-black/40">
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="col-span-2 space-y-1">
                                                    <label className="text-[7px] font-mono text-cyan-700 uppercase">Pattern</label>
                                                    <input
                                                        type="text"
                                                        value={newRoute.path_pattern}
                                                        onChange={e => setNewRoute(r => ({ ...r, path_pattern: e.target.value }))}
                                                        placeholder="/webhook/*"
                                                        className="w-full bg-black/60 border border-cyan-900/40 text-cyan-400 font-mono text-[9px] px-2 py-1 focus:outline-none focus:border-cyan-500/50"
                                                    />
                                                    {newRoute.path_pattern === '/' || newRoute.path_pattern === '/*' ? (
                                                        <p className="text-[7px] font-mono text-red-500 flex items-center gap-1"><ShieldOff size={8} /> Pattern très large — expose toutes les routes</p>
                                                    ) : null}
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[7px] font-mono text-cyan-700 uppercase">Méthode</label>
                                                    <select
                                                        value={newRoute.method}
                                                        onChange={e => setNewRoute(r => ({ ...r, method: e.target.value }))}
                                                        className="w-full bg-black/60 border border-cyan-900/40 text-cyan-400 font-mono text-[9px] px-1.5 py-1 focus:outline-none"
                                                    >
                                                        {['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                                                            <option key={m} value={m} className="bg-[#0a0f18]">{m}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[7px] font-mono text-cyan-700 uppercase">Rate (rpm)</label>
                                                    <input
                                                        type="number"
                                                        value={newRoute.rate_limit_rpm}
                                                        onChange={e => setNewRoute(r => ({ ...r, rate_limit_rpm: parseInt(e.target.value) || 60 }))}
                                                        min={1} max={1000}
                                                        className="w-full bg-black/60 border border-cyan-900/40 text-cyan-400 font-mono text-[9px] px-2 py-1 focus:outline-none"
                                                    />
                                                </div>
                                                <div className="col-span-2 space-y-1">
                                                    <label className="text-[7px] font-mono text-cyan-700 uppercase">Description (optionnel)</label>
                                                    <input
                                                        type="text"
                                                        value={newRoute.description}
                                                        onChange={e => setNewRoute(r => ({ ...r, description: e.target.value }))}
                                                        placeholder="N8N webhook entrant"
                                                        className="w-full bg-black/60 border border-cyan-900/40 text-cyan-400 font-mono text-[9px] px-2 py-1 focus:outline-none"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={async () => {
                                                        if (!newRoute.path_pattern) return;
                                                        setIsCreatingRoute(true);
                                                        try {
                                                            await fetch(`${API_BASE}/shards/${shard.id}/public-routes`, {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify(newRoute),
                                                                credentials: 'include'
                                                            });
                                                            setNewRoute({ path_pattern: '', method: '*', rate_limit_rpm: 60, description: '' });
                                                            setIsAddingRoute(false);
                                                            fetchPublicRoutes();
                                                        } finally {
                                                            setIsCreatingRoute(false);
                                                        }
                                                    }}
                                                    disabled={isCreatingRoute || !newRoute.path_pattern}
                                                    className="flex-1 py-1 bg-cyan-500/10 border border-cyan-500/40 text-cyan-500 font-mono text-[8px] tracking-widest hover:bg-cyan-500/20 transition-all disabled:opacity-30"
                                                >
                                                    {isCreatingRoute ? 'CREATING...' : 'CONFIRM'}
                                                </button>
                                                <button
                                                    onClick={() => { setIsAddingRoute(false); setNewRoute({ path_pattern: '', method: '*', rate_limit_rpm: 60, description: '' }); }}
                                                    className="px-3 py-1 border border-red-900/30 text-red-900 font-mono text-[8px] hover:text-red-500 hover:border-red-500/40 transition-all"
                                                >
                                                    CANCEL
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* ── User Access Panel ── */}
                {user?.role === 'administrator' && (
                    <div className="border-t border-cyan-dark/30 pt-4">
                        <button
                            onClick={() => setShowAccess(!showAccess)}
                            className="flex items-center gap-2 w-full text-left text-cyan-400 font-mono text-[10px] tracking-widest hover:text-cyan-300 transition-colors"
                        >
                            <Users size={12} className={showAccess ? "text-cyan-300" : "text-cyan-600"} />
                            <span>ACCÈS UTILISATEURS</span>
                            {showAccess ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
                        </button>

                        <AnimatePresence>
                            {showAccess && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden mt-3"
                                >
                                    <div className="p-3 bg-black/40 border-x border-b border-cyan-900/30 space-y-3">
                                        <p className="text-[8px] font-mono text-cyan-800 leading-relaxed">
                                            Seuls les administrateurs et les opérateurs listés ici ont accès à ce shard.
                                        </p>

                                        {/* Operators list */}
                                        <div className="space-y-1">
                                            {operators.filter(o => o.has_access).map(op => (
                                                <div key={op.id} className="flex items-center justify-between p-1.5 bg-black/60 border border-cyan-900/30 group hover:border-cyan-700/50 transition-colors">
                                                    <span className="text-[9px] font-mono text-cyan-500">{op.username}</span>
                                                    <button
                                                        onClick={() => handleRevokeAccess(op.id)}
                                                        className="p-1 text-red-900 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                    >
                                                        <Trash2 size={10} />
                                                    </button>
                                                </div>
                                            ))}
                                            {operators.filter(o => o.has_access).length === 0 && (
                                                <p className="text-[8px] font-mono text-cyan-900 italic p-2 border border-dashed border-cyan-900/30 text-center">Aucun opérateur assigné</p>
                                            )}
                                        </div>

                                        {/* Add operator */}
                                        <div className="flex gap-2 items-center mt-2 pt-3 border-t border-cyan-900/30">
                                            <select
                                                value={selectedOperator}
                                                onChange={e => setSelectedOperator(e.target.value)}
                                                className="flex-1 bg-black/60 border border-cyan-900/40 text-cyan-400 font-mono text-[9px] px-2 py-1.5 focus:outline-none focus:border-cyan-500/50"
                                            >
                                                <option value="" className="bg-[#0a0f18]">Sélectionner un opérateur...</option>
                                                {operators.filter(o => !o.has_access).map(op => (
                                                    <option key={op.id} value={op.id} className="bg-[#0a0f18]">{op.username}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={handleGrantAccess}
                                                disabled={!selectedOperator}
                                                className="px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/40 text-cyan-500 font-mono text-[8px] tracking-widest hover:bg-cyan-500/20 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                                            >
                                                AJOUTER
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}

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
