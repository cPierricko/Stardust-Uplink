/**
 * SHARD LOG COLLECTOR
 * 
 * Collects runtime logs from Docker containers in real-time using `docker logs --follow`.
 * - Maintains a per-shard in-memory circular buffer (1000 lines)
 * - Persists logs to logs/{slug}.log (capped at 48h by separate cleanup)
 * - Supports SSE streaming via subscribeToShardLogs()
 * 
 * Usage:
 *   ShardLogCollector.start(slug)   — called when a container is DEPLOYED
 *   ShardLogCollector.stop(slug)    — called when a container is stopped/deleted
 *   ShardLogCollector.getLogs(slug) — returns buffered log lines
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const MAX_LINES_PER_SHARD = 1000;
const LOG_RETENTION_MS = 48 * 60 * 60 * 1000; // 48 hours

interface ShardLogLine {
    ts: string;
    level: 'stdout' | 'stderr';
    msg: string;
}

type ShardLogListener = (line: ShardLogLine) => void;

class ShardLogCollectorService {
    // Per-shard in-memory buffers
    private buffers: Map<string, ShardLogLine[]> = new Map();
    // Per-shard collector processes (docker logs --follow)
    private collectors: Map<string, ChildProcess> = new Map();
    // Per-shard SSE listeners
    private listeners: Map<string, Set<ShardLogListener>> = new Map();

    constructor() {
        // On startup, clean old shard log files
        this._cleanOldLogs();
    }

    private _getBuffer(slug: string): ShardLogLine[] {
        if (!this.buffers.has(slug)) {
            this.buffers.set(slug, []);
        }
        return this.buffers.get(slug)!;
    }

    private _getListeners(slug: string): Set<ShardLogListener> {
        if (!this.listeners.has(slug)) {
            this.listeners.set(slug, new Set());
        }
        return this.listeners.get(slug)!;
    }

    private _getLogFilePath(slug: string): string {
        return path.join(LOG_DIR, `shard-${slug}.log`);
    }

    private _pushLine(slug: string, level: 'stdout' | 'stderr', rawMsg: string): void {
        const lines = rawMsg.split('\n').filter(l => l.trim().length > 0);
        for (const msg of lines) {
            const entry: ShardLogLine = {
                ts: new Date().toISOString(),
                level,
                msg: msg.trim()
            };

            // Buffer
            const buf = this._getBuffer(slug);
            buf.push(entry);
            if (buf.length > MAX_LINES_PER_SHARD) buf.shift();

            // File persistence
            try {
                fs.appendFileSync(
                    this._getLogFilePath(slug),
                    `${entry.ts} [${entry.level.toUpperCase()}] ${entry.msg}\n`
                );
            } catch {}

            // Notify SSE listeners
            const fns = this._getListeners(slug);
            for (const fn of fns) {
                try { fn(entry); } catch {}
            }
        }
    }

    /**
     * Start collecting logs from a Docker container.
     * Replaces any existing collector for this slug.
     */
    start(slug: string): void {
        // Stop existing collector if any
        this.stop(slug);

        const containerName = `stardust-shard-${slug}`;
        console.log(`[LOG_COLLECTOR] Starting log collection for ${containerName}`);

        const proc = spawn('docker', ['logs', '--follow', '--timestamps', containerName], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        this.collectors.set(slug, proc);

        proc.stdout?.on('data', (data: Buffer) => {
            this._pushLine(slug, 'stdout', data.toString('utf8'));
        });

        proc.stderr?.on('data', (data: Buffer) => {
            // Docker logs writes both stdout+stderr here when piped; treat as stdout
            this._pushLine(slug, 'stdout', data.toString('utf8'));
        });

        proc.on('error', (err) => {
            console.error(`[LOG_COLLECTOR] Error collecting logs for ${slug}:`, err.message);
        });

        proc.on('close', (code) => {
            console.log(`[LOG_COLLECTOR] Log collection ended for ${slug} (code ${code})`);
            this.collectors.delete(slug);
        });
    }

    /**
     * Start collecting logs from a Docker Compose project.
     * Collects from all containers in the project.
     */
    startCompose(slug: string): void {
        this.stop(slug);

        const projectName = `stardust-${slug}`;
        console.log(`[LOG_COLLECTOR] Starting compose log collection for project ${projectName}`);

        const proc = spawn('docker', [
            'compose', '-p', projectName, 'logs', '--follow', '--timestamps', '--no-color'
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        this.collectors.set(slug, proc);

        proc.stdout?.on('data', (data: Buffer) => {
            this._pushLine(slug, 'stdout', data.toString('utf8'));
        });

        proc.stderr?.on('data', (data: Buffer) => {
            this._pushLine(slug, 'stderr', data.toString('utf8'));
        });

        proc.on('error', (err) => {
            console.error(`[LOG_COLLECTOR] Compose log error for ${slug}:`, err.message);
        });

        proc.on('close', (code) => {
            console.log(`[LOG_COLLECTOR] Compose log collection ended for ${slug} (code ${code})`);
            this.collectors.delete(slug);
        });
    }

    /**
     * Stop log collection for a shard.
     */
    stop(slug: string): void {
        const proc = this.collectors.get(slug);
        if (proc) {
            try { proc.kill('SIGTERM'); } catch {}
            this.collectors.delete(slug);
        }
    }

    /**
     * Get the last `n` log lines for a shard (from buffer + historical file).
     */
    getLogs(slug: string, n = 200): string {
        const buf = this._getBuffer(slug);
        
        // If buffer is empty, try to read from file
        if (buf.length === 0) {
            const logFile = this._getLogFilePath(slug);
            if (fs.existsSync(logFile)) {
                const content = fs.readFileSync(logFile, 'utf8');
                const lines = content.split('\n').filter(Boolean);
                return lines.slice(-n).join('\n');
            }
            return 'NO_LOGS_AVAILABLE';
        }

        return buf.slice(-n).map(e => `${e.ts} [${e.level.toUpperCase()}] ${e.msg}`).join('\n');
    }

    /**
     * Get raw log lines as structured objects.
     */
    getLogLines(slug: string, n = 200): ShardLogLine[] {
        const buf = this._getBuffer(slug);
        return buf.slice(-n);
    }

    /**
     * Subscribe to new log lines for SSE streaming.
     * Returns an unsubscribe function.
     */
    subscribeToShardLogs(slug: string, fn: ShardLogListener): () => void {
        const fns = this._getListeners(slug);
        fns.add(fn);
        return () => fns.delete(fn);
    }

    /**
     * Check if a collector is actively running for a shard.
     */
    isCollecting(slug: string): boolean {
        return this.collectors.has(slug);
    }

    /**
     * Clean up log files older than 48h.
     */
    private _cleanOldLogs(): void {
        try {
            const now = Date.now();
            const files = fs.readdirSync(LOG_DIR);
            for (const file of files) {
                if (!file.startsWith('shard-') || !file.endsWith('.log')) continue;
                const filePath = path.join(LOG_DIR, file);
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > LOG_RETENTION_MS) {
                    fs.unlinkSync(filePath);
                    console.log(`[LOG_COLLECTOR] Cleaned old log file: ${file}`);
                }
            }
        } catch {}
    }
}

export const ShardLogCollector = new ShardLogCollectorService();
export type { ShardLogLine, ShardLogListener };
