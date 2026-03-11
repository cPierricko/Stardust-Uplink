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

// Base directory for apps: Production uses fixed path, Dev uses local project path
const isProd = process.env['NODE_ENV'] === 'production';
export const SHARDS_DIR = isProd 
    ? '/home/deploy/storage/apps' 
    : path.resolve(__dirname, '../../shards_storage');

const TEMP_DIR = path.resolve(__dirname, '../../temp');

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

    if (!req.file) {
        return res.status(400).json({ error: 'No ZIP file uploaded' });
    }

    const { name, slug, deploy_method, api_token, env_vars } = req.body;
    
    if (!slug) {
        return res.status(400).json({ error: 'Slug is required' });
    }

    const appSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const extractPath = path.join(SHARDS_DIR, appSlug);

    try {
        // Extract ZIP
        const zip = new AdmZip(req.file.path);
        
        if (fs.existsSync(extractPath)) {
            fs.rmSync(extractPath, { recursive: true, force: true });
        }
        
        fs.mkdirSync(extractPath, { recursive: true });
        zip.extractAllTo(extractPath, true);

        // ZIP Structure Handling: 
        // 1. Clean up common metadata/junk first
        const itemsToClean = ['__MACOSX', '.DS_Store'];
        for (const item of fs.readdirSync(extractPath)) {
            if (itemsToClean.includes(item)) {
                fs.rmSync(path.join(extractPath, item), { recursive: true, force: true });
            }
        }

        // 2. If ZIP contains only a 'dist' folder after cleanup, move its contents to root
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
            api_token || null,
            env_vars || '{}',
            extractPath
        );

        res.json({
            success: true,
            data: {
                id,
                slug: appSlug,
                url: `/shards/${appSlug}`
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

export default router;
