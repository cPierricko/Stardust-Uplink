import crypto from 'crypto';

export const jwtSecret = process.env['JWT_SECRET'] || crypto.randomBytes(32).toString('hex');
