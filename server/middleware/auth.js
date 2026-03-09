const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/auth');

const requireAuth = (req, res, next) => {
    const token = req.cookies.jwt;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, jwtSecret);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'administrator') {
        return res.status(403).json({ error: 'Administrative access required' });
    }
    next();
};

module.exports = {
    requireAuth,
    requireAdmin
};
