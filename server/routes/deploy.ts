import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import AdmZip from 'adm-zip';
import db from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
export const APPS_DIR = path.resolve(__dirname, '../../apps');

if (!fs.existsSync(APPS_DIR)) {
    fs.mkdirSync(APPS_DIR, { recursive: true });
}

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/upload', upload.single('app'), (req: Request, res: Response) => {
    const token = req.headers['x-deploy-token'];
    if (!token) return res.status(401).json({ error: 'Deploy token required' });

    const stmt = db.prepare('SELECT token FROM deploy_tokens WHERE token = ?');
    if (!stmt.get(token)) return res.status(403).json({ error: 'Invalid deploy token' });

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
        const zip = new AdmZip(req.file.buffer);
        const appName = req.file.originalname.replace('.zip', '');
        const extractPath = path.join(APPS_DIR, appName);

        if (fs.existsSync(extractPath)) {
            fs.rmSync(extractPath, { recursive: true });
        }

        zip.extractAllTo(extractPath, true);

        const dbStmt = db.prepare('INSERT OR REPLACE INTO apps (id, name, path) VALUES (?, ?, ?)');
        dbStmt.run(appName, appName, extractPath);

        res.json({ success: true, url: `/apps/${appName}` });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default { router, APPS_DIR };
