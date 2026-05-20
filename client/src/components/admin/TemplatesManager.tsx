import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Download, Upload, Trash2, Edit3, Plus, Save, X, RefreshCw, Archive, Check } from 'lucide-react';
import { API_BASE } from '../../config/constants';

interface Template {
    id: string;
    filename: string;
    description: string;
    is_text: boolean;
    size_bytes: number;
    created_at: string;
    updated_at: string;
}

export default function TemplatesManager() {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    // Edit Text Mode
    const [isEditingText, setIsEditingText] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
    const [editFilename, setEditFilename] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editContent, setEditContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Upload Mode
    const [isUploading, setIsUploading] = useState(false);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadDesc, setUploadDesc] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadTemplates = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE}/templates`, { credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                setTemplates(data.data);
            }
        } catch (err) {
            console.error('Failed to load templates:', err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadTemplates();
    }, []);

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    };

    const handleDownload = (id: string) => {
        window.open(`${API_BASE}/templates/${id}/download`, '_blank');
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        e.preventDefault();
        try {
            await fetch(`${API_BASE}/templates/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            setConfirmDeleteId(null);
            loadTemplates();
        } catch (err) {
            console.error(err);
        }
    };

    const startEditText = async (t?: Template) => {
        if (t) {
            setEditingTemplate(t);
            setEditFilename(t.filename);
            setEditDescription(t.description || '');
            try {
                const res = await fetch(`${API_BASE}/templates/${t.id}/content`, { credentials: 'include' });
                const data = await res.json();
                if (data.success) setEditContent(data.content);
            } catch (err) {
                console.error(err);
            }
        } else {
            setEditingTemplate(null);
            setEditFilename('docker-compose.example.yml');
            setEditDescription('');
            setEditContent('');
        }
        setIsEditingText(true);
    };

    const saveText = async () => {
        setIsSaving(true);
        try {
            const res = await fetch(`${API_BASE}/templates/text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    id: editingTemplate?.id,
                    filename: editFilename,
                    description: editDescription,
                    content: editContent
                })
            });
            if (res.ok) {
                setIsEditingText(false);
                loadTemplates();
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsSaving(false);
        }
    };

    const submitUpload = async () => {
        if (!uploadFile) return;
        setIsSaving(true);
        try {
            const fd = new FormData();
            fd.append('file', uploadFile);
            fd.append('description', uploadDesc);

            const res = await fetch(`${API_BASE}/templates/upload`, {
                method: 'POST',
                credentials: 'include',
                body: fd
            });
            if (res.ok) {
                setIsUploading(false);
                setUploadFile(null);
                setUploadDesc('');
                loadTemplates();
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsSaving(false);
        }
    };

    if (isEditingText) {
        return (
            <div className="flex flex-col h-full space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-white tracking-[0.2em] uppercase flex items-center gap-2">
                        <FileText size={14} className="text-[#00d4ff]" /> 
                        {editingTemplate ? 'EDIT_TEXT_RESOURCE' : 'NEW_TEXT_RESOURCE'}
                    </h3>
                    <button onClick={() => setIsEditingText(false)} className="text-gray-500 hover:text-white"><X size={16} /></button>
                </div>
                
                <div className="space-y-3">
                    <div>
                        <label className="text-[9px] font-mono text-cyan-600 uppercase tracking-widest block mb-1">Filename</label>
                        <input type="text" value={editFilename} onChange={e => setEditFilename(e.target.value)} disabled={!!editingTemplate} className="w-full bg-black/60 border border-cyan-900/30 text-cyan-400 font-mono text-xs px-3 py-2 outline-none disabled:opacity-50" />
                    </div>
                    <div>
                        <label className="text-[9px] font-mono text-cyan-600 uppercase tracking-widest block mb-1">Description</label>
                        <input type="text" value={editDescription} onChange={e => setEditDescription(e.target.value)} className="w-full bg-black/60 border border-cyan-900/30 text-cyan-400 font-mono text-xs px-3 py-2 outline-none" />
                    </div>
                    <div className="flex-1 flex flex-col">
                        <label className="text-[9px] font-mono text-cyan-600 uppercase tracking-widest block mb-1">Content</label>
                        <textarea 
                            value={editContent} 
                            onChange={e => setEditContent(e.target.value)} 
                            className="w-full h-64 bg-black/80 border border-cyan-dark/20 text-[#00d4ff] font-mono text-[10px] p-3 outline-none resize-none scrollbar-hide"
                            spellCheck="false"
                        ></textarea>
                    </div>
                    <button 
                        onClick={saveText} 
                        disabled={isSaving || !editFilename}
                        className="w-full py-2 bg-cyan-900/20 border border-cyan-500/30 text-cyan-500 text-xs font-bold tracking-widest flex justify-center items-center gap-2 hover:bg-cyan-500/10 transition-colors disabled:opacity-50"
                    >
                        {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                        {isSaving ? 'SAVING...' : 'SAVE_RESOURCE'}
                    </button>
                </div>
            </div>
        );
    }

    if (isUploading) {
        return (
            <div className="flex flex-col space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-white tracking-[0.2em] uppercase flex items-center gap-2">
                        <Upload size={14} className="text-[#00d4ff]" /> UPLOAD_ARCHIVE
                    </h3>
                    <button onClick={() => setIsUploading(false)} className="text-gray-500 hover:text-white"><X size={16} /></button>
                </div>
                
                <div className="space-y-4">
                    <div 
                        className="border-2 border-dashed border-cyan-900/50 bg-black/40 h-32 flex flex-col items-center justify-center cursor-pointer hover:border-[#00d4ff]/50 transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            onChange={e => setUploadFile(e.target.files?.[0] || null)} 
                            className="hidden" 
                        />
                        <Archive size={24} className={uploadFile ? "text-[#00d4ff] mb-2" : "text-cyan-900 mb-2"} />
                        <span className="text-xs font-mono text-cyan-600 tracking-widest">
                            {uploadFile ? uploadFile.name : 'SELECT_FILE'}
                        </span>
                        {uploadFile && <span className="text-[9px] font-mono text-cyan-800 mt-1">{formatSize(uploadFile.size)}</span>}
                    </div>

                    <div>
                        <label className="text-[9px] font-mono text-cyan-600 uppercase tracking-widest block mb-1">Description</label>
                        <input type="text" value={uploadDesc} onChange={e => setUploadDesc(e.target.value)} className="w-full bg-black/60 border border-cyan-900/30 text-cyan-400 font-mono text-xs px-3 py-2 outline-none" />
                    </div>

                    <button 
                        onClick={submitUpload} 
                        disabled={isSaving || !uploadFile}
                        className="w-full py-2 bg-cyan-900/20 border border-cyan-500/30 text-cyan-500 text-xs font-bold tracking-widest flex justify-center items-center gap-2 hover:bg-cyan-500/10 transition-colors disabled:opacity-50"
                    >
                        {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                        {isSaving ? 'UPLOADING...' : 'CONFIRM_UPLOAD'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col space-y-4">
            <div className="flex gap-2 mb-2">
                <button 
                    onClick={() => startEditText()} 
                    className="flex-1 py-2 bg-cyan-900/20 border border-[#00d4ff]/30 text-[#00d4ff] text-[10px] tracking-widest font-bold flex justify-center items-center gap-2 hover:bg-[#00d4ff]/10 transition-colors"
                >
                    <Plus size={12} /> NEW_TEXT
                </button>
                <button 
                    onClick={() => setIsUploading(true)} 
                    className="flex-1 py-2 bg-cyan-900/20 border border-amber-500/30 text-amber-500 text-[10px] tracking-widest font-bold flex justify-center items-center gap-2 hover:bg-amber-500/10 transition-colors"
                >
                    <Upload size={12} /> UPLOAD_FILE
                </button>
            </div>

            <div className="space-y-2">
                {templates.length === 0 && !isLoading && (
                    <div className="text-center py-8 border border-dashed border-cyan-900/30 text-cyan-800 text-[10px] font-mono tracking-widest uppercase">
                        NO_RESOURCES_FOUND
                    </div>
                )}
                {templates.map(t => (
                    <div key={t.id} className="bg-black/60 border border-cyan-900/30 p-3 flex flex-col gap-2 group hover:border-[#00d4ff]/40 transition-colors">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2">
                                {t.is_text ? <FileText size={14} className="text-[#00d4ff]" /> : <Archive size={14} className="text-amber-500" />}
                                <span className="text-xs font-bold font-mono text-gray-200">{t.filename}</span>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {confirmDeleteId === t.id ? (
                                    <div className="flex items-center gap-1 bg-empire-red/20 border border-empire-red/30 px-1 py-0.5">
                                        <span className="text-[8px] font-mono text-empire-red tracking-widest px-1">SÛR ?</span>
                                        <button onClick={(e) => handleDelete(e, t.id)} className="p-0.5 text-empire-red hover:bg-empire-red/20"><Check size={12} /></button>
                                        <button onClick={() => setConfirmDeleteId(null)} className="p-0.5 text-gray-400 hover:text-white hover:bg-white/10"><X size={12} /></button>
                                    </div>
                                ) : (
                                    <>
                                        {t.is_text && (
                                            <button onClick={() => startEditText(t)} className="p-1 text-cyan-600 hover:text-[#00d4ff]"><Edit3 size={12} /></button>
                                        )}
                                        <button onClick={() => handleDownload(t.id)} className="p-1 text-cyan-600 hover:text-[#00d4ff]"><Download size={12} /></button>
                                        {!t.filename.startsWith('workflow-') && (
                                            <button onClick={() => setConfirmDeleteId(t.id)} className="p-1 text-empire-red/60 hover:text-empire-red"><Trash2 size={12} /></button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                        {t.description && (
                            <p className="text-[9px] text-gray-500 font-mono">{t.description}</p>
                        )}
                        <div className="flex gap-3 text-[8px] font-mono text-cyan-800 tracking-widest">
                            <span>SIZE: {formatSize(t.size_bytes)}</span>
                            <span>UPDATED: {new Date(t.updated_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
