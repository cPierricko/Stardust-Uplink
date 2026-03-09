const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const AdmZip = require('adm-zip');

// Initialize SimpleWebAuthn
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

// Database initialization
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const APPS_DIR = path.join(__dirname, 'apps');

// Ensure apps directory exists
if (!fs.existsSync(APPS_DIR)) {
    fs.mkdirSync(APPS_DIR, { recursive: true });
}

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Setup Multer for Zip uploads
const upload = multer({ dest: '/tmp/app-deployments/' });

// Serve static apps securely
app.use('/apps', (req, res, next) => {
    // Simple check to prevent basic directory traversal (Express static usually handles this, but good practice)
    const requestedPath = path.normalize(req.path);
    if (requestedPath.includes('..')) {
        return res.status(403).send('Forbidden');
    }
    next();
}, express.static(APPS_DIR));

// === MIDDLEWARE: Deploy Token Check ===
const requireDeployToken = (req, res, next) => {
    const token = req.headers['x-deploy-token'] || req.query.token;
    if (!token) return res.status(401).json({ error: 'Deploy token required' });

    const stmt = db.prepare('SELECT id FROM deploy_tokens WHERE token = ?');
    const tokenRecord = stmt.get(token);

    if (!tokenRecord) return res.status(403).json({ error: 'Invalid deploy token' });
    next();
};

// === MIDDLEWARE: Auth Check ===
const requireAuth = (req, res, next) => {
    const token = req.cookies.jwt;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};


// === ROUTES: Deployment Engine ===
app.post('/api/deploy/:appName', requireDeployToken, upload.single('bundle'), (req, res) => {
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

        res.json({ success: true, message: `App ${appName} deployed successfully` });

    } catch (err) {
        console.error(`[Deploy] Error deploying ${appName}:`, err);
        res.status(500).json({ error: 'Failed to deploy app', details: err.message });
    } finally {
        // Cleanup temp zip
        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    }
});


// === ROUTES: Authentication (WebAuthn / Passkeys) ===

// Get Initial Setup Token Status (to let the frontend know if it's first boot)
app.get('/api/auth/status', (req, res) => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
    const userCountRow = stmt.get();
    res.json({ isFirstBoot: userCountRow.count === 0 });
});

// Setup Info - Check if token is valid
app.get('/api/auth/setup-info', (req, res) => {
    const { token } = req.query;
    const initToken = process.env.INITIAL_SETUP_TOKEN;

    if (initToken && token && token.trim() === initToken.trim()) {
        return res.json({ valid: true, isInitial: true, username: 'Admin' });
    }
    const stmt = db.prepare('SELECT id, username FROM users WHERE setupToken = ?');
    const user = stmt.get(token);
    if (user) return res.json({ valid: true, isInitial: false, username: user.username });
    return res.status(403).json({ error: 'Invalid token' });
});

// Relying Party Configuration
const rpName = 'Rogue One App Center';
const rpID = 'localhost';
const origin = `http://localhost:5173`;

app.post('/api/auth/generate-registration-options', async (req, res) => {
    try {
        const { setupToken, username } = req.body;
        let user;
        const initToken = process.env.INITIAL_SETUP_TOKEN;

        if (initToken && setupToken && setupToken.trim() === initToken.trim()) {
            const userId = crypto.randomUUID();
            user = { id: userId, username: username || 'admin' };
            const stmtCount = db.prepare('SELECT COUNT(*) as count FROM users');
            if (stmtCount.get().count > 0) return res.status(400).json({ error: 'Setup already completed' });

            const stmtIns = db.prepare('INSERT INTO users (id, username) VALUES (?, ?)');
            stmtIns.run(user.id, user.username);
            process.env.INITIAL_SETUP_TOKEN = null;
        } else {
            const stmt = db.prepare('SELECT id, username FROM users WHERE setupToken = ?');
            user = stmt.get(setupToken);
            if (!user) return res.status(403).json({ error: 'Invalid setup token' });
        }

        const stmtCreds = db.prepare('SELECT id FROM credentials WHERE user_id = ?');
        const userCredentials = stmtCreds.all(user.id).map(c => ({
            id: Uint8Array.from(Buffer.from(c.id, 'base64url')),
            type: 'public-key',
        }));

        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userID: Uint8Array.from(user.id, c => c.charCodeAt(0)),
            userName: user.username,
            attestationType: 'none',
            excludeCredentials: userCredentials,
            authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        });

        const stmtUpd = db.prepare('UPDATE users SET currentChallenge = ? WHERE id = ?');
        stmtUpd.run(options.challenge, user.id);

        res.json({ options, userId: user.id });
    } catch (err) {
        console.error('[WebAuthn Error]', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/verify-registration', async (req, res) => {
    const { userId, body } = req.body;
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(userId);

    if (!user || !user.currentChallenge) return res.status(400).json({ error: 'Configuration Error' });

    try {
        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge: user.currentChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: false,
        });

        if (verification.verified && verification.registrationInfo) {
            const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;
            const stmtIns = db.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)');
            stmtIns.run(Buffer.from(credentialID).toString('base64url'), user.id, Buffer.from(credentialPublicKey), counter, body.response.transports ? JSON.stringify(body.response.transports) : '[]');

            const stmtUpd = db.prepare('UPDATE users SET currentChallenge = NULL, setupToken = NULL WHERE id = ?');
            stmtUpd.run(user.id);

            const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
            res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
            res.json({ verified: true });
        } else {
            res.status(400).json({ error: 'Verification failed' });
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/auth/generate-authentication-options', async (req, res) => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    global.authChallenges = global.authChallenges || {};
    global.authChallenges[options.challenge] = Date.now();
    // Cleanup
    for (const c in global.authChallenges) { if (Date.now() - global.authChallenges[c] > 300000) delete global.authChallenges[c]; }
    res.json(options);
});

app.post('/api/auth/verify-authentication', async (req, res) => {
    const { body } = req.body;
    const stmt = db.prepare('SELECT c.*, u.username FROM credentials c JOIN users u ON c.user_id = u.id WHERE c.id = ?');
    const credential = stmt.get(body.id);

    if (!credential) return res.status(400).json({ error: 'Unrecognized credential' });

    try {
        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: (c) => !!global.authChallenges[c],
            expectedOrigin: origin,
            expectedRPID: rpID,
            authenticator: {
                credentialID: Uint8Array.from(Buffer.from(credential.id, 'base64url')),
                credentialPublicKey: Uint8Array.from(credential.public_key),
                counter: credential.counter,
                transports: JSON.parse(credential.transports),
            },
        });

        if (verification.verified) {
            const stmtUpd = db.prepare('UPDATE credentials SET counter = ? WHERE id = ?');
            stmtUpd.run(verification.authenticationInfo.newCounter, credential.id);

            const token = jwt.sign({ id: credential.user_id, username: credential.username }, JWT_SECRET, { expiresIn: '7d' });
            res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
            res.json({ verified: true });
        } else {
            res.status(400).json({ error: 'Verification failed' });
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// === ROUTES: Admin API ===
app.get('/api/admin/users', requireAuth, (req, res) => {
    const stmt = db.prepare('SELECT id, username, setupToken FROM users');
    res.json(stmt.all());
});

app.post('/api/admin/users', requireAuth, (req, res) => {
    const { username } = req.body;
    const userId = crypto.randomUUID();
    const setupToken = crypto.randomBytes(16).toString('hex');
    const stmt = db.prepare('INSERT INTO users (id, username, setupToken) VALUES (?, ?, ?)');
    stmt.run(userId, username, setupToken);
    res.json({ id: userId, username, setupToken });
});

app.delete('/api/admin/users/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM credentials WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.get('/api/admin/tokens', requireAuth, (req, res) => {
    const stmt = db.prepare('SELECT id, token, created_at FROM deploy_tokens');
    res.json(stmt.all());
});

app.post('/api/admin/tokens', requireAuth, (req, res) => {
    const tokenId = crypto.randomUUID();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const stmt = db.prepare('INSERT INTO deploy_tokens (id, token) VALUES (?, ?)');
    stmt.run(tokenId, rawToken);
    res.json({ id: tokenId, token: rawToken });
});

app.delete('/api/admin/tokens/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM deploy_tokens WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('jwt');
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
