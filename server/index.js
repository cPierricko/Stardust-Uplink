require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

// Import modular routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const deployRoutes = require('./routes/deploy');

// Import middleware
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// === ROUTES ===

// Public & Session Auth Routes
app.use('/api/auth', authRoutes);

// Protected Admin & System Routes
app.use('/api/admin', adminRoutes);

// Deployment Routes (Internal protection via Deploy Token)
app.use('/api/deploy', deployRoutes);

// Secure Static Apps Serving
// Protection: Only authenticated users can access the /apps directory
app.use('/apps', requireAuth, (req, res, next) => {
    // Simple check to prevent basic directory traversal
    const requestedPath = path.normalize(req.path);
    if (requestedPath.includes('..')) {
        return res.status(403).send('Forbidden');
    }
    next();
}, express.static(deployRoutes.APPS_DIR));

// Start Server
app.listen(PORT, () => {
    console.log(`[RO_OS] Server active on port ${PORT}`);
    console.log(`[RO_OS] Apps storage: ${deployRoutes.APPS_DIR}`);
});

