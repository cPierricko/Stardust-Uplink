/**
 * STARDUST MASTER LOGGER
 * - Intercepts console.log/warn/error
 * - Keeps a circular in-memory buffer (2000 lines)
 * - Persists logs to logs/master.log (daily rotation)
 * - Each entry carries a parsed 'tag' for filtering (e.g. [SHARDS], [DOCKER])
 * Must be imported once, as early as possible in server/index.ts.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Directory setup ─────────────────────────────────────────────────────────
const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getMasterLogPath(): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(LOG_DIR, `master-${date}.log`);
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface LogEntry {
    ts: string;
    level: 'log' | 'warn' | 'error';
    tag: string;       // Extracted from [TAG] prefix, e.g. "SHARDS", "DOCKER", "RUNNER"
    msg: string;
}

// ── In-memory buffer ────────────────────────────────────────────────────────
const MAX_LINES = 2000;
const buffer: LogEntry[] = [];

function extractTag(msg: string): string {
    // Matches patterns like [SHARDS], [SHARD_RUNNER], [CI/CD], [RO_OS], etc.
    const match = msg.match(/^\[([A-Z0-9_:/\-]{1,30})\]/);
    return match ? match[1] : 'SYSTEM';
}

let _fileWriteEnabled = true;

function push(level: LogEntry['level'], args: unknown[]) {
    const msg = args
        .map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');
    
    const entry: LogEntry = {
        ts: new Date().toISOString(),
        level,
        tag: extractTag(msg),
        msg
    };

    // In-memory circular buffer
    buffer.push(entry);
    if (buffer.length > MAX_LINES) buffer.shift();

    // File persistence (non-blocking, fire-and-forget)
    if (_fileWriteEnabled) {
        try {
            const line = `${entry.ts} [${entry.level.toUpperCase().padEnd(5)}] [${entry.tag}] ${msg}\n`;
            fs.appendFileSync(getMasterLogPath(), line);
        } catch (err) {
            // Don't recurse — just skip file write on error
            _fileWriteEnabled = false;
        }
    }
}

// ── Intercept native console ─────────────────────────────────────────────────
const _log   = console.log.bind(console);
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);

console.log = (...args: unknown[]) => {
    push('log', args);
    _log(...args);
};
console.warn = (...args: unknown[]) => {
    push('warn', args);
    _warn(...args);
};
console.error = (...args: unknown[]) => {
    push('error', args);
    _error(...args);
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Return the last `n` log entries (default 200). */
export function getLogs(n = 200): LogEntry[] {
    return buffer.slice(-Math.min(n, MAX_LINES));
}

/** Return the last `n` log entries matching a specific tag (case-insensitive). */
export function getLogsByTag(tag: string, n = 200): LogEntry[] {
    const upper = tag.toUpperCase();
    return buffer.filter(e => e.tag === upper).slice(-Math.min(n, MAX_LINES));
}

/** Return the last `n` log entries of a given level. */
export function getLogsByLevel(level: LogEntry['level'], n = 200): LogEntry[] {
    return buffer.filter(e => e.level === level).slice(-Math.min(n, MAX_LINES));
}

/** Push a raw log entry from an external source (e.g. ShardLogCollector). */
export function pushExternal(level: LogEntry['level'], tag: string, msg: string): void {
    const entry: LogEntry = { ts: new Date().toISOString(), level, tag, msg };
    buffer.push(entry);
    if (buffer.length > MAX_LINES) buffer.shift();
    // Don't write external shard logs to master.log — they have their own files
}

/** Subscribe to new log entries in real-time (for SSE streaming). */
type LogListener = (entry: LogEntry) => void;
const listeners: Set<LogListener> = new Set();

export function subscribeToLogs(fn: LogListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// ── Internal patch to notify SSE listeners ───────────────────────────────────
const _originalPush = push;
// Re-patch push to notify listeners (done after listeners Set is defined)
const patchedPush = (level: LogEntry['level'], args: unknown[]) => {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const entry: LogEntry = { ts: new Date().toISOString(), level, tag: extractTag(msg), msg };
    buffer.push(entry);
    if (buffer.length > MAX_LINES) buffer.shift();
    for (const fn of listeners) { try { fn(entry); } catch {} }
    if (_fileWriteEnabled) {
        try {
            const line = `${entry.ts} [${entry.level.toUpperCase().padEnd(5)}] [${entry.tag}] ${msg}\n`;
            fs.appendFileSync(getMasterLogPath(), line);
        } catch { _fileWriteEnabled = false; }
    }
};

console.log = (...args: unknown[]) => { patchedPush('log', args); _log(...args); };
console.warn = (...args: unknown[]) => { patchedPush('warn', args); _warn(...args); };
console.error = (...args: unknown[]) => { patchedPush('error', args); _error(...args); };

// ── Log retention cleanup (runs on startup, removes logs older than 48h) ─────
try {
    const now = Date.now();
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
        if (!file.startsWith('master-') || !file.endsWith('.log')) continue;
        const filePath = path.join(LOG_DIR, file);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > 48 * 60 * 60 * 1000) {
            fs.unlinkSync(filePath);
        }
    }
} catch {}
