import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/auth.js';

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
