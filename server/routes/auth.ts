import express, { Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
    VerifiedRegistrationResponse,
    VerifiedAuthenticationResponse
} from '@simplewebauthn/server';
import db from '../db.js';
import { jwtSecret } from '../config/auth.js';
import { User, AuthStatus } from '../../shared/types.js';

const router = express.Router();

// RP Configuration
const RP_NAME = 'Rogue One App Center';

const getRPConfig = (req: Request) => {
    const isProd = process.env['NODE_ENV'] === 'production';
    let ORIGIN = isProd ? 'https://rogue-one.cloud' : 'http://localhost:5173';
    let RP_ID = isProd ? 'rogue-one.cloud' : 'localhost';
    
    const originHeader = req.get('origin') || req.get('referer');
    if (originHeader) {
        try {
            const url = new URL(originHeader);
            ORIGIN = url.origin;
            RP_ID = url.hostname;
        } catch (e) {}
    }
    
    return { ORIGIN, RP_ID };
};

// Store for authentication challenges (in-memory for simple implementation)
const authChallenges: Record<string, number> = {};

// Clean up old challenges
setInterval(() => {
    const now = Date.now();
    for (const challenge in authChallenges) {
        if (now - (authChallenges[challenge] || 0) > 300000) {
            delete authChallenges[challenge];
        }
    }
}, 60000);

// Get Initial Setup Token Status
router.get('/status', (req: Request, res: Response) => {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
    const userCountRow = stmt.get() as { count: number };
    const needsSetup = userCountRow.count === 0;

    const token = req.cookies.jwt;
    if (token) {
        try {
            const decoded = jwt.verify(token, jwtSecret) as { id: string; username: string; role: string };
            return res.json({
                needsSetup,
                isAuthenticated: true,
                user: { id: decoded.id, username: decoded.username, role: decoded.role }
            });
        } catch (err) {
            // Token invalid or expired
        }
    }
    res.json({ needsSetup, isAuthenticated: false, user: null });
});

// Setup Info
router.get('/setup-info', (req: Request, res: Response) => {
    const { token } = req.query as { token?: string };
    const initToken = process.env['INITIAL_SETUP_TOKEN'];

    if (initToken && token && token.trim() === initToken.trim()) {
        const stmtCount = db.prepare('SELECT COUNT(*) as count FROM users');
        const countRow = stmtCount.get() as { count: number };
        if (countRow.count === 0) {
            return res.json({ username: 'root_admin', isInitial: true });
        }
    }

    const stmt = db.prepare('SELECT username, setupTokenExpiresAt FROM users WHERE setupToken = ?');
    const user = stmt.get(token) as { username: string; setupTokenExpiresAt: number | null } | undefined;

    if (!user) return res.status(404).json({ error: 'Invalid or expired enrollment token' });

    if (user.setupTokenExpiresAt && user.setupTokenExpiresAt < Date.now()) {
        db.prepare('UPDATE users SET setupToken = NULL, setupTokenExpiresAt = NULL WHERE setupToken = ?').run(token);
        return res.status(404).json({ error: 'Enrollment token has expired (5min limit)' });
    }

    res.json({ username: user.username });
});

router.post('/generate-registration-options', async (req: Request, res: Response) => {
    try {
        const { setupToken, username } = req.body;
        let user: { id: string; username: string; role: string } | undefined;
        const initToken = process.env['INITIAL_SETUP_TOKEN'];

        if (initToken && setupToken && setupToken.trim() === initToken.trim()) {
            const userId = crypto.randomUUID();
            user = { id: userId, username: username || 'admin', role: 'administrator' };
            const stmtCount = db.prepare('SELECT COUNT(*) as count FROM users');
            const countRow = stmtCount.get() as { count: number };
            if (countRow.count > 0) return res.status(400).json({ error: 'Setup already completed' });

            const stmtIns = db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)');
            stmtIns.run(user.id, user.username, user.role);
            delete process.env['INITIAL_SETUP_TOKEN'];

        } else {
            const stmt = db.prepare('SELECT id, username, setupTokenExpiresAt FROM users WHERE setupToken = ?');
            const existingUser = stmt.get(setupToken) as { id: string; username: string | null; setupTokenExpiresAt: number | null } | undefined;
            if (!existingUser) return res.status(404).json({ error: 'Invalid or expired setup token' });

            if (existingUser.setupTokenExpiresAt && existingUser.setupTokenExpiresAt < Date.now()) {
                db.prepare('UPDATE users SET setupToken = NULL, setupTokenExpiresAt = NULL WHERE id = ?').run(existingUser.id);
                return res.status(403).json({ error: 'Setup token expired (5min limit)' });
            }

            if (!existingUser.username && username) {
                const checkStmt = db.prepare('SELECT id FROM users WHERE username = ?');
                if (checkStmt.get(username)) return res.status(400).json({ error: 'Username already taken' });

                db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, existingUser.id);
                user = { id: existingUser.id, username, role: 'operator' };
            } else if (!existingUser.username && !username) {
                return res.status(400).json({ error: 'Username required for registration' });
            } else {
                user = { id: existingUser.id, username: existingUser.username!, role: 'operator' };
            }
        }

        const stmtCreds = db.prepare('SELECT id FROM credentials WHERE user_id = ?');
        const userCredentials = (stmtCreds.all(user.id) as { id: string }[]).map(c => ({
            id: c.id,
            type: 'public-key' as const,
        }));

        const { ORIGIN, RP_ID } = getRPConfig(req);

        const options = await generateRegistrationOptions({
            rpName: RP_NAME,
            rpID: RP_ID,
            userID: Uint8Array.from(user.id, c => c.charCodeAt(0)),
            userName: user.username,
            attestationType: 'none',
            excludeCredentials: userCredentials,
            authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        });

        const stmtUpd = db.prepare('UPDATE users SET currentChallenge = ? WHERE id = ?');
        stmtUpd.run(options.challenge, user.id);

        res.json({ options, userId: user.id });
    } catch (err: any) {
        console.error('[WebAuthn Error]', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/verify-registration', async (req: Request, res: Response) => {
    const { userId, body } = req.body;
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(userId) as { id: string; currentChallenge: string | null; username: string; role: string } | undefined;

    if (!user || !user.currentChallenge) return res.status(400).json({ error: 'Configuration Error' });

    try {
        const { ORIGIN, RP_ID } = getRPConfig(req);

        const verification: VerifiedRegistrationResponse = await verifyRegistrationResponse({
            response: body,
            expectedChallenge: user.currentChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            requireUserVerification: false,
        });

        if (verification.verified && verification.registrationInfo) {
            const { id, publicKey, counter } = verification.registrationInfo.credential;
            const stmtIns = db.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)');
            stmtIns.run(id, user.id, Buffer.from(publicKey), counter, JSON.stringify(body.response.transports || []));

            const stmtUpd = db.prepare('UPDATE users SET currentChallenge = NULL, setupToken = NULL WHERE id = ?');
            stmtUpd.run(user.id);

            const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: '7d' });
            res.cookie('jwt', token, {
                httpOnly: true,
                secure: process.env['NODE_ENV'] === 'production',
                sameSite: 'strict'
            });
            res.json({ verified: true });

        } else {
            res.status(400).json({ error: 'Verification failed' });
        }
    } catch (error: any) {
        console.error('[Verify_Reg Error]', error);
        res.status(400).json({ error: error.message });
    }
});

router.get('/generate-authentication-options', async (req: Request, res: Response) => {
    const { RP_ID } = getRPConfig(req);
    const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred' });
    authChallenges[options.challenge] = Date.now();
    res.json(options);
});

router.post('/verify-authentication', async (req: Request, res: Response) => {
    const { body } = req.body;
    const stmt = db.prepare('SELECT c.*, u.username, u.role FROM credentials c JOIN users u ON c.user_id = u.id WHERE c.id = ?');
    const credential = stmt.get(body.id) as { id: string; user_id: string; public_key: Buffer; counter: number; transports: string; username: string; role: string } | undefined;

    if (!credential) return res.status(400).json({ error: 'Unrecognized credential' });

    try {
        const { ORIGIN, RP_ID } = getRPConfig(req);

        const verification: VerifiedAuthenticationResponse = await verifyAuthenticationResponse({
            response: body,
            expectedChallenge: (challenge) => !!authChallenges[challenge],
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: credential.id,
                publicKey: new Uint8Array(credential.public_key),
                counter: credential.counter,
                transports: JSON.parse(credential.transports) as AuthenticatorTransport[],
            },
        });

        if (verification.verified) {
            const stmtUpd = db.prepare('UPDATE credentials SET counter = ? WHERE id = ?');
            stmtUpd.run(verification.authenticationInfo.newCounter, credential.id);

            const token = jwt.sign({ id: credential.user_id, username: credential.username, role: credential.role }, jwtSecret, { expiresIn: '7d' });
            res.cookie('jwt', token, {
                httpOnly: true,
                secure: process.env['NODE_ENV'] === 'production',
                sameSite: 'strict'
            });
            res.json({ verified: true });
        } else {
            res.status(400).json({ error: 'Verification failed' });
        }
    } catch (error: any) {
        console.error('[Verify_Auth Error]', error);
        res.status(400).json({ error: error.message });
    }
});

router.post('/logout', (req: Request, res: Response) => {
    res.clearCookie('jwt');
    res.json({ success: true });
});

export default router;
