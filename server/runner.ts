import { spawn, exec, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import db from './db.js';

interface ShardProcess {
    process: ChildProcess;
    port: number;
    slug: string;
}

class ShardRunner {
    private processes: Map<string, ShardProcess> = new Map();
    private startPort = 4000;

    constructor() {
        // Automatically restart shards that should have a backend on startup
        setTimeout(() => this.resurrectShards(), 2000);
    }

    private async resurrectShards() {
        console.log('[RUNNER] Resurrecting shards...');
        const shards = db.prepare('SELECT * FROM apps WHERE has_backend = 1').all() as any[];
        for (const shard of shards) {
            try {
                await this.startShard(shard.slug);
            } catch (err) {
                console.error(`[RUNNER] Failed to resurrect shard ${shard.slug}:`, err);
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

    async startShard(slug: string): Promise<number> {
        if (this.processes.has(slug)) {
            console.log(`[RUNNER] Shard ${slug} already running on port ${this.processes.get(slug)!.port}`);
            return this.processes.get(slug)!.port;
        }

        const shard = db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug) as any;
        if (!shard || !shard.path) throw new Error(`Shard ${slug} not found or has no path`);

        const shardPath = shard.path;
        let entryPoint = '';
        
        // Detection logic
        if (fs.existsSync(path.join(shardPath, 'server.js'))) entryPoint = 'server.js';
        else if (fs.existsSync(path.join(shardPath, 'index.js'))) entryPoint = 'index.js';
        else if (fs.existsSync(path.join(shardPath, 'server.ts'))) entryPoint = 'server.ts';
        else if (fs.existsSync(path.join(shardPath, 'index.ts'))) entryPoint = 'index.ts';

        if (!entryPoint) {
            console.log(`[RUNNER] No backend entry point found for ${slug}`);
            db.prepare('UPDATE apps SET has_backend = 0 WHERE slug = ?').run(slug);
            return 0;
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

        // Spawn process
        // Use tsx if it's a .ts file, node otherwise
        const cmd = entryPoint.endsWith('.ts') ? 'npx' : 'node';
        const args = entryPoint.endsWith('.ts') ? ['tsx', entryPoint] : [entryPoint];

        const child = spawn(cmd, args, {
            cwd: shardPath,
            env,
            stdio: 'pipe'
        });

        // Ensure child process is killed if the main server restarts (prevents EADDRINUSE / orphans)
        const cleanup = () => { try { child.kill(); } catch(e) {} };
        process.on('exit', cleanup);
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('SIGUSR2', cleanup); // Used by tsx watch / nodemon

        child.stdout?.on('data', (data) => console.log(`[SHARD:${slug}] ${data}`));
        child.stderr?.on('data', (data) => console.error(`[SHARD:${slug}:ERR] ${data}`));

        // Log to file
        const logPath = path.join(shardPath, 'logs.txt');
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        logStream.write(`\n\n--- SERVER START: ${new Date().toISOString()} ---\n`);
        child.stdout?.pipe(logStream, { end: false });
        child.stderr?.pipe(logStream, { end: false });

        child.on('close', (code) => {
            console.log(`[RUNNER] Shard ${slug} exited with code ${code}`);
            logStream.write(`\n--- SERVER EXITED WITH CODE ${code} ---\n`);
            logStream.end();
            this.processes.delete(slug);
        });

        this.processes.set(slug, { process: child, port, slug });
        return port;
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
        await new Promise(resolve => setTimeout(resolve, 500));
        return this.startShard(slug);
    }

    getRunningPort(slug: string): number | undefined {
        return this.processes.get(slug)?.port;
    }

    async runCommand(slug: string, command: string): Promise<string> {
        const shard = db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug) as any;
        if (!shard || !shard.path) throw new Error(`Shard ${slug} not found or has no path`);
        
        const shardPath = shard.path;
        const logPath = path.join(shardPath, 'logs.txt');
        
        // Ensure log file exists
        if (!fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '');
        }

        return new Promise((resolve, reject) => {
            fs.appendFileSync(logPath, `\n\n--- EXEC COMMAND: ${command} @ ${new Date().toISOString()} ---\n`);
            
            exec(command, { cwd: shardPath }, (error, stdout, stderr) => {
                if (stdout) {
                    fs.appendFileSync(logPath, stdout);
                }
                if (stderr) {
                    fs.appendFileSync(logPath, stderr);
                }
                
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
