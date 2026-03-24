/**
 * STARDUST MASTER LOGGER
 * Intercepts console.log/warn/error and keeps a circular in-memory buffer.
 * Must be imported once, as early as possible in server/index.ts.
 */

export interface LogEntry {
    ts: string;
    level: 'log' | 'warn' | 'error';
    msg: string;
}

const MAX_LINES = 500;
const buffer: LogEntry[] = [];

function push(level: LogEntry['level'], args: unknown[]) {
    const msg = args
        .map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');
    buffer.push({ ts: new Date().toISOString(), level, msg });
    if (buffer.length > MAX_LINES) buffer.shift();
}

// --- Intercept native console ---
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

/** Return the last `n` log entries (default 200). */
export function getLogs(n = 200): LogEntry[] {
    return buffer.slice(-Math.min(n, MAX_LINES));
}
