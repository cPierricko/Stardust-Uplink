import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';

describe('Auth API', () => {
    beforeAll(() => {
        // Clear database for clean test state - delete in correct order due to FK
        db.prepare('DELETE FROM credentials').run();
        db.prepare('DELETE FROM users').run();
    });

    it('GET /api/auth/status should return needsSetup=true when no users exist', async () => {
        const response = await request(app).get('/api/auth/status');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('needsSetup', true);
        expect(response.body).toHaveProperty('isAuthenticated', false);
        expect(response.body.user).toBeNull();
    });

    it('GET /api/auth/status should return the correct data structure', async () => {
        const response = await request(app).get('/api/auth/status');

        expect(response.body).toMatchObject({
            needsSetup: expect.any(Boolean),
            isAuthenticated: expect.any(Boolean),
            user: expect.toBeOneOf([expect.any(Object), null])
        });
    });
});
