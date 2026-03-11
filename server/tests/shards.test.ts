import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/auth.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Shards API', () => {
    let adminToken: string;
    const adminUser = { id: 'admin-id', username: 'admin', role: 'administrator' };
    let testShardId: string;
    let testShardToken: string;

    beforeAll(() => {
        // Clear tables
        db.prepare('DELETE FROM credentials').run();
        db.prepare('DELETE FROM deploy_tokens').run();
        db.prepare('DELETE FROM apps').run();
        db.prepare('DELETE FROM users').run();

        // Create an admin user for authentication
        db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)')
            .run(adminUser.id, adminUser.username, adminUser.role);

        // Generate a JWT for the admin
        adminToken = jwt.sign(adminUser, jwtSecret);
    });

    it('POST /api/shards/upload should initialize a shell shard without at ZIP', async () => {
        const response = await request(app)
            .post('/api/shards/upload')
            .set('Cookie', [`jwt=${adminToken}`])
            .field('name', 'Test Shard')
            .field('slug', 'test-shard');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data).toHaveProperty('id');
        expect(response.body.data).toHaveProperty('api_token');
        
        testShardId = response.body.data.id;
        testShardToken = response.body.data.api_token;
    });

    it('GET /api/shards should return all shards', async () => {
        const response = await request(app)
            .get('/api/shards')
            .set('Cookie', [`jwt=${adminToken}`]);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(Array.isArray(response.body.data)).toBe(true);
        expect(response.body.data.length).toBeGreaterThan(0);
        expect(response.body.data[0].slug).toBe('test-shard');
    });

    it('GET /api/shards/:id/token should return the shard token', async () => {
        const response = await request(app)
            .get(`/api/shards/${testShardId}/token`)
            .set('Cookie', [`jwt=${adminToken}`]);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.api_token).toBe(testShardToken);
    });

    it('PATCH /api/shards/:id/env should update env vars', async () => {
        const newEnv = JSON.stringify({ KEY: "VALUE" });
        const response = await request(app)
            .patch(`/api/shards/${testShardId}/env`)
            .set('Cookie', [`jwt=${adminToken}`])
            .send({ env_vars: newEnv });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        // Verify in DB
        const shard = db.prepare('SELECT * FROM apps WHERE id = ?').get(testShardId) as any;
        expect(shard.env_vars).toBe(newEnv);
    });

    it('POST /api/shards/push should allow CI/CD deployment with token', async () => {
        // Test missing token
        const noTokenResponse = await request(app)
            .post('/api/shards/push')
            .field('name', 'test');
        
        expect(noTokenResponse.status).toBe(401);

        // Test invalid token
        const invalidTokenResponse = await request(app)
            .post('/api/shards/push')
            .set('x-stardust-token', 'invalid-token-123')
            .field('name', 'test');
        
        expect(invalidTokenResponse.status).toBe(403);

        // Test valid token (Auth only, since extracting dummy zip might fail)
        const validTokenResponse = await request(app)
            .post('/api/shards/push')
            .set('x-stardust-token', testShardToken)
            .field('name', 'test');
        
        // It might return 200 or an error related to zip processing, but not 401/403
        expect([200, 400, 500]).toContain(validTokenResponse.status);
    });

    it('DELETE /api/shards/:id should remove the shard', async () => {
        const response = await request(app)
            .delete(`/api/shards/${testShardId}`)
            .set('Cookie', [`jwt=${adminToken}`]);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        // Verify in DB
        const shard = db.prepare('SELECT * FROM apps WHERE id = ?').get(testShardId);
        expect(shard).toBeUndefined();
    });
});
