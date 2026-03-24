import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Shield, AlertTriangle, Plus, Trash2, Hash, Copy, Edit3, Check, X, Terminal, RefreshCw, Pause, Play } from 'lucide-react';
import { API_BASE } from '../../config/constants';
import CPULoad from '../ui/CPULoad';
import DecryptingText from '../ui/DecryptingText';
import { User, DeployToken, ApiResponse } from '../../../../shared/types';

interface UserRowProps {
    user: User;
    currentUser: User | null;
    onRemove: () => void;
    onUpdate: () => void;
    getSetupUrl: (token: string) => string;
    copyToClipboard: (text: string) => void;
}

function UserRow({ user, currentUser, onRemove, onUpdate, getSetupUrl, copyToClipboard }: UserRowProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [tempName, setTempName] = useState(user.username);
    const isMe = currentUser && currentUser.id === user.id;

    const saveEdit = async () => {
        if (!tempName || tempName === user.username) return setIsEditing(false);
        await fetch(`${API_BASE}/admin/users/${user.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username: tempName })
        });
        setIsEditing(false);
        onUpdate();
    };

    return (
        <div className="bg-hud-gray/30 border-l-2 border-cyan-dark/40 hover:border-[#00d4ff] p-3 transition-colors flex flex-col gap-2 relative group">
            <div className="flex justify-between items-center">
                <div className="flex flex-col flex-1">
                    <span className="text-[8px] text-cyan-dark font-mono font-bold tracking-widest">OP_{user.id.substring(0, 4).toUpperCase()}</span>
                    {isEditing ? (
                        <div className="flex items-center gap-2 mt-1">
                            <input
                                type="text"
                                className="bg-black/50 border-b border-[#00d4ff] text-sm text-[#00d4ff] outline-none px-1 py-0.5 w-full uppercase font-bold tracking-widest"
                                value={tempName || ''}
                                onChange={e => setTempName(e.target.value)}
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                            />
                            <button onClick={saveEdit} className="text-green-500"><Check size={14} /></button>
                            <button onClick={() => setIsEditing(false)} className="text-empire-red"><X size={14} /></button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold tracking-widest uppercase ${user.username ? 'text-[#00d4ff]' : 'text-gray-600 italic'}`}>
                                {user.username || 'PENDING_INVITE'}
                            </span>
                            {user.username && <button onClick={() => setIsEditing(true)} className="text-gray-500 hover:text-[#00d4ff] transition-colors"><Edit3 size={12} /></button>}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {isMe && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 border border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff] animate-pulse">
                            [YOU]
                        </span>
                    )}
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 border ${user.role === 'administrator' ? 'border-empire-red bg-empire-red/10 text-empire-red' : 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]'}`}>
                        [{user.role?.toUpperCase() || 'OPERATOR'}]
                    </span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 border ${user.setupToken ? 'border-amber-500/50 text-amber-500' : 'border-green-500/50 text-green-500'}`}>
                        {user.setupToken ? '[PENDING]' : '[SECURE]'}
                    </span>
                    {!isMe && (
                        <button onClick={onRemove} className="text-empire-red hover:bg-empire-red/10 p-1 rounded transition-colors" title="REVOKE ACCESS">
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>

            </div>
            {user.setupToken && (
                <div className="flex items-center gap-2 bg-black/40 p-1.5 border border-cyan-dark/20">
                    <Hash size={10} className="text-gray-600" />
                    <input type="text" className="bg-transparent border-none text-[9px] text-gray-500 font-mono w-full outline-none" value={getSetupUrl(user.setupToken)} readOnly />
                    <button onClick={() => user.setupToken && copyToClipboard(getSetupUrl(user.setupToken))} className="text-[#00d4ff] hover:text-white"><Copy size={12} /></button>
                </div>
            )}
            {!user.setupToken && (
                <div className="flex items-center gap-1.5 text-[10px] text-green-500/80 font-mono uppercase tracking-widest">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                    BIOMETRICS_SECURED
                </div>
            )}
        </div>
    );
}

interface AdminModalProps {
    onClose: () => void;
    currentUser: User | null;
}

interface LogEntry {
    ts: string;
    level: 'log' | 'warn' | 'error';
    msg: string;
}

export default function AdminModal({ onClose, currentUser }: AdminModalProps) {
    const [users, setUsers] = useState<User[]>([]);
    const [tokens, setTokens] = useState<DeployToken[]>([]);
    const [newUsername, setNewUsername] = useState<string>('');
    const [lastGeneratedToken, setLastGeneratedToken] = useState<string | null>(null);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);

    // System logs state
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [logsError, setLogsError] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);
    const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const loadData = () => {
        fetch(`${API_BASE}/admin/users`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : [])
            .then(data => setUsers(Array.isArray(data) ? data : []))
            .catch(() => setUsers([]));

        fetch(`${API_BASE}/admin/tokens`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : [])
            .then(data => setTokens(Array.isArray(data) ? data : []))
            .catch(() => setTokens([]));
    };

    useEffect(() => { loadData(); }, []);

    const fetchLogs = async () => {
        setLogsLoading(true);
        setLogsError(null);
        try {
            const res = await fetch(`${API_BASE}/admin/logs?lines=300`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setLogs(data.logs || []);
            setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        } catch (e: any) {
            setLogsError(e.message);
        } finally {
            setLogsLoading(false);
        }
    };

    // Auto-refresh effect
    useEffect(() => {
        if (autoRefresh) {
            fetchLogs();
            autoRefreshRef.current = setInterval(fetchLogs, 5000);
        } else {
            if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
        }
        return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
    }, [autoRefresh]);

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    const addUser = async (e: React.FormEvent | null, usernameOverride: string | null = null) => {
        if (e) e.preventDefault();
        const username = usernameOverride || newUsername;

        const res = await fetch(`${API_BASE}/admin/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username: username || null })
        });
        const data = await res.json();
        if (data.setupToken) {
            setLastGeneratedToken(data.setupToken);
        }
        setNewUsername('');
        loadData();
    };

    const removeUser = async (id: string) => {
        await fetch(`${API_BASE}/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
        loadData();
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    const getSetupUrl = (setupToken: string) => `${window.location.origin}?token=${setupToken}`;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-end"
            onClick={onClose}
        >
            <motion.div
                initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="side-drawer h-full w-full max-w-md flex flex-col pt-8 pb-4 px-6 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-between items-start mb-10">
                    <div>
                        <h2 className="text-xl font-bold text-[#00d4ff] tracking-[0.3em] flex items-center gap-2 mb-2">
                            <Shield size={20} className="animate-pulse" /> DIAGNOSTICS & CREW
                        </h2>
                        <div className="flex items-center gap-4">
                            <CPULoad />
                            <div className="flex flex-col text-[8px] text-gray-500 font-mono tracking-widest uppercase">
                                <span>CORE_STABILITY: NOMINAL</span>
                                <span>UPLINK_BANDWIDTH: 4.8Gb/s</span>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 border border-empire-red/20 text-empire-red hover:bg-empire-red/10 transition-colors group flex items-center gap-2" title="ABORT">
                        <span className="text-[10px] font-bold tracking-widest hidden group-hover:block">ABORT</span>
                        <AlertTriangle size={20} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-12 pr-2 scrollbar-hide">
                    <section className="space-y-8">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="h-[2px] w-8 bg-[#00d4ff]/50"></div>
                            <h3 className="text-xs font-bold text-white tracking-[0.2em] uppercase">OPERATOR_INVITATIONS (5min TTL)</h3>
                        </div>

                        <button onClick={() => addUser(null, null)} className="btn-primary w-full py-3 mb-8 flex items-center justify-center gap-3 group !bg-[#00d4ff]/10 !border-[#00d4ff]/30 !text-[#00d4ff] hover:!bg-[#00d4ff]/20">
                            <Plus size={18} className="group-hover:rotate-90 transition-transform" />
                            GENERATE_OPERATOR_TOKEN
                        </button>

                        {lastGeneratedToken && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="mb-8 overflow-hidden">
                                <div className="bg-empire-red/10 border border-empire-red/30 p-4 relative">
                                    <span className="absolute -top-2 left-2 bg-black px-2 text-[8px] text-empire-red font-mono tracking-widest">LATEST_GEN</span>
                                    <div className="flex justify-between items-center gap-4">
                                        <div className="text-[#00d4ff] font-mono text-xs break-all">
                                            <DecryptingText text={lastGeneratedToken} />
                                        </div>
                                        <button
                                            onClick={() => copyToClipboard(getSetupUrl(lastGeneratedToken))}
                                            className={`px-3 py-1 text-[10px] font-bold border transition-colors ${copySuccess ? 'bg-green-500 border-green-500 text-black' : 'border-[#00d4ff] text-[#00d4ff] hover:bg-[#00d4ff]/20'}`}
                                        >
                                            {copySuccess ? 'SECURED_COPIED' : 'COPY_INVIT_LINK'}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        <div className="flex flex-col gap-3 pb-8">
                            {users.map(u => (
                                <UserRow
                                    key={u.id}
                                    user={u}
                                    currentUser={currentUser}
                                    onRemove={() => removeUser(u.id)}
                                    onUpdate={loadData}
                                    getSetupUrl={getSetupUrl}
                                    copyToClipboard={copyToClipboard}
                                />
                            ))}
                        </div>
                    </section>

                    {/* ── SYSTEM LOGS ── */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="h-[2px] w-8 bg-empire-red/50"></div>
                            <h3 className="text-xs font-bold text-white tracking-[0.2em] uppercase flex items-center gap-2">
                                <Terminal size={12} className="text-empire-red" /> SYSTEM_LOGS
                            </h3>
                        </div>

                        <div className="flex gap-2 mb-3">
                            <button
                                onClick={fetchLogs}
                                disabled={logsLoading}
                                className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/10 transition-colors disabled:opacity-40 tracking-widest"
                            >
                                <RefreshCw size={11} className={logsLoading ? 'animate-spin' : ''} />
                                {logsLoading ? 'PULLING...' : 'PULL_LOGS'}
                            </button>
                            <button
                                onClick={() => setAutoRefresh(v => !v)}
                                className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold border transition-colors tracking-widest ${
                                    autoRefresh
                                        ? 'border-amber-500/60 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
                                        : 'border-gray-600/40 text-gray-500 hover:text-gray-300 hover:border-gray-500/60'
                                }`}
                            >
                                {autoRefresh ? <><Pause size={11} /> AUTO_ON</> : <><Play size={11} /> AUTO_OFF</>}
                            </button>
                        </div>

                        {logsError && (
                            <div className="text-[10px] text-empire-red font-mono px-3 py-2 border border-empire-red/30 bg-empire-red/5">
                                ERROR: {logsError}
                            </div>
                        )}

                        <div className="bg-black/80 border border-cyan-dark/20 h-72 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed scrollbar-hide">
                            {logs.length === 0 ? (
                                <span className="text-gray-600 italic">— no logs loaded — click PULL_LOGS or enable AUTO_ON —</span>
                            ) : (
                                logs.map((entry, i) => {
                                    const color = entry.level === 'error' ? 'text-empire-red' : entry.level === 'warn' ? 'text-amber-400' : 'text-green-400';
                                    const tsStr = new Date(entry.ts).toLocaleTimeString('fr-FR', { hour12: false });
                                    return (
                                        <div key={i} className="flex gap-2 mb-0.5 hover:bg-white/5 px-1">
                                            <span className="text-gray-600 shrink-0">{tsStr}</span>
                                            <span className={`shrink-0 w-8 ${color} font-bold uppercase`}>{entry.level === 'log' ? 'INF' : entry.level === 'warn' ? 'WRN' : 'ERR'}</span>
                                            <span className={`${color} break-all`}>{entry.msg}</span>
                                        </div>
                                    );
                                })
                            )}
                            <div ref={logsEndRef} />
                        </div>
                        <div className="text-[8px] text-gray-700 font-mono tracking-widest text-right">
                            {logs.length > 0 ? `${logs.length} LINES BUFFERED · AUTO: ${autoRefresh ? '5s' : 'OFF'}` : 'BUFFER_EMPTY'}
                        </div>
                    </section>
                </div>

                <div className="mt-6 pt-4 border-t border-cyan-dark/20 flex flex-col gap-1 items-center">
                    <span className="text-[8px] text-gray-600 font-mono tracking-widest uppercase">STARDUST_OS V4.2.0-TACTICAL</span>
                    <div className="flex gap-1">
                        {[...Array(20)].map((_, i) => (
                            <div key={i} className={`w-1 h-1 ${Math.random() > 0.8 ? 'bg-[#00d4ff]' : 'bg-cyan-dark/20'}`}></div>
                        ))}
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
