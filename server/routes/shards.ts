import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import db from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.use((req, res, next) => {
    console.log(`[SHARDS_ROUTER] ENTER: ${req.method} ${req.url}`);
    next();
});

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
router.post('/upload', upload.single('app'), (req: Request, res: Response) => {
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
            if (remainingItems.length === 1 && remainingItems[0] === 'dist') {
                const distPath = path.join(extractPath, 'dist');
                const distItems = fs.readdirSync(distPath);
                for (const item of distItems) {
                    fs.renameSync(path.join(distPath, item), path.join(extractPath, item));
                }
                fs.rmSync(distPath, { recursive: true });
                console.log(`[SHARDS] Flattened nested 'dist' folder for ${appSlug}`);
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
router.delete('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as any;
        if (!app) {
            return res.status(404).json({ success: false, error: 'Shard not found' });
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
    const { env_vars } = req.body;

    try {
        // Validate JSON if it's a string
        if (typeof env_vars === 'string') {
            JSON.parse(env_vars);
        }

        const stmt = db.prepare('UPDATE apps SET env_vars = ? WHERE id = ?');
        const result = stmt.run(
            typeof env_vars === 'string' ? env_vars : JSON.stringify(env_vars),
            id
        );

        if (result.changes === 0) {
            return res.status(404).json({ success: false, error: 'Shard not found' });
        }

        res.json({ success: true, message: 'ENVIRONMENT_UPDATED' });
    } catch (err: any) {
        console.error('[SHARDS] Env update error:', err);
        res.status(400).json({ success: false, error: 'Invalid environment data' });
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
router.post('/push', upload.single('app'), (req: Request, res: Response) => {
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
        if (remainingItems.length === 1 && remainingItems[0] === 'dist') {
            const distPath = path.join(extractPath, 'dist');
            const distItems = fs.readdirSync(distPath);
            for (const item of distItems) {
                fs.renameSync(path.join(distPath, item), path.join(extractPath, item));
            }
            fs.rmSync(distPath, { recursive: true });
            console.log(`[CI/CD] Flattened nested 'dist' folder for ${shard.slug}`);
        }

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
        const shards = stmt.all();
        res.json({ success: true, data: shards });
    } catch (err: any) {
        console.error('[SHARDS] List error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch shards' });
    }
});

export default router;
