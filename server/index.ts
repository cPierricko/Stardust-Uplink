import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Import modular routes
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import deployRoutes from './routes/deploy.js';
import shardsRoutes, { SHARDS_DIR } from './routes/shards.js';

// Import middleware
import { requireAuth } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env['PORT'] || 3000;

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
app.use('/api/deploy', (deployRoutes as any).router);

// Shards Management Routes
app.use('/api/shards', shardsRoutes);

// Secure Static Apps Serving
app.use('/apps', requireAuth, (req: Request, res: Response, next: NextFunction) => {
    const requestedPath = path.normalize(req.path);
    if (requestedPath.includes('..')) {
        return res.status(403).send('Forbidden');
    }
    next();
}, express.static((deployRoutes as any).APPS_DIR));

// Dynamic Shards Serving
app.use('/shards/:slug', (req: Request, res: Response, next: NextFunction) => {
    const { slug } = req.params;
    if (!slug) return res.status(400).send('Slug required');
    
    const requestedPath = path.normalize(req.path);
    if (requestedPath.includes('..')) {
        return res.status(403).send('Forbidden');
    }

    const appDir = path.join(SHARDS_DIR, slug as string);
    if (!fs.existsSync(appDir)) {
        return res.status(404).send('Shard not found');
    }

    express.static(appDir)(req, res, next);
});

// 1. Servir les fichiers statiques (le build du client)
app.use(express.static(path.join(__dirname, 'client', 'dist')));

// 2. Gestion du Fallback pour React Router
app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API Endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'), (err) => {
        if (err) {
            res.status(500).send("Erreur : Interface non trouvée sur le serveur.");
        }
    });
});

// Start Server
if (process.env['NODE_ENV'] !== 'test') {
    app.listen(PORT, () => {
        console.log(`[RO_OS] Server active on port ${PORT}`);
        console.log(`[RO_OS] Apps storage: ${(deployRoutes as any).APPS_DIR}`);
    });
}

export default app;

