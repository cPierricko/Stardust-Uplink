import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwtSecret } from '../config/auth.js';

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies.jwt;
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, jwtSecret);
        (req as any).user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
