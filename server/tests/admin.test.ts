import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/auth.js';

describe('Admin API', () => {
    let adminToken: string;
    const adminUser = { id: 'admin-id', username: 'admin', role: 'administrator' };

    beforeAll(() => {
        // Clear tables
        db.prepare('DELETE FROM credentials').run();
        db.prepare('DELETE FROM deploy_tokens').run();
        db.prepare('DELETE FROM users').run();

        // Create an admin user for authentication
        db.prepare('INSERT INTO users (id, username, role) VALUES (?, ?, ?)')
            .run(adminUser.id, adminUser.username, adminUser.role);

        // Generate a JWT for the admin
        adminToken = jwt.sign(adminUser, jwtSecret);
    });

    it('GET /api/admin/users should return all users', async () => {
        const response = await request(app)
            .get('/api/admin/users')
            .set('Cookie', [`jwt=${adminToken}`]);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBe(1);
        expect(response.body[0].username).toBe('admin');
    });

    it('POST /api/admin/users should create a new setup token', async () => {
        const response = await request(app)
            .post('/api/admin/users')
            .set('Cookie', [`jwt=${adminToken}`])
            .send({ username: 'new_op' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('setupToken');
        expect(response.body).toHaveProperty('id');

        // Verify in DB
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(response.body.id) as any;
        expect(user.username).toBe('new_op');
        expect(user.setupToken).toBe(response.body.setupToken);
    });

    it('GET /api/admin/tokens should return deploy tokens', async () => {
        const response = await request(app)
            .get('/api/admin/tokens')
            .set('Cookie', [`jwt=${adminToken}`]);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
    });

    it('POST /api/admin/tokens should generate a new deploy token', async () => {
        const response = await request(app)
            .post('/api/admin/tokens')
            .set('Cookie', [`jwt=${adminToken}`]);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('token');
        expect(response.body).toHaveProperty('id');

        // Verify in DB
        const token = db.prepare('SELECT * FROM deploy_tokens WHERE id = ?').get(response.body.id);
        expect(token).toBeDefined();
    });
});
