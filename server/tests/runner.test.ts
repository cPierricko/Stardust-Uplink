import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/auth.js';
import path from 'path';
import fs from 'fs';
import runner from '../runner.js';

describe('Shard Runner & Proxy', () => {
    let adminToken: string;
    const adminUser = { id: 'admin-id', username: 'admin', role: 'administrator' };
    const testSlug = 'test-backend-shard';
    let testShardId: string;

    beforeAll(() => {
        // Setup admin auth
        db.prepare('INSERT OR IGNORE INTO users (id, username, role) VALUES (?, ?, ?)')
            .run(adminUser.id, adminUser.username, adminUser.role);
        adminToken = jwt.sign(adminUser, jwtSecret);
    });

    afterAll(async () => {
        // Cleanup
        await runner.stopShard(testSlug);
        db.prepare('DELETE FROM apps WHERE slug = ?').run(testSlug);
        const shardPath = path.join(process.cwd(), 'shards_storage', testSlug);
        if (fs.existsSync(shardPath)) {
            fs.rmSync(shardPath, { recursive: true, force: true });
        }
    });

    it('should detect and start a shard with server.js', async () => {
        // 1. Create a dummy shard with a server.js
        const shardPath = path.join(process.cwd(), 'shards_storage', testSlug);
        if (!fs.existsSync(shardPath)) fs.mkdirSync(shardPath, { recursive: true });
        
        const serverCode = `
            import express from 'express';
            const app = express();
            app.get('/api/hello', (req, res) => res.json({ message: 'PROXIED_OK' }));
            app.listen(process.env.PORT, () => console.log('Test shard listening'));
        `;
        fs.writeFileSync(path.join(shardPath, 'server.js'), serverCode);

        // 2. Register shard in DB
        testShardId = 'test-id-runner';
        db.prepare('INSERT OR REPLACE INTO apps (id, name, slug, path, has_backend) VALUES (?, ?, ?, ?, ?)')
            .run(testShardId, 'Test Runner', testSlug, shardPath, 1);

        // 3. Start the shard via runner
        const port = await runner.startShard(testSlug);
        expect(port).toBeGreaterThan(3999);

        // 4. Check status via API
        const statusRes = await request(app)
            .get(`/api/shards/${testShardId}/status`)
            .set('Cookie', [`jwt=${adminToken}`]);
        
        expect(statusRes.body.status).toBe('running');
        expect(statusRes.body.port).toBe(port);
    });

    it('should proxy requests to the shard backend', async () => {
        // Wait a bit for the shard to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));

        const proxyRes = await request(app)
            .get(`/shards/${testSlug}/api/hello`);
        
        expect(proxyRes.status).toBe(200);
        expect(proxyRes.body.message).toBe('PROXIED_OK');
    });

    it('should restart the shard backend', async () => {
        const oldPort = runner.getRunningPort(testSlug);
        
        const restartRes = await request(app)
            .post(`/api/shards/${testShardId}/restart`)
            .set('Cookie', [`jwt=${adminToken}`]);
        
        expect(restartRes.status).toBe(200);
        expect(restartRes.body.success).toBe(true);
        
        const newPort = runner.getRunningPort(testSlug);
        expect(newPort).toBe(oldPort); // Should reuse port if possible/configured
    });

    it('should stop the shard when deleted', async () => {
        await runner.stopShard(testSlug);
        expect(runner.getRunningPort(testSlug)).toBeUndefined();
    });
});
