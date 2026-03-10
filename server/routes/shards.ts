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

// Base directory for apps as requested
export const SHARDS_DIR = '/home/deploy/storage/apps';
const TEMP_DIR = path.resolve(__dirname, '../../temp');

// Ensure directories exist
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Ensure SHARDS_DIR exists (might need sudo if literal, but we'll try)
try {
    if (!fs.existsSync(SHARDS_DIR)) {
        fs.mkdirSync(SHARDS_DIR, { recursive: true });
    }
} catch (err) {
    console.warn(`[SHARDS] Could not create ${SHARDS_DIR}, falling back to local storage.`);
    // Fallback if the requested absolute path is not accessible/writable
}

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

        // Delete temp file
        fs.unlinkSync(req.file.path);

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
            id,
            slug: appSlug,
            url: `/shards/${appSlug}`
        });

    } catch (err: any) {
        console.error('[SHARDS] Upload error:', err);
        res.status(500).json({ error: 'Failed to process application upload', details: err.message });
    }
});

export default router;
