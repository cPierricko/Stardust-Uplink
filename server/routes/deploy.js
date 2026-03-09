const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const AdmZip = require('adm-zip');
const db = require('../db');

// Storage directory
const APPS_DIR = path.join(__dirname, '..', '..', 'storage', 'apps');

// Ensure apps directory exists
if (!fs.existsSync(APPS_DIR)) {
    fs.mkdirSync(APPS_DIR, { recursive: true });
}

// Setup Multer for Zip uploads
const upload = multer({ dest: '/tmp/app-deployments/' });

// MIDDLEWARE: Deploy Token Check
const requireDeployToken = (req, res, next) => {
    const token = req.headers['x-deploy-token'] || req.query.config || req.query.token;
    if (!token) return res.status(401).json({ error: 'Deploy token required' });

    const stmt = db.prepare('SELECT id FROM deploy_tokens WHERE token = ?');
    const tokenRecord = stmt.get(token);

    if (!tokenRecord) return res.status(404).json({ error: 'Invalid or expired deploy token' });
    req.deployTokenId = tokenRecord.id;
    next();
};

// POST /api/deploy/:appName
router.post('/:appName', requireDeployToken, upload.single('bundle'), (req, res) => {
    const { appName } = req.params;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: 'No zip file uploaded' });
    }

    const targetAppDir = path.join(APPS_DIR, appName);
    const envPath = path.join(targetAppDir, '.env');
    let envBackup = null;

    try {
        // 1. Backup .env if it exists
        if (fs.existsSync(envPath)) {
            envBackup = fs.readFileSync(envPath, 'utf8');
            console.log(`[Deploy] Backed up .env for ${appName}`);
        }

        // 2. Extract ZIP
        console.log(`[Deploy] Extracting ${file.path} to ${targetAppDir}`);
        const zip = new AdmZip(file.path);
        zip.extractAllTo(targetAppDir, true);

        // 3. Restore .env
        if (envBackup) {
            fs.writeFileSync(envPath, envBackup, 'utf8');
            console.log(`[Deploy] Restored .env for ${appName}`);
        }

        // 4. Zero-Config Patch: Inject <base href="/apps/:appName/"> into index.html
        const indexPath = path.join(targetAppDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            let html = fs.readFileSync(indexPath, 'utf8');

            const baseTag = `<base href="/apps/${appName}/">`;
            // Check if base tag already exists
            if (!html.includes('<base href=')) {
                // Inject right after <head>
                html = html.replace(/<head[^>]*>/i, match => `${match}\n  ${baseTag}`);
                fs.writeFileSync(indexPath, html, 'utf8');
                console.log(`[Deploy] Injected base href into ${appName}/index.html`);
            }
        }

        // Register app in DB if not exists
        const stmt = db.prepare('INSERT OR IGNORE INTO apps (id, name, path) VALUES (?, ?, ?)');
        stmt.run(crypto.randomUUID(), appName, `/apps/${appName}`);

        // Burn deploy token after success
        if (req.deployTokenId) {
            db.prepare('DELETE FROM deploy_tokens WHERE id = ?').run(req.deployTokenId);
            console.log(`[Deploy] Burned token ID ${req.deployTokenId}`);
        }

        res.json({ success: true, message: `App ${appName} deployed successfully` });

    } catch (err) {
        console.error(`[Deploy] Error deploying ${appName}:`, err);
        res.status(500).json({ error: 'Failed to deploy app', details: err.message });
    } finally {
        // Cleanup temp zip
        if (file && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    }
});

// Export APPS_DIR for static serving in main index.js
router.APPS_DIR = APPS_DIR;

module.exports = router;
