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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.use((req, res, next) => {
    console.log(`[SHARDS_ROUTER] ENTER: ${req.method} ${req.url}`);
    next();
});

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


// Base directory for apps: auto-detect based on filesystem
const isProd = process.env['NODE_ENV'] === 'production';

// Auto-detect SHARDS_DIR: check production path first, fallback to dev
const prodShardsPath = path.resolve(process.cwd(), '../storage/apps');
const devShardsPath = path.resolve(process.cwd(), 'shards_storage');

export const SHARDS_DIR = fs.existsSync(prodShardsPath) ? prodShardsPath : devShardsPath;

const TEMP_DIR = isProd 
    ? '/tmp/stardust-shards'
    : path.resolve(__dirname, '../../temp');

console.log(`[SHARDS_INIT] NODE_ENV=${process.env['NODE_ENV']}, CWD=${process.cwd()}`);
console.log(`[SHARDS_INIT] SHARDS_DIR=${SHARDS_DIR} (exists: ${fs.existsSync(SHARDS_DIR)})`);
console.log(`[SHARDS_INIT] Checked prod path: ${prodShardsPath} (exists: ${fs.existsSync(prodShardsPath)})`);
console.log(`[SHARDS_INIT] Checked dev path: ${devShardsPath} (exists: ${fs.existsSync(devShardsPath)})`);

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
            // If it's an existing shard, we might want to get existing env_vars first
            const existing = db.prepare('SELECT env_vars FROM apps WHERE slug = ?').get(appSlug) as any;
            const finalEnvVars = env_vars || (existing ? existing.env_vars : '{}');
            const envPath = path.join(extractPath, '.env');
            fs.writeFileSync(envPath, formatToEnv(finalEnvVars));
            console.log(`[SHARDS] RESTORED_.ENV: ${appSlug} at ${envPath}`);

            // Install dependencies if package.json exists
            if (fs.existsSync(path.join(extractPath, 'package.json'))) {
                console.log(`[SHARDS] Found package.json for ${appSlug}, running npm install --omit=dev...`);
                await new Promise<void>((resolve, reject) => {
                    exec('npm install --omit=dev', { cwd: extractPath }, (err, stdout, stderr) => {
                        if (err) {
                            console.error(`[SHARDS] npm install failed for ${appSlug}:`, stderr);
                            // We don't reject here to allow the upload to succeed even if install fails
                        } else {
                            console.log(`[SHARDS] npm install succeeded for ${appSlug}`);
                        }
                        resolve();
                    });
                });
            }

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

        // Generate Server-Side Token
        const api_token = crypto.randomUUID();

        // Save to Database
        const id = crypto.randomUUID();
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO apps (id, name, slug, deploy_method, api_token, env_vars, path)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            id,
            name || appSlug,
            appSlug,
            deploy_method || 'manual',
            api_token,
            env_vars || '{}',
            extractPath
        );

        res.json({
            success: true,
            data: {
                id,
                slug: appSlug,
                url: `/shards/${appSlug}`,
                api_token // Return it once for the user to copy
            }
        });

        // ASYNC RESTART: Check for backend and start if needed
        setTimeout(() => {
            runner.startShard(appSlug).catch(err => console.error(`[SHARDS] Auto-start failed for ${appSlug}:`, err));
        }, 1000);

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

        // Install dependencies if package.json exists
        if (fs.existsSync(path.join(extractPath, 'package.json'))) {
            console.log(`[CI/CD] Found package.json for ${shard.slug}, running npm install --omit=dev...`);
            await new Promise<void>((resolve, reject) => {
                exec('npm install --omit=dev', { cwd: extractPath }, (err, stdout, stderr) => {
                    if (err) {
                        console.error(`[CI/CD] npm install failed for ${shard.slug}:`, stderr);
                    } else {
                        console.log(`[CI/CD] npm install succeeded for ${shard.slug}`);
                    }
                    resolve();
                });
            });
        }

        // ASYNC RESTART: Trigger reload
        setTimeout(() => {
            runner.restartShard(shard.slug).catch(err => console.error(`[CI/CD] Auto-restart failed for ${shard.slug}:`, err));
        }, 1000);

        console.log(`[CI/CD] SUCCESSFULLY_DEPLOYED: ${shard.slug}`);
        
        res.json({
            success: true,
            message: 'DEPLOYMENT_SUCCESSFUL',
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
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const port = await runner.restartShard(shard.slug);
        res.json({ success: true, message: 'RESTARTED', port });
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

        const port = runner.getRunningPort(shard.slug);
        res.json({ 
            success: true, 
            status: port ? 'running' : (shard.has_backend ? 'stopped' : 'no_backend'),
            port 
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/shards/:id/start
 * Starts the shard's backend process without full restart if stopped.
 */
router.post('/:id/start', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const port = await runner.startShard(shard.slug);
        res.json({ success: true, message: 'STARTED', port });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/shards/:id/stop
 * Gracefully stops the shard backend.
 */
router.post('/:id/stop', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        await runner.stopShard(shard.slug);
        res.json({ success: true, message: 'STOPPED' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/shards/:id/database
 * Wipes the internal SQLite sqlite.db file for the shard.
 */
router.delete('/:id/database', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT slug, path FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        let wiped = false;
        const allFiles = fs.readdirSync(shard.path);
        
        for (const file of allFiles) {
            if (file.endsWith('.sqlite') || file.endsWith('.db')) {
                const pathToCheck = path.join(shard.path, file);
                if (fs.existsSync(pathToCheck)) {
                    if (!wiped) {
                        await runner.stopShard(shard.slug);
                        wiped = true;
                    }
                    fs.unlinkSync(pathToCheck);
                }
            }
        }

        if (wiped) {
            await runner.startShard(shard.slug);
            return res.json({ success: true, message: 'DATABASE_WIPED_AND_RESTARTED' });
        } else {
            return res.json({ success: true, message: 'NO_DATABASE_FOUND' });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * DELETE /api/shards/:id/logs
 * Clears the latest logs from the shard's backend.
 */
router.delete('/:id/logs', (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT path FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const logPath = path.join(shard.path, 'logs.txt');
        if (fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '');
        }
        res.json({ success: true, message: 'Logs cleared' });
    } catch (err: any) {
        console.error(`[SHARDS] Error clearing logs for ${id}:`, err);
        res.status(500).json({ error: 'Failed to clear logs' });
    }
});

/**
 * GET /api/shards/:id/logs
 * Retrieves the latest logs from the shard's backend.
 */
router.get('/:id/logs', (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const shard = db.prepare('SELECT path FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const logPath = path.join(shard.path, 'logs.txt');
        if (fs.existsSync(logPath)) {
            // Read last N bytes to avoid huge memory usage, or just read whole thing if it's small
            // We'll read the whole thing for simplicity, but ideally we'd tail it.
            const stats = fs.statSync(logPath);
            const chunkSize = 50 * 1024; // Last 50KB
            const startPos = Math.max(0, stats.size - chunkSize);
            
            const stream = fs.createReadStream(logPath, { start: startPos, encoding: 'utf8' });
            let content = '';
            stream.on('data', chunk => content += chunk);
            stream.on('end', () => res.json({ success: true, logs: content }));
        } else {
            res.json({ success: true, logs: 'NO_LOGS_YET' });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/shards/:id/command
 * Executes an arbitrary command within the shard directory.
 */
router.post('/:id/command', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { command } = req.body;
    
    if (!command) return res.status(400).json({ error: 'Command required' });
    
    try {
        const shard = db.prepare('SELECT slug FROM apps WHERE id = ?').get(id) as any;
        if (!shard) return res.status(404).json({ error: 'Shard not found' });

        const output = await runner.runCommand(shard.slug, command);
        res.json({ success: true, output });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
