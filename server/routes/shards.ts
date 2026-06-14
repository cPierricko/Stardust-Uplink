import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import { exec } from 'child_process';
import db from '../db.js';

import { SHARDS_DIR as PATHS_SHARDS_DIR } from '../config/paths.js';
import { ShardBuilder, detectComposeFile, parseComposeServices } from '../services/ShardBuilder.js';
import { ShardRunner } from '../services/ShardRunner.js';
import { ShardLogCollector } from '../services/ShardLogCollector.js';
import Docker from 'dockerode';
import { requireAdmin, requireShardOwnership } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Applique le check de propriété/accès à toutes les routes utilisant :id
router.param('id', requireShardOwnership);


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

    const { name, slug, deploy_method, env_vars, gitUrl } = req.body;
    
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
        if (req.file || gitUrl) {
            if (fs.existsSync(extractPath)) {
                fs.rmSync(extractPath, { recursive: true, force: true });
            }
            fs.mkdirSync(extractPath, { recursive: true });

            if (gitUrl) {
                // Clone from Github
                const { execSync } = await import('child_process');
                console.log(`[SHARDS] Cloning from Git URL: ${gitUrl} for ${appSlug}`);
                execSync(`git clone --depth 1 ${gitUrl} .`, { cwd: extractPath, stdio: 'pipe' });
                
                // Remove .git tracking to isolate shard
                const gitDirPath = path.join(extractPath, '.git');
                if (fs.existsSync(gitDirPath)) fs.rmSync(gitDirPath, { recursive: true, force: true });
                console.log(`[SHARDS] Git clone complete and isolated for ${appSlug}`);
            } else if (req.file) {
                // Extract ZIP
                const zip = new AdmZip(req.file.path);
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
            }

            // RE-APPLY ENVIRONMENT VARIABLES: Ensure .env is restored after wipe/extract/clone
            fs.writeFileSync(path.join(extractPath, '.env'), formatToEnv(finalEnvVars));
            console.log(`[SHARDS] RESTORED_.ENV: ${appSlug} at ${path.join(extractPath, '.env')}`);

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
        // Detect if it has a backend after extraction/clone
        if (req.file || gitUrl) {
            has_backend = detectBackend(extractPath) ? 1 : 0;
        }
        
        // Detect compose mode
        const composeFile = (req.file || gitUrl) ? detectComposeFile(extractPath) : null;
        const isCompose = !!composeFile;
        const composeServices = isCompose ? parseComposeServices(extractPath, composeFile!) : [];

        const api_token = existing ? existing.api_token : crypto.randomUUID();
        const finalId = existing ? existing.id : crypto.randomUUID();

        console.log(`[SHARDS] Final DB stats for ${appSlug}: id=${finalId}, has_backend=${has_backend}, port=${existing?.assigned_port}, compose=${isCompose}`);

        const stmt = db.prepare(`
            INSERT INTO apps (id, name, slug, deploy_method, api_token, env_vars, path, has_backend, assigned_port, status, compose_mode, compose_main_service)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
                name = excluded.name,
                deploy_method = excluded.deploy_method,
                path = excluded.path,
                env_vars = excluded.env_vars,
                api_token = excluded.api_token,
                has_backend = excluded.has_backend,
                status = excluded.status,
                compose_mode = excluded.compose_mode
        `);

        stmt.run(
            finalId,
            name || appSlug,
            appSlug,
            deploy_method || 'manual',
            api_token,
            finalEnvVars,
            extractPath,
            isCompose ? 1 : has_backend,
            existing ? existing.assigned_port : (3000 + Math.floor(Math.random() * 1000)),
            'BUILDING',
            isCompose ? 1 : 0,
            isCompose ? (existing?.compose_main_service || (composeServices[0] ?? null)) : null
        );

        res.json({
            success: true,
            message: 'UPLOAD_SUCCESS / BUILDING_STARTED',
            data: {
                id: finalId,
                slug: appSlug,
                url: `/shards/${appSlug}`,
                api_token,
                status: 'BUILDING',
                compose_mode: isCompose,
                compose_services: composeServices
            }
        });

        // ASYNC DOCKER BUILD & RUN
        if (req.file || gitUrl) {
            (async () => {
                try {
                    await ShardBuilder.build(extractPath, appSlug);

                    // Re-read compose_mode and compose_main_service from DB (may have been set by user)
                    const shardRow = db.prepare('SELECT compose_mode, compose_main_service, env_vars FROM apps WHERE slug = ?').get(appSlug) as any;
                    const useCompose = shardRow?.compose_mode === 1 || isCompose;

                    let bootResult: { ip: string; port: number };
                    if (useCompose) {
                        bootResult = await ShardRunner.bootCompose(appSlug, shardRow?.compose_main_service || null);
                    } else {
                        const isNode = fs.existsSync(path.join(extractPath, 'package.json'));
                        let internalPort = isNode ? 3000 : 80;
                        if (isNode) {
                            try {
                                const pkg = JSON.parse(fs.readFileSync(path.join(extractPath, 'package.json'), 'utf8'));
                                if (pkg.name === 'n8n' || (pkg.dependencies && pkg.dependencies['n8n'])) internalPort = 5678;
                            } catch(e) {}
                        }
                        bootResult = await ShardRunner.boot(appSlug, finalEnvVars, internalPort);
                    }

                    db.prepare('UPDATE apps SET status = ?, internal_ip = ?, assigned_port = ? WHERE slug = ?')
                      .run('DEPLOYED', bootResult.ip, bootResult.port, appSlug);

                    // Start real-time log collection
                    if (useCompose) {
                        ShardLogCollector.startCompose(appSlug);
                    } else {
                        ShardLogCollector.start(appSlug);
                    }

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

        // Stop and remove Docker container and image
        try {
            const docker = new Docker({ socketPath: '/var/run/docker.sock' });
            const containerName = `stardust-shard-${app.slug}`;
            const container = docker.getContainer(containerName);
            
            try { await container.stop(); } catch(e) {}
            try { await container.remove({ force: true }); } catch(e) {}
            
            const image = docker.getImage(`shard-${app.slug}`);
            try { await image.remove({ force: true }); } catch(e) {}
            
            console.log(`[SHARDS] DOCKER_CLEANUP_SUCCESS: ${app.slug}`);
        } catch (dockerErr) {
            console.warn(`[SHARDS] DOCKER_CLEANUP_FAILED: ${app.slug}`, dockerErr);
        }

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

        // Detect compose mode
        const composeFile = detectComposeFile(extractPath);
        const isCompose = !!composeFile;

        // Re-detect backend in case it changed
        const has_backend = detectBackend(extractPath) ? 1 : 0;
        db.prepare('UPDATE apps SET has_backend = ?, status = ?, compose_mode = ? WHERE slug = ?').run(has_backend, 'BUILDING', isCompose ? 1 : 0, shard.slug);

        // ASYNC DOCKER BUILD & RUN (CI/CD push)
        (async () => {
            try {
                await ShardBuilder.build(extractPath, shard.slug);

                const shardRow = db.prepare('SELECT compose_mode, compose_main_service, env_vars FROM apps WHERE slug = ?').get(shard.slug) as any;
                const useCompose = shardRow?.compose_mode === 1 || isCompose;

                let bootResult: { ip: string; port: number };
                if (useCompose) {
                    bootResult = await ShardRunner.bootCompose(shard.slug, shardRow?.compose_main_service || null);
                } else {
                    const isNode = fs.existsSync(path.join(extractPath, 'package.json'));
                    let internalPort = isNode ? 3000 : 80;
                    if (isNode) {
                        try {
                            const pkg = JSON.parse(fs.readFileSync(path.join(extractPath, 'package.json'), 'utf8'));
                            if (pkg.name === 'n8n' || (pkg.dependencies && pkg.dependencies['n8n'])) internalPort = 5678;
                        } catch(e) {}
                    }
                    bootResult = await ShardRunner.boot(shard.slug, shard.env_vars, internalPort);
                }

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
        const user = (req as any).user;
        let shards = [];

        if (user && user.role === 'administrator') {
            const stmt = db.prepare('SELECT * FROM apps ORDER BY name ASC');
            shards = stmt.all() as any[];
        } else if (user) {
            // Operator: only shards they have access to
            const stmt = db.prepare(`
                SELECT a.* FROM apps a
                JOIN user_shard_access usa ON usa.shard_slug = a.slug
                WHERE usa.user_id = ?
                ORDER BY a.name ASC
            `);
            shards = stmt.all(user.id) as any[];
        } else {
            return res.status(401).json({ error: 'Authentication required' });
        }

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
        const shard = db.prepare('SELECT slug, env_vars, assigned_port, compose_mode, compose_main_service FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        res.json({ success: true, message: 'RESTART_INITIATED' });
        db.prepare('UPDATE apps SET status = ? WHERE id = ?').run('BUILDING', id);

        (async () => {
            try {
                let bootResult: { ip: string; port: number };
                if (shard.compose_mode === 1) {
                    bootResult = await ShardRunner.bootCompose(shard.slug, shard.compose_main_service || null);
                } else {
                    bootResult = await ShardRunner.boot(shard.slug, shard.env_vars, shard.assigned_port);
                }
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
        const shard = db.prepare('SELECT slug, env_vars, assigned_port, compose_mode, compose_main_service FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        res.json({ success: true, message: 'START_INITIATED' });
        db.prepare('UPDATE apps SET status = ? WHERE id = ?').run('BUILDING', id);
        (async () => {
            try {
                let bootResult: { ip: string; port: number };
                if (shard.compose_mode === 1) {
                    bootResult = await ShardRunner.bootCompose(shard.slug, shard.compose_main_service || null);
                } else {
                    bootResult = await ShardRunner.boot(shard.slug, shard.env_vars, shard.assigned_port);
                }
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
 * PATCH /api/shards/:id/compose-service
 * Sets the main service name for a compose shard.
 */
router.patch('/:id/compose-service', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { service } = req.body;
    if (!service) return res.status(400).json({ error: 'service name required' });
    try {
        const shard = db.prepare('SELECT slug, path, compose_mode FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });
        if (!shard.compose_mode) return res.status(400).json({ error: 'Shard is not in compose mode' });

        db.prepare('UPDATE apps SET compose_main_service = ? WHERE id = ?').run(service, id);

        // Also return available services for convenience
        const composeFile = detectComposeFile(shard.path);
        const services = composeFile ? parseComposeServices(shard.path, composeFile) : [];

        res.json({ success: true, compose_main_service: service, available_services: services });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/shards/:id/compose-services
 * Returns available services from the compose file.
 */
router.get('/:id/compose-services', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug, path, compose_mode, compose_main_service FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        if (!shard.compose_mode) {
            return res.json({ success: true, compose_mode: false, services: [], compose_main_service: null });
        }

        const composeFile = detectComposeFile(shard.path);
        const services = composeFile ? parseComposeServices(shard.path, composeFile) : [];

        res.json({
            success: true,
            compose_mode: true,
            services,
            compose_main_service: shard.compose_main_service
        });
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
 * Returns buffered or build logs for a shard.
 */
router.get('/:id/logs', async (req: Request, res: Response) => {
    const { id } = req.params;
    const tail = parseInt((req.query['tail'] as string) || '200', 10);
    try {
        const shard = db.prepare('SELECT slug, status, compose_mode FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });
        
        // If building, serve the internal build logs file
        if (shard.status === 'BUILDING') {
            const logPath = path.join(PATHS_SHARDS_DIR, shard.slug, 'logs.txt');
            if (fs.existsSync(logPath)) {
                return res.json({ success: true, logs: fs.readFileSync(logPath, 'utf8'), source: 'build' });
            }
            return res.json({ success: true, logs: 'UPLINK_ESTABLISHING... WAITING_FOR_BUILD_LOGS', source: 'build' });
        }

        // If collector has buffered logs, serve them
        if (ShardLogCollector.isCollecting(shard.slug)) {
            return res.json({ success: true, logs: ShardLogCollector.getLogs(shard.slug, tail), source: 'live' });
        }

        // Fallback: try to read from log file, then docker directly
        const logFilePath = path.join(process.cwd(), 'logs', `shard-${shard.slug}.log`);
        if (fs.existsSync(logFilePath)) {
            const lines = fs.readFileSync(logFilePath, 'utf8').split('\n').filter(Boolean);
            return res.json({ success: true, logs: lines.slice(-tail).join('\n'), source: 'file' });
        }

        // Last resort: docker logs
        try {
            const containerName = `stardust-shard-${shard.slug}`;
            const container = new Docker({ socketPath: '/var/run/docker.sock' }).getContainer(containerName);
            const logs = await container.logs({ stdout: true, stderr: true, tail });
            return res.json({ success: true, logs: logs.toString('utf8'), source: 'docker' });
        } catch {
            return res.json({ success: true, logs: 'NO_LOGS_AVAILABLE', source: 'none' });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/shards/:id/logs/stream
 * Server-Sent Events endpoint for real-time shard logs.
 */
router.get('/:id/logs/stream', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        // Send existing buffered logs first
        const existing = ShardLogCollector.getLogLines(shard.slug, 100);
        for (const line of existing) {
            res.write(`data: ${JSON.stringify(line)}\n\n`);
        }

        // Subscribe to new lines
        const unsubscribe = ShardLogCollector.subscribeToShardLogs(shard.slug, (line) => {
            res.write(`data: ${JSON.stringify(line)}\n\n`);
        });

        // Heartbeat every 15s to keep connection alive
        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 15000);

        req.on('close', () => {
            unsubscribe();
            clearInterval(heartbeat);
        });
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

// ═══════════════════════════════════════════════════════════════
//  PUBLIC ROUTES (Webhook / External access)
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/shards/:id/public-routes
 * List all public routes for a shard.
 */
router.get('/:id/public-routes', requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const routes = db.prepare(
            'SELECT * FROM shard_public_routes WHERE shard_slug = ? ORDER BY created_at ASC'
        ).all(shard.slug) as any[];

        res.json({ success: true, data: routes });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/shards/:id/public-routes
 * Create a new public route for a shard.
 */
router.post('/:id/public-routes', requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const { path_pattern, method = '*', rate_limit_rpm = 60, description = '' } = req.body;

    if (!path_pattern) {
        return res.status(400).json({ error: 'path_pattern is required' });
    }

    // Validate pattern format
    if (!path_pattern.startsWith('/')) {
        return res.status(400).json({ error: 'path_pattern must start with /' });
    }

    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const routeId = crypto.randomUUID();

        // Security warning for broad patterns
        const isBroadPattern = path_pattern === '/*' || path_pattern === '*' || path_pattern === '/';
        if (isBroadPattern) {
            console.warn(`[PUBLIC_ROUTE] WARNING: Broad public route "${path_pattern}" created for shard "${shard.slug}". This exposes all routes without auth!`);
        }

        db.prepare(`
            INSERT INTO shard_public_routes (id, shard_slug, path_pattern, method, rate_limit_rpm, description)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(routeId, shard.slug, path_pattern, method.toUpperCase(), Math.min(rate_limit_rpm, 1000), description);

        const created = db.prepare('SELECT * FROM shard_public_routes WHERE id = ?').get(routeId) as any;
        res.json({ success: true, data: created, warning: isBroadPattern ? 'BROAD_PATTERN_SECURITY_RISK' : null });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/shards/:id/public-routes/:routeId
 * Update an existing public route (rate limit or description).
 */
router.patch('/:id/public-routes/:routeId', requireAdmin, (req: Request, res: Response) => {
    const { id, routeId } = req.params;
    const { rate_limit_rpm, description, method, path_pattern } = req.body;

    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const route = db.prepare('SELECT * FROM shard_public_routes WHERE id = ? AND shard_slug = ?').get(routeId, shard.slug) as any;
        if (!route) return res.status(404).json({ error: 'Route not found' });

        const updates: any = {
            rate_limit_rpm: rate_limit_rpm !== undefined ? Math.min(rate_limit_rpm, 1000) : route.rate_limit_rpm,
            description: description !== undefined ? description : route.description,
            method: method !== undefined ? method.toUpperCase() : route.method,
            path_pattern: path_pattern !== undefined ? path_pattern : route.path_pattern
        };

        db.prepare(`
            UPDATE shard_public_routes 
            SET rate_limit_rpm = ?, description = ?, method = ?, path_pattern = ?
            WHERE id = ?
        `).run(updates.rate_limit_rpm, updates.description, updates.method, updates.path_pattern, routeId);

        const updated = db.prepare('SELECT * FROM shard_public_routes WHERE id = ?').get(routeId) as any;
        res.json({ success: true, data: updated });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/shards/:id/public-routes/:routeId
 * Delete a public route.
 */
router.delete('/:id/public-routes/:routeId', requireAdmin, (req: Request, res: Response) => {
    const { id, routeId } = req.params;
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const result = db.prepare(
            'DELETE FROM shard_public_routes WHERE id = ? AND shard_slug = ?'
        ).run(routeId, shard.slug);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Route not found' });
        }

        res.json({ success: true, message: 'PUBLIC_ROUTE_DELETED' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
//  USER ACCESS MANAGEMENT (Admin Only)
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/shards/:id/access
 * List operators who have access to this shard.
 */
router.get('/:id/access', requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        // Get all operators and whether they have access
        const users = db.prepare(`
            SELECT u.id, u.username, 
                   CASE WHEN usa.user_id IS NOT NULL THEN 1 ELSE 0 END as has_access
            FROM users u
            LEFT JOIN user_shard_access usa ON u.id = usa.user_id AND usa.shard_slug = ?
            WHERE u.role = 'operator'
            ORDER BY u.username ASC
        `).all(shard.slug) as any[];

        res.json({ success: true, data: users });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/shards/:id/access
 * Grant access to an operator for this shard.
 */
router.post('/:id/access', requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        db.prepare(`
            INSERT OR IGNORE INTO user_shard_access (user_id, shard_slug)
            VALUES (?, ?)
        `).run(user_id, shard.slug);

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/shards/:id/access/:userId
 * Revoke access from an operator for this shard.
 */
router.delete('/:id/access/:userId', requireAdmin, (req: Request, res: Response) => {
    const { id, userId } = req.params;
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        db.prepare('DELETE FROM user_shard_access WHERE user_id = ? AND shard_slug = ?').run(userId, shard.slug);

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
