import { spawn, exec, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import db from './db.js';

interface ShardProcess {
    process: ChildProcess;
    port: number;
    slug: string;
}

const shardsStorageDir = path.join(process.cwd(), 'shards_storage');

class ShardRunner {
    private processes: Map<string, ShardProcess> = new Map();
    private startingPromises: Map<string, Promise<number>> = new Map();
    private startPort = 4000;

    constructor() {
        // Automatically restart shards that should have a backend on startup
        // BUT: Don't do this during tests to avoid port conflicts and race conditions!
        if (process.env.NODE_ENV !== 'test') {
            setTimeout(() => this.resurrectShards(), 2000);
        }
    }

    private async resurrectShards() {
        console.log('[RUNNER] Resurrecting shards...');
        const shards = db.prepare('SELECT * FROM apps WHERE has_backend = 1').all() as any[];
        for (const shard of shards) {
            try {
                // Don't await here to avoid blocking Master startup if one shard is slow
                this.startShard(shard.slug).catch(err => {
                    console.error(`[RUNNER] Failed to resurrect shard ${shard.slug}:`, err);
                });
            } catch (err) {
                console.error(`[RUNNER] Error during resurrection call for ${shard.slug}:`, err);
            }
        }
    }

    private findAvailablePort(): number {
        const usedPorts = Array.from(this.processes.values()).map(p => p.port);
        const dbPorts = (db.prepare('SELECT assigned_port FROM apps WHERE assigned_port IS NOT NULL').all() as any[])
            .map(r => r.assigned_port);
        
        const allUsedPorts = new Set([...usedPorts, ...dbPorts]);
        
        let port = this.startPort;
        while (allUsedPorts.has(port)) {
            port++;
        }
        return port;
    }

    public getRunningPort(slug: string): number | null {
        return this.processes.get(slug)?.port || null;
    }

    async startShard(slug: string): Promise<number> {
        // If already being started, return the current start promise
        const currentP = this.startingPromises.get(slug);
        if (currentP) return currentP;

        // If already running, return its port
        const existingPort = this.getRunningPort(slug);
        if (existingPort) return existingPort;
        
        const startPromise = this._internalStart(slug);
        this.startingPromises.set(slug, startPromise);
        try {
            return await startPromise;
        } finally {
            this.startingPromises.delete(slug);
        }
    }

    private _internalStart(slug: string): Promise<number> {
        const shard = db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug) as any;
        if (!shard) throw new Error(`Shard ${slug} not found`);

        const shardPath = path.resolve(shardsStorageDir, slug);
        let entryPoint = '';
        if (fs.existsSync(path.join(shardPath, 'server.cjs'))) entryPoint = 'server.cjs';
        else if (fs.existsSync(path.join(shardPath, 'server.js'))) entryPoint = 'server.js';
        else if (fs.existsSync(path.join(shardPath, 'index.cjs'))) entryPoint = 'index.cjs';
        else if (fs.existsSync(path.join(shardPath, 'index.js'))) entryPoint = 'index.js';
        else if (fs.existsSync(path.join(shardPath, 'server.ts'))) entryPoint = 'server.ts';
        else if (fs.existsSync(path.join(shardPath, 'index.ts'))) entryPoint = 'index.ts';

        if (!entryPoint) {
            console.log(`[RUNNER] No backend entry point found for ${slug}`);
            db.prepare('UPDATE apps SET has_backend = 0 WHERE slug = ?').run(slug);
            return Promise.resolve(0);
        }

        const port = shard.assigned_port || this.findAvailablePort();
        
        // Update DB
        db.prepare('UPDATE apps SET has_backend = 1, assigned_port = ? WHERE slug = ?').run(port, slug);

        console.log(`[RUNNER] Starting shard ${slug} on port ${port} (Entry: ${entryPoint})`);

        // Prepare environment
        const env = { 
            ...process.env, 
            PORT: port.toString(),
            DATABASE_URL: `sqlite://${path.join(shardPath, 'sqlite.db')}`,
            SHARD_SLUG: slug,
            SHARD_PATH: shardPath
        };

        const cmd = entryPoint.endsWith('.ts') ? 'npx' : 'node';
        const args = entryPoint.endsWith('.ts') ? ['tsx', entryPoint] : [entryPoint];

        const child = spawn(cmd, args, {
            cwd: shardPath,
            env,
            stdio: 'pipe'
        });

        // Cleanup on exit
        const cleanup = () => { try { child.kill(); } catch(e) {} };
        process.on('exit', cleanup);
        process.on('SIGINT', cleanup);
        process.on('SIGUSR2', cleanup); // For nodemon

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.log(`[RUNNER] Timeout waiting for shard ${slug} to start`);
                resolve(port); // Resolve anyway to allow proxy attempts
            }, 10000);

            const logPath = path.join(shardPath, 'logs.txt');
            const logStream = fs.createWriteStream(logPath, { flags: 'a' });
            logStream.write(`\n\n--- SERVER START: ${new Date().toISOString()} ---\n`);
            child.stdout?.pipe(logStream, { end: false });
            child.stderr?.pipe(logStream, { end: false });

            // Also log to Master terminal
            child.stdout?.on('data', (data) => {
                const output = data.toString();
                process.stdout.write(`[SHARD:${slug}] ${output}`);
                const lower = output.toLowerCase();
                if (lower.includes('server active on port') || lower.includes('listening on')) {
                    clearTimeout(timeout);
                    this.processes.set(slug, { process: child, port, slug });
                    resolve(port);
                }
            });
            child.stderr?.on('data', (data) => {
                process.stderr.write(`[SHARD:${slug}:ERR] ${data.toString()}`);
            });

            child.on('error', (err) => {
                clearTimeout(timeout);
                console.error(`[RUNNER] Failed to start shard ${slug}:`, err);
                reject(err);
            });

            child.on('close', (code) => {
                clearTimeout(timeout);
                console.log(`[RUNNER] Shard ${slug} exited with code ${code}`);
                logStream.write(`\n--- SERVER EXITED WITH CODE ${code} ---\n`);
                logStream.end();
                this.processes.delete(slug);
            });
        });
    }

    async stopShard(slug: string) {
        const shardProc = this.processes.get(slug);
        if (shardProc) {
            console.log(`[RUNNER] Stopping shard ${slug}...`);
            shardProc.process.kill();
            this.processes.delete(slug);
        }
    }

    async restartShard(slug: string): Promise<number> {
        await this.stopShard(slug);
        // Wait a bit for the port to be released
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.startShard(slug);
    }

    async runCommand(slug: string, command: string): Promise<string> {
        const shard = db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug) as any;
        if (!shard) throw new Error(`Shard ${slug} not found`);
        
        const shardPath = path.resolve(shardsStorageDir, slug);
        const logPath = path.join(shardPath, 'logs.txt');
        
        return new Promise((resolve, reject) => {
            fs.appendFileSync(logPath, `\n\n--- EXEC COMMAND: ${command} @ ${new Date().toISOString()} ---\n`);
            
            exec(command, { cwd: shardPath }, (error, stdout, stderr) => {
                if (stdout) fs.appendFileSync(logPath, stdout);
                if (stderr) fs.appendFileSync(logPath, stderr);
                
                if (error) {
                    fs.appendFileSync(logPath, `\n--- EXEC FAILED: ${error.message} ---\n`);
                    return reject(new Error(stderr || error.message));
                }
                
                fs.appendFileSync(logPath, `\n--- EXEC SUCCESS ---\n`);
                resolve(stdout);
            });
        });
    }
}

export const runner = new ShardRunner();
export default runner;
