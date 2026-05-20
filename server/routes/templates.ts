import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import db from '../db.js';
import { TEMPLATES_DIR } from '../config/paths.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, TEMPLATES_DIR);
    },
    filename: (req, file, cb) => {
        // Generates a unique filename for the physical file
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ storage });

// 1. LIST ALL TEMPLATES (Accessible to any authenticated user)
router.get('/', requireAuth, (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM system_templates ORDER BY created_at DESC');
        const templates = stmt.all();
        res.json({ success: true, data: templates });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. GET TEMPLATE CONTENT (Text files only)
router.get('/:id/content', requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const stmt = db.prepare('SELECT * FROM system_templates WHERE id = ?');
        const template = stmt.get(id) as any;

        if (!template) return res.status(404).json({ success: false, error: 'Template not found' });
        if (!template.is_text) return res.status(400).json({ success: false, error: 'Not a text template' });

        const filePath = path.join(TEMPLATES_DIR, template.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found on disk' });

        const content = fs.readFileSync(filePath, 'utf-8');
        res.json({ success: true, content });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. DOWNLOAD TEMPLATE
router.get('/:id/download', requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const stmt = db.prepare('SELECT * FROM system_templates WHERE id = ?');
        const template = stmt.get(id) as any;

        if (!template) return res.status(404).json({ success: false, error: 'Template not found' });

        const filePath = path.join(TEMPLATES_DIR, template.filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File not found on disk' });

        res.download(filePath, template.filename);
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. CREATE OR UPDATE TEXT TEMPLATE (Admin only)
router.post('/text', requireAuth, requireAdmin, (req, res) => {
    try {
        const { id, filename, description, content } = req.body;
        
        if (!filename || content === undefined) {
            return res.status(400).json({ success: false, error: 'Filename and content required' });
        }

        const filePath = path.join(TEMPLATES_DIR, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        const stats = fs.statSync(filePath);

        if (id) {
            // Update existing
            const updateStmt = db.prepare(`
                UPDATE system_templates 
                SET filename = ?, description = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `);
            updateStmt.run(filename, description || null, stats.size, id);
        } else {
            // Create new
            const newId = crypto.randomUUID();
            const insertStmt = db.prepare(`
                INSERT INTO system_templates (id, filename, description, is_text, size_bytes)
                VALUES (?, ?, ?, 1, ?)
            `);
            insertStmt.run(newId, filename, description || null, stats.size);
        }

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. UPLOAD BINARY TEMPLATE (Admin only)
router.post('/upload', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
    try {
        const { description } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ success: false, error: 'No file uploaded' });

        // Check if the actual original filename already exists in DB
        const checkStmt = db.prepare('SELECT id FROM system_templates WHERE filename = ?');
        const existing = checkStmt.get(file.originalname) as any;

        // Rename the multer-saved file to exactly the originalname in the templates dir
        // (If it already exists on disk, it will overwrite it)
        const finalPath = path.join(TEMPLATES_DIR, file.originalname);
        fs.renameSync(file.path, finalPath);

        const stats = fs.statSync(finalPath);
        const isText = file.originalname.match(/\.(txt|md|yml|yaml|json|html|css|js|ts|sh|env)$/) ? 1 : 0;

        if (existing) {
            const updateStmt = db.prepare(`
                UPDATE system_templates 
                SET description = ?, is_text = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `);
            updateStmt.run(description || null, isText, stats.size, existing.id);
        } else {
            const newId = crypto.randomUUID();
            const insertStmt = db.prepare(`
                INSERT INTO system_templates (id, filename, description, is_text, size_bytes)
                VALUES (?, ?, ?, ?, ?)
            `);
            insertStmt.run(newId, file.originalname, description || null, isText, stats.size);
        }

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. DELETE TEMPLATE (Admin only)
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const { id } = req.params;
        const stmt = db.prepare('SELECT filename FROM system_templates WHERE id = ?');
        const template = stmt.get(id) as any;

        if (template) {
            if (template.filename.startsWith('workflow-')) {
                return res.status(403).json({ success: false, error: 'System templates cannot be deleted.' });
            }

            const filePath = path.join(TEMPLATES_DIR, template.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            const deleteStmt = db.prepare('DELETE FROM system_templates WHERE id = ?');
            deleteStmt.run(id);
        }

        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
