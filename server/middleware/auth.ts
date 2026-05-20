import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/auth.js';
import db from '../db.js';

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies.jwt;
    if (!token) {
        console.warn(`[AUTH] MISSING_TOKEN for ${req.method} ${req.url}`);
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, jwtSecret);
        (req as any).user = decoded;
        console.log(`[AUTH] SUCCESS: ${(decoded as any).username} for ${req.method} ${req.url}`);
        next();
    } catch (err: any) {
        console.warn(`[AUTH] INVALID_TOKEN for ${req.url}: ${err.message}`);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || user.role !== 'administrator') {
        console.warn(`[AUTH] FORBIDDEN: User ${user?.username} attempted to access admin route ${req.method} ${req.url}`);
        return res.status(403).json({ error: 'Administrator access required' });
    }
    next();
};

export const requireShardOwnership = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    
    // Administrators have access to everything
    if (user.role === 'administrator') return next();

    // Operators need explicit access via user_shard_access
    const shardId = req.params['id'];
    if (!shardId) return res.status(400).json({ error: 'Shard ID missing in parameters' });

    try {
        const hasAccess = db.prepare(`
            SELECT 1 FROM user_shard_access usa
            JOIN apps a ON a.slug = usa.shard_slug
            WHERE usa.user_id = ? AND a.id = ?
        `).get(user.id, shardId);

        if (!hasAccess) {
            console.warn(`[AUTH] FORBIDDEN: Operator ${user.username} denied access to shard ID ${shardId}`);
            return res.status(403).json({ error: 'Access denied to this shard' });
        }
        next();
    } catch (err: any) {
        console.error('[AUTH] DB error in requireShardOwnership:', err);
        return res.status(500).json({ error: 'Database error while checking access' });
    }
};
