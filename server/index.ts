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

// Global request logger for debugging
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

// === MAGIC ASSET REDIRECTION ===
// Automatically handles shards that request assets via absolute paths (e.g. /assets/...)
// by detecting the Shard Referer and redirecting the request to the correct shard prefix.
app.use((req: Request, res: Response, next: NextFunction) => {
    const referer = req.headers.referer;
    
    // Only intercept if the request comes from a shard iframe and isn't already targeting /shards or /api
    if (referer && referer.includes('/shards/') && !req.path.startsWith('/api') && !req.path.startsWith('/shards')) {
        try {
            const refUrl = new URL(referer);
            const match = refUrl.pathname.match(/\/shards\/([^/]+)/);
            
            if (match) {
                const slug = match[1];
                // Check if it looks like an asset request (extensions or /assets/ folder)
                const isAsset = /\.(js|css|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot|ico|webmanifest)$/.test(req.path) || req.path.startsWith('/assets/');
                
                if (isAsset) {
                    console.log(`[MAGIC_REDIRECT] Found orphaned asset ${req.path} for shard ${slug}. Redirecting...`);
                    return res.redirect(`/shards/${slug}${req.path}`);
                }
            }
        } catch (err) {
            // Referer wasn't a valid URL, ignore
        }
    }
    next();
});

// === ROUTES ===

// Public & Session Auth Routes
app.use('/api/auth', authRoutes);

// Protected Admin & System Routes
app.use('/api/admin', adminRoutes);

// Deployment Routes (Internal protection via Deploy Token)
app.use('/api/deploy', (deployRoutes as any).router);

// Shards Management Routes
console.log(`[RO_OS_INIT] Shards storage: ${SHARDS_DIR}`);
app.use('/api/shards', (req: Request, res: Response, next: NextFunction) => {
    const isPush = req.path.includes('/push') && req.method === 'POST';
    if (isPush) return next();
    requireAuth(req, res, next);
}, shardsRoutes);

// Secure Static Apps Serving
app.use('/apps', requireAuth, (req: Request, res: Response, next: NextFunction) => {
    const requestedPath = path.normalize(req.path);
    if (requestedPath.includes('..')) {
        return res.status(403).send('Forbidden');
    }
    next();
}, express.static((deployRoutes as any).APPS_DIR));

// Dynamic Shards Serving
app.use('/shards', express.static(SHARDS_DIR));

// 1. Servir les fichiers statiques (le build du client)
app.use(express.static(path.join(process.cwd(), 'client', 'dist')));

// 2. Gestion du Fallback pour React Router
app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api')) {
        console.error(`[RO_OS] 404_API_FALLBACK: ${req.method} ${req.originalUrl} - No route matched.`);
        return res.status(404).json({ 
            error: 'API Endpoint not found',
            method: req.method,
            path: req.originalUrl 
        });
    }
    res.sendFile(path.join(process.cwd(), 'client', 'dist', 'index.html'), (err) => {
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

