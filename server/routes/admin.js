const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// All admin routes require auth and admin role
router.use(requireAuth);
router.use(requireAdmin);

// User Management
router.get('/users', (req, res) => {
    const stmt = db.prepare('SELECT id, username, setupToken, role FROM users');
    res.json(stmt.all());
});

router.post('/users', (req, res) => {
    const { username } = req.body;
    const userId = crypto.randomUUID();
    const setupToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes TTL

    const stmt = db.prepare('INSERT INTO users (id, username, setupToken, setupTokenExpiresAt, role) VALUES (?, ?, ?, ?, ?)');
    stmt.run(userId, username || null, setupToken, expiresAt, 'operator');

    res.json({ id: userId, username: username || null, setupToken, setupTokenExpiresAt: expiresAt });
});

router.delete('/users/:id', (req, res) => {
    db.prepare('DELETE FROM credentials WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

router.patch('/users/:id', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });
    const stmt = db.prepare('UPDATE users SET username = ? WHERE id = ?');
    const info = stmt.run(username, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
});

// Deploy Token Management
router.get('/tokens', (req, res) => {
    const stmt = db.prepare('SELECT id, token, created_at FROM deploy_tokens');
    res.json(stmt.all());
});

router.post('/tokens', (req, res) => {
    const tokenId = crypto.randomUUID();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const stmt = db.prepare('INSERT INTO deploy_tokens (id, token) VALUES (?, ?)');
    stmt.run(tokenId, rawToken);
    res.json({ id: tokenId, token: rawToken });
});

router.delete('/tokens/:id', (req, res) => {
    db.prepare('DELETE FROM deploy_tokens WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

module.exports = router;
