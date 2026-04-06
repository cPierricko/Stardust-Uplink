import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import { exec } from 'child_process';
import db from '../db.js';
import runner from '../runner.js';
import { SHARDS_DIR as PATHS_SHARDS_DIR } from '../config/paths.js';
import { ShardBuilder } from '../services/ShardBuilder.js';
import { ShardRunner } from '../services/ShardRunner.js';
import Docker from 'dockerode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();


// Helper to parse .env format to JSON string record
const parseEnvToJSON = (content: string) => {
    const lines = content.split('\n');
    const result: Record<string, string> = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index > -1) {
            const key = trimmed.substring(0, index).trim();
            const value = trimmed.substring(index + 1).trim().replace(/^['"](.*)['"]$/, '$1');
            if (key) result[key] = value;
        }
    }
    return JSON.stringify(result);
};

// Helper to convert JSON string/object to .env format
const formatToEnv = (vars: any) => {
    if (!vars) return '';
    try {
        const obj = typeof vars === 'string' ? JSON.parse(vars) : vars;
        return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n');
    } catch {
        return vars; // Already in .env or other format
    }
};

// Helper to detect if a shard has a backend entry point
const detectBackend = (shardPath: string) => {
    const entries = ['server.cjs', 'server.js', 'index.cjs', 'index.js', 'server.ts', 'index.ts', 'main.js', 'app.js'];
    const found = entries.filter(e => fs.existsSync(path.join(shardPath, e)));
    console.log(`[SHARDS] detectBackend at ${shardPath}: found [${found.join(', ')}]`);
    return found.length > 0;
};


// Base directory for apps: use shared path config
const isProd = process.env['NODE_ENV'] === 'production';

export const SHARDS_DIR = PATHS_SHARDS_DIR;

const TEMP_DIR = isProd 
    ? '/tmp/stardust-shards'
    : path.resolve(__dirname, '../../temp');

console.log(`[SHARDS_INIT] NODE_ENV=${process.env['NODE_ENV']}, CWD=${process.cwd()}`);
console.log(`[SHARDS_INIT] SHARDS_DIR=${SHARDS_DIR} (exists: ${fs.existsSync(SHARDS_DIR)})`);

// Helper to ensure critical directories exist
const ensureDirs = () => {
    [TEMP_DIR, SHARDS_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[SHARDS] Initialized directory: ${dir}`);
            } catch (err) {
                console.error(`[SHARDS] SYSTEM_CRITICAL: Could not initialize ${dir}. Storage may be unavailable.`);
            }
        }
    });
};

// Initial setup
ensureDirs();

// Multer configuration for temporary storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, TEMP_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '.zip');
    }
});

const upload = multer({ storage });

/**
 * POST /api/shards/upload
 * Expects: ZIP file in 'app' field, 'name' and 'slug' in body.
 */
router.post('/upload', upload.single('app'), async (req: Request, res: Response) => {
    // Audit storage readiness for every request
    ensureDirs();

    const { name, slug, deploy_method, env_vars } = req.body;
    
    if (!slug) {
        return res.status(400).json({ error: 'Slug is required' });
    }

    const appSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const extractPath = path.join(SHARDS_DIR, appSlug);

    // Initial detection and merge
    const existing = db.prepare('SELECT id, env_vars, api_token, assigned_port FROM apps WHERE slug = ?').get(appSlug) as any;
    const finalEnvVars = env_vars || (existing ? existing.env_vars : '{}');
    let has_backend = existing ? existing.has_backend : 0;

    try {
        if (req.file) {
            // Extract ZIP
            const zip = new AdmZip(req.file.path);
            
            if (fs.existsSync(extractPath)) {
                fs.rmSync(extractPath, { recursive: true, force: true });
            }
            
            fs.mkdirSync(extractPath, { recursive: true });
            zip.extractAllTo(extractPath, true);

            // ZIP Structure Handling (Flattening)
            const itemsToClean = ['__MACOSX', '.DS_Store'];
            for (const item of fs.readdirSync(extractPath)) {
                if (itemsToClean.includes(item)) {
                    fs.rmSync(path.join(extractPath, item), { recursive: true, force: true });
                }
            }

            const remainingItems = fs.readdirSync(extractPath);
            if (remainingItems.length === 1) {
                const singleItemPath = path.join(extractPath, remainingItems[0]);
                if (fs.statSync(singleItemPath).isDirectory()) {
                    const distItems = fs.readdirSync(singleItemPath);
                    for (const item of distItems) {
                        fs.renameSync(path.join(singleItemPath, item), path.join(extractPath, item));
                    }
                    fs.rmSync(singleItemPath, { recursive: true });
                    console.log(`[SHARDS] Flattened nested folder '${remainingItems[0]}' for ${appSlug}`);
                }
            }

            // RE-APPLY ENVIRONMENT VARIABLES: Ensure .env is restored after wipe/extract
            fs.writeFileSync(path.join(extractPath, '.env'), formatToEnv(finalEnvVars));
            console.log(`[SHARDS] RESTORED_.ENV: ${appSlug} at ${path.join(extractPath, '.env')}`);

            // Install dependencies block removed - now handled by ShardBuilder async pipeline

        } else {
            // Initialize EMPTY/SHELL shard
            if (fs.existsSync(extractPath)) {
                fs.rmSync(extractPath, { recursive: true, force: true });
            }
            fs.mkdirSync(extractPath, { recursive: true });
            
            const placeholder = `
<!DOCTYPE html>
<html>
<head>
    <title>Shard Pending</title>
    <style>
        body { background: #0a0f18; color: #00d4ff; font-family: monospace; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .box { border: 1px solid #00d4ff50; padding: 2rem; text-align: center; }
        .blink { animation: blink 1s steps(1) infinite; }
        @keyframes blink { 50% { opacity: 0; } }
    </style>
</head>
<body>
    <div class="box">
        <div>UPLINK_ESTABLISHED: ${appSlug.toUpperCase()}</div>
        <div style="margin-top: 10px; color: #334155;">STATUS: WAITING_FOR_PAYLOAD<span class="blink">_</span></div>
    </div>
</body>
</html>`;
            fs.writeFileSync(path.join(extractPath, 'index.html'), placeholder);
            console.log(`[SHARDS] Initialized shell shard: ${appSlug}`);
        }

        // Save to Database
        // Detect if it has a backend after extraction (IF file was uploaded)
        if (req.file) {
            has_backend = detectBackend(extractPath) ? 1 : 0;
        }
        
        const api_token = existing ? existing.api_token : crypto.randomUUID();
        const finalId = existing ? existing.id : crypto.randomUUID();

        console.log(`[SHARDS] Final DB stats for ${appSlug}: id=${finalId}, has_backend=${has_backend}, port=${existing?.assigned_port}`);

        const stmt = db.prepare(`
            INSERT INTO apps (id, name, slug, deploy_method, api_token, env_vars, path, has_backend, assigned_port, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
                name = excluded.name,
                deploy_method = excluded.deploy_method,
                path = excluded.path,
                env_vars = excluded.env_vars,
                api_token = excluded.api_token,
                has_backend = excluded.has_backend,
                status = excluded.status
        `);

        stmt.run(
            finalId,
            name || appSlug,
            appSlug,
            deploy_method || 'manual',
            api_token,
            finalEnvVars, // Use the merged env_vars
            extractPath,
            has_backend,
            existing ? existing.assigned_port : (3000 + Math.floor(Math.random() * 1000)),
            'BUILDING'
        );

        res.json({
            success: true,
            message: 'UPLOAD_SUCCESS / BUILDING_STARTED',
            data: {
                id: finalId,
                slug: appSlug,
                url: `/shards/${appSlug}`,
                api_token,
                status: 'BUILDING'
            }
        });

        // ASYNC DOCKER BUILD & RUN
        if (req.file) {
            (async () => {
                try {
                    await ShardBuilder.build(extractPath, appSlug);
                    const isNode = fs.existsSync(path.join(extractPath, 'package.json'));
                    let internalPort = isNode ? 3000 : 80;
                    if (isNode) {
                        try {
                            const pkg = JSON.parse(fs.readFileSync(path.join(extractPath, 'package.json'), 'utf8'));
                            if (pkg.name === 'n8n' || (pkg.dependencies && pkg.dependencies['n8n'])) internalPort = 5678;
                        } catch(e) {}
                    }
                    
                    const bootResult = await ShardRunner.boot(appSlug, finalEnvVars, internalPort);
                    
                    db.prepare('UPDATE apps SET status = ?, internal_ip = ?, assigned_port = ? WHERE slug = ?')
                      .run('DEPLOYED', bootResult.ip, bootResult.port, appSlug);
                    
                    console.log(`[SHARDS] Auto-deploy succeeded for ${appSlug}. IP: ${bootResult.ip}:${bootResult.port}`);
                } catch (err) {
                    console.error(`[SHARDS] Auto-deploy failed for ${appSlug}:`, err);
                    db.prepare('UPDATE apps SET status = ? WHERE slug = ?').run('FAILED', appSlug);
                }
            })();
        } else {
            db.prepare('UPDATE apps SET status = ? WHERE slug = ?').run('READY', appSlug);
        }

    } catch (err: any) {
        console.error('[SHARDS] Upload error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to process application upload', 
            details: err.message 
        });
    } finally {
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkErr) {
                console.error('[SHARDS] Failed to clean up temp file:', unlinkErr);
            }
        }
    }
});

/**
 * DELETE /api/shards/:id
 * Removes shard files and database entry.
 */
router.delete('/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as any;
        if (!app) {
            return res.status(404).json({ success: false, error: 'Shard not found' });
        }

        // Stop running process
        await runner.stopShard(app.slug);

        // Remove files
        if (app.path && fs.existsSync(app.path)) {
            try {
                fs.rmSync(app.path, { recursive: true, force: true });
                console.log(`[SHARDS] DELETED_FILES: ${app.slug} at ${app.path}`);
            } catch (fsErr: any) {
                console.warn(`[SHARDS] FILE_CLEANUP_FAILED: ${app.slug}. Proceeding with DB removal.`, fsErr.message);
            }
        } else {
            console.warn(`[SHARDS] DELETE_SKIPPED: Path not found for ${app.slug}`);
        }

        // Remove from DB
        const result = db.prepare('DELETE FROM apps WHERE id = ?').run(id);
        console.log(`[SHARDS] DB_REMOVAL: ${app.slug} (Affected: ${result.changes})`);

        res.json({ success: true, message: 'SHARD_DELETED_SUCCESSFULLY' });
    } catch (err: any) {
        console.error('[SHARDS] CRITICAL_DELETE_ERROR:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete shard',
            details: err.message 
        });
    }
});

/**
 * PATCH /api/shards/:id/env
 * Updates environment variables.
 */
router.patch('/:id/env', (req: Request, res: Response) => {
    const { id } = req.params;
    const { env_vars } = req.body; // Expected to be in .env format string from now on

    try {
        const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as any;
        if (!app) {
            return res.status(404).json({ success: false, error: 'Shard not found' });
        }

        // We store it as standard .env text in the database now for consistency
        // but if it's already JSON we keep it for now and convert to .env for the file
        const stmt = db.prepare('UPDATE apps SET env_vars = ? WHERE id = ?');
        stmt.run(env_vars, id);

        // SYNC WITH FILESYSTEM: Write .env file
        if (app.path && fs.existsSync(app.path)) {
            const envPath = path.join(app.path, '.env');
            fs.writeFileSync(envPath, env_vars);
            console.log(`[SHARDS] SYNCED_.ENV: ${app.slug} at ${envPath}`);
        }

        res.json({ success: true, message: 'ENVIRONMENT_UPDATED' });
    } catch (err: any) {
        console.error('[SHARDS] Env update error:', err);
        res.status(400).json({ success: false, error: 'Failed to update environment' });
    }
});


/**
 * GET /api/shards/:id/token
 * Returns the deployment token.
 */
router.get('/:id/token', (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const app = db.prepare('SELECT api_token FROM apps WHERE id = ?').get(id) as any;
        if (!app) {
            return res.status(404).json({ success: false, error: 'Shard not found' });
        }

        res.json({ success: true, api_token: app.api_token });
    } catch (err: any) {
        console.error('[SHARDS] Token fetch error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch token' });
    }
});

/**
 * POST /api/shards/push
 * CI/CD Endpoint: Authenticates via X-Stardust-Token.
 * Expects: ZIP file in 'app' field.
 */
router.post('/push', upload.single('app'), async (req: Request, res: Response) => {
    const token = req.headers['x-stardust-token'];
    
    if (!token) {
        return res.status(401).json({ success: false, error: 'X-Stardust-Token header required' });
    }

    try {
        // Find shard by token
        const shard = db.prepare('SELECT * FROM apps WHERE api_token = ?').get(token) as any;
        
        if (!shard) {
            return res.status(403).json({ success: false, error: 'Invalid deployment token' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No ZIP file uploaded' });
        }

        console.log(`[CI/CD] Incoming push for shard: ${shard.slug} (${shard.name})`);
        
        const extractPath = shard.path;

        // Ensure directory exists (it should if shard exists, but good to be safe)
        if (!fs.existsSync(extractPath)) {
            fs.mkdirSync(extractPath, { recursive: true });
        }

        // Extract ZIP
        const zip = new AdmZip(req.file.path);
        
        // Clean existing files if necessary, or just extract over them
        // For a true "push", usually we want to wipe the old state
        const items = fs.readdirSync(extractPath);
        for (const item of items) {
             fs.rmSync(path.join(extractPath, item), { recursive: true, force: true });
        }
        
        zip.extractAllTo(extractPath, true);

        // ZIP Flattening Logic (re-use same as upload)
        const itemsToClean = ['__MACOSX', '.DS_Store'];
        for (const item of fs.readdirSync(extractPath)) {
            if (itemsToClean.includes(item)) {
                fs.rmSync(path.join(extractPath, item), { recursive: true, force: true });
            }
        }

        const remainingItems = fs.readdirSync(extractPath);
        if (remainingItems.length === 1) {
            const singleItemPath = path.join(extractPath, remainingItems[0]);
            if (fs.statSync(singleItemPath).isDirectory()) {
                const distItems = fs.readdirSync(singleItemPath);
                for (const item of distItems) {
                    fs.renameSync(path.join(singleItemPath, item), path.join(extractPath, item));
                }
                fs.rmSync(singleItemPath, { recursive: true });
                console.log(`[CI/CD] Flattened nested folder '${remainingItems[0]}' for ${shard.slug}`);
            }
        }

        // RE-APPLY ENVIRONMENT VARIABLES: Restore from database after wipe/extract
        const envPath = path.join(extractPath, '.env');
        fs.writeFileSync(envPath, formatToEnv(shard.env_vars));
        console.log(`[CI/CD] RESTORED_.ENV: ${shard.slug} at ${envPath}`);

        // Re-detect backend in case it changed
        const has_backend = detectBackend(extractPath) ? 1 : 0;
        db.prepare('UPDATE apps SET has_backend = ?, status = ? WHERE slug = ?').run(has_backend, 'BUILDING', shard.slug);

        // ASYNC DOCKER BUILD & RUN
        (async () => {
            try {
                await ShardBuilder.build(extractPath, shard.slug);
                const isNode = fs.existsSync(path.join(extractPath, 'package.json'));
                let internalPort = isNode ? 3000 : 80;
                if (isNode) {
                    try {
                        const pkg = JSON.parse(fs.readFileSync(path.join(extractPath, 'package.json'), 'utf8'));
                        if (pkg.name === 'n8n' || (pkg.dependencies && pkg.dependencies['n8n'])) internalPort = 5678;
                    } catch(e) {}
                }
                
                const bootResult = await ShardRunner.boot(shard.slug, shard.env_vars, internalPort);
                
                db.prepare('UPDATE apps SET status = ?, internal_ip = ?, assigned_port = ? WHERE slug = ?')
                  .run('DEPLOYED', bootResult.ip, bootResult.port, shard.slug);
                
                console.log(`[CI/CD] Auto-deploy succeeded for ${shard.slug}. IP: ${bootResult.ip}:${bootResult.port}`);
            } catch (err) {
                console.error(`[CI/CD] Auto-deploy failed for ${shard.slug}:`, err);
                db.prepare('UPDATE apps SET status = ? WHERE slug = ?').run('FAILED', shard.slug);
            }
        })();

        console.log(`[CI/CD] BUILDING_STARTED: ${shard.slug}`);
        
        res.json({
            success: true,
            message: 'BUILDING_STARTED',
            data: {
                slug: shard.slug,
                url: `/shards/${shard.slug}`
            }
        });

    } catch (err: any) {
        console.error('[CI/CD] Push error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to process automated deployment', 
            details: err.message 
        });
    } finally {
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkErr) {
                console.error('[CI/CD] Cleanup failed:', unlinkErr);
            }
        }
    }
});

/**
 * GET /api/shards
 * Returns all shards from the database.
 */
router.get('/', (req: Request, res: Response) => {
    try {
        const stmt = db.prepare('SELECT * FROM apps ORDER BY name ASC');
        const shards = stmt.all() as any[];

        // Enhance shards with actual .env file content if present
        const enhancedShards = shards.map(shard => {
            if (shard.path && fs.existsSync(shard.path)) {
                const envPath = path.join(shard.path, '.env');
                if (fs.existsSync(envPath)) {
                    shard.env_vars = fs.readFileSync(envPath, 'utf8');
                } else if (shard.env_vars && shard.env_vars.startsWith('{')) {
                    // Migration: if DB has JSON but no .env file, convert for the frontend
                    shard.env_vars = formatToEnv(shard.env_vars);
                }
            }
            return shard;
        });

        res.json({ success: true, data: enhancedShards });
    } catch (err: any) {
        console.error('[SHARDS] List error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch shards' });
    }
});

/**
 * POST /api/shards/:id/restart
 * Restarts the shard's backend process.
 */
router.post('/:id/restart', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug, env_vars, assigned_port FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        // Send early response
        res.json({ success: true, message: 'RESTART_INITIATED' });
        
        // Update db and reboot in background
        db.prepare('UPDATE apps SET status = ? WHERE id = ?').run('BUILDING', id);
        
        (async () => {
            try {
                const bootResult = await ShardRunner.boot(shard.slug, shard.env_vars, shard.assigned_port);
                db.prepare('UPDATE apps SET status = ?, internal_ip = ?, assigned_port = ? WHERE slug = ?')
                  .run('DEPLOYED', bootResult.ip, bootResult.port, shard.slug);
            } catch (err) {
                console.error(`[SHARDS] Restart failed for ${shard.slug}:`, err);
                db.prepare('UPDATE apps SET status = ? WHERE slug = ?').run('FAILED', shard.slug);
            }
        })();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/shards/:id/status
 * Check if the shard is running and on which port.
 */
router.get('/:id/status', (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug, has_backend FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const shardInfo = db.prepare('SELECT status, assigned_port FROM apps WHERE slug = ?').get(shard.slug) as any;
        res.json({ 
            success: true, 
            status: shardInfo.status === 'DEPLOYED' ? 'running' : shardInfo.status,
            port: shardInfo.assigned_port
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/shards/:id/start
 */
router.post('/:id/start', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug, env_vars, assigned_port FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        res.json({ success: true, message: 'START_INITIATED' });
        db.prepare('UPDATE apps SET status = ? WHERE id = ?').run('BUILDING', id);
        (async () => {
            try {
                const bootResult = await ShardRunner.boot(shard.slug, shard.env_vars, shard.assigned_port);
                db.prepare('UPDATE apps SET status = ?, internal_ip = ?, assigned_port = ? WHERE slug = ?')
                  .run('DEPLOYED', bootResult.ip, bootResult.port, shard.slug);
            } catch (err) {
                db.prepare('UPDATE apps SET status = ? WHERE slug = ?').run('FAILED', shard.slug);
            }
        })();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/shards/:id/stop
 */
router.post('/:id/stop', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const containerName = `stardust-shard-${shard.slug}`;
        try {
             const container = new Docker({ socketPath: '/var/run/docker.sock' }).getContainer(containerName);
             await container.stop();
        } catch(e) {}
        
        db.prepare('UPDATE apps SET status = ? WHERE id = ?').run('FAILED', id);
        res.json({ success: true, message: 'STOPPED' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/shards/:id/database
 */
router.delete('/:id/database', async (req: Request, res: Response) => {
    return res.status(501).json({ error: 'Function disabled in cloud architecture' });
});

/**
 * DELETE /api/shards/:id/logs
 */
router.delete('/:id/logs', (req: Request, res: Response) => {
    res.json({ success: true, message: 'Logs managed by Docker' });
});

/**
 * GET /api/shards/:id/logs
 */
router.get('/:id/logs', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });
        
        const containerName = `stardust-shard-${shard.slug}`;
        try {
             const container = new Docker({ socketPath: '/var/run/docker.sock' }).getContainer(containerName);
             const logs = await container.logs({ stdout: true, stderr: true, tail: 100 });
             res.json({ success: true, logs: logs.toString('utf8') });
        } catch (e) {
             res.json({ success: true, logs: 'NO_DOCKER_LOGS_YET' });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/shards/:id/command
 */
router.post('/:id/command', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Command required' });
    
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const containerName = `stardust-shard-${shard.slug}`;
        try {
             const container = new Docker({ socketPath: '/var/run/docker.sock' }).getContainer(containerName);
             const exec = await container.exec({
                  Cmd: ['sh', '-c', command],
                  AttachStdout: true,
                  AttachStderr: true
             });
             const stream = await exec.start({ Detach: false });
             let output = '';
             stream.on('data', chunk => output += chunk.toString('utf8'));
             stream.on('end', () => res.json({ success: true, output }));
        } catch (e: any) {
             res.status(500).json({ error: e.message });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
