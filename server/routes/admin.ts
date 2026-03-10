import express, { Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Users Management
router.get('/users', requireAuth, (req: Request, res: Response) => {
    try {
        const stmt = db.prepare('SELECT id, username, role, setupToken FROM users');
        const users = stmt.all();
        res.json(users);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/users', requireAuth, (req: Request, res: Response) => {
    const { username } = req.body;

    const setupToken = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes

    try {
        const stmt = db.prepare('INSERT INTO users (id, username, setupToken, setupTokenExpiresAt, role) VALUES (?, ?, ?, ?, ?)');
        const userId = crypto.randomUUID();
        stmt.run(userId, username || null, setupToken, expiresAt, 'operator');
        res.json({ setupToken, expiresAt, id: userId });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/users/:id', requireAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    const { username } = req.body;

    try {
        const stmt = db.prepare('UPDATE users SET username = ? WHERE id = ?');
        stmt.run(username, id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/users/:id', requireAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // Delete related credentials first
        db.prepare('DELETE FROM credentials WHERE user_id = ?').run(id);
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Deploy Tokens Management
router.get('/tokens', requireAuth, (req: Request, res: Response) => {
    try {
        const stmt = db.prepare('SELECT id, token, created_at FROM deploy_tokens');
        const tokens = stmt.all();
        res.json(tokens);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/tokens', requireAuth, (req: Request, res: Response) => {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');

    try {
        const stmt = db.prepare('INSERT INTO deploy_tokens (id, token) VALUES (?, ?)');
        stmt.run(id, token);
        res.json({ id, token });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/tokens/:id', requireAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM deploy_tokens WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
