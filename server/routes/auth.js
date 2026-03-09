const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const db = require('../db');
const { rpName, rpID, origin } = require('../config/webauthn');
const { jwtSecret } = require('../config/auth');

// Get Initial Setup Token Status
router.get('/status', (req, res) => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
    const userCountRow = stmt.get();
    const isFirstBoot = userCountRow.count === 0;

    const token = req.cookies.jwt;
    if (token) {
        try {
            const decoded = jwt.verify(token, jwtSecret);
            return res.json({ isFirstBoot, isAuthenticated: true, user: { id: decoded.id, username: decoded.username, role: decoded.role } });
        } catch (err) {
            // Token invalid or expired, proceed with unauthenticated status
        }
    }
    res.json({ isFirstBoot, isAuthenticated: false, user: null });
});

// Setup Info - Check if token is valid
router.get('/setup-info', (req, res) => {
    const { token } = req.query;
    const initToken = process.env.INITIAL_SETUP_TOKEN;

    if (initToken && token && token.trim() === initToken.trim()) {
        const stmtCount = db.prepare('SELECT COUNT(*) as count FROM users');
        if (stmtCount.get().count === 0) {
            return res.json({ username: 'root_admin', isInitial: true });
        }
    }

    const stmt = db.prepare('SELECT username, setupTokenExpiresAt FROM users WHERE setupToken = ?');
    const user = stmt.get(token);

    if (!user) return res.status(404).json({ error: 'Invalid or expired enrollment token' });

    if (user.setupTokenExpiresAt && user.setupTokenExpiresAt < Date.now()) {
        db.prepare('UPDATE users SET setupToken = NULL, setupTokenExpiresAt = NULL WHERE setupToken = ?').run(token);
        return res.status(404).json({ error: 'Enrollment token has expired (5min limit)' });
    }

    res.json({ username: user.username });
});

router.post('/generate-registration-options', async (req, res) => {
    try {
        const { setupToken, username } = req.body;
        let user;
        const initToken = process.env.INITIAL_SETUP_TOKEN;

        if (initToken && setupToken && setupToken.trim() === initToken.trim()) {
            const userId = crypto.randomUUID();
            user = { id: userId, username: username || 'admin', role: 'administrator' };
            const stmtCount = db.prepare('SELECT COUNT(*) as count FROM users');
            if (stmtCount.get().count > 0) return res.status(400).json({ error: 'Setup already completed' });

            const stmtIns = db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)');
            stmtIns.run(user.id, user.username, user.role);
            process.env.INITIAL_SETUP_TOKEN = null;

        } else {
            const stmt = db.prepare('SELECT id, username, setupTokenExpiresAt FROM users WHERE setupToken = ?');
            user = stmt.get(setupToken);
            if (!user) return res.status(404).json({ error: 'Invalid or expired setup token' });

            if (user.setupTokenExpiresAt && user.setupTokenExpiresAt < Date.now()) {
                db.prepare('UPDATE users SET setupToken = NULL, setupTokenExpiresAt = NULL WHERE id = ?').run(user.id);
                return res.status(403).json({ error: 'Setup token expired (5min limit)' });
            }

            if (!user.username && username) {
                const checkStmt = db.prepare('SELECT id FROM users WHERE username = ?');
                if (checkStmt.get(username)) return res.status(400).json({ error: 'Username already taken' });

                db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, user.id);
                user.username = username;
            } else if (!user.username && !username) {
                return res.status(400).json({ error: 'Username required for registration' });
            }
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

router.post('/verify-registration', async (req, res) => {
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
            const { credential } = verification.registrationInfo;
            const stmtIns = db.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)');
            stmtIns.run(credential.id, user.id, Buffer.from(credential.publicKey), credential.counter, credential.transports ? JSON.stringify(credential.transports) : '[]');

            const stmtUpd = db.prepare('UPDATE users SET currentChallenge = NULL, setupToken = NULL WHERE id = ?');
            stmtUpd.run(user.id);

            const finalUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
            const token = jwt.sign({ id: finalUser.id, username: finalUser.username, role: finalUser.role }, jwtSecret, { expiresIn: '7d' });
            res.cookie('jwt', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'Strict'
            });
            res.json({ verified: true });

        } else {
            res.status(400).json({ error: 'Verification failed' });
        }
    } catch (error) {
        console.error('[Verify_Reg Error]', error);
        res.status(400).json({ error: error.message });
    }
});

router.get('/generate-authentication-options', async (req, res) => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    global.authChallenges = global.authChallenges || {};
    global.authChallenges[options.challenge] = Date.now();
    for (const c in global.authChallenges) { if (Date.now() - global.authChallenges[c] > 300000) delete global.authChallenges[c]; }
    res.json(options);
});

router.post('/verify-authentication', async (req, res) => {
    const { body } = req.body;
    const stmt = db.prepare('SELECT c.*, u.username, u.role FROM credentials c JOIN users u ON c.user_id = u.id WHERE c.id = ?');
    const credential = stmt.get(body.id);

    if (!credential) return res.status(400).json({ error: 'Unrecognized credential' });

    try {
        const verification = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: (c) => !!global.authChallenges[c],
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
                id: credential.id,
                publicKey: Uint8Array.from(credential.public_key),
                counter: credential.counter,
                transports: JSON.parse(credential.transports),
            },
        });

        if (verification.verified) {
            const stmtUpd = db.prepare('UPDATE credentials SET counter = ? WHERE id = ?');
            stmtUpd.run(verification.authenticationInfo.newCounter, credential.id);

            const token = jwt.sign({ id: credential.user_id, username: credential.username, role: credential.role }, jwtSecret, { expiresIn: '7d' });
            res.cookie('jwt', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'Strict'
            });
            res.json({ verified: true });
        } else {
            res.status(400).json({ error: 'Verification failed' });
        }
    } catch (error) {
        console.error('[Verify_Auth Error]', error);
        res.status(400).json({ error: error.message });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('jwt');
    res.json({ success: true });
});

module.exports = router;
