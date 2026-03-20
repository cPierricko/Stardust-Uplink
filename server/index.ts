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
import { createProxyMiddleware } from 'http-proxy-middleware';
import runner from './runner.js';
import db from './db.js';

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

// Global request logger
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

// === MAGIC ASSET REDIRECTION ===
// Intercepte les assets orphelins (chemins absolus) demandés depuis une iframe de shard
app.use((req: Request, res: Response, next: NextFunction) => {
    const referer = req.headers.referer;
    if (referer && referer.includes('/shards/') && !req.path.startsWith('/api') && !req.path.startsWith('/shards')) {
        try {
            const refUrl = new URL(referer);
            const match = refUrl.pathname.match(/\/shards\/([^/]+)/);
            if (match) {
                const slug = match[1];
                const isAsset = /\.(js|css|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot|ico|webmanifest)$/.test(req.path) || req.path.startsWith('/assets/');
                if (isAsset) {
                    console.log(`[MAGIC_REDIRECT] ${req.path} -> /shards/${slug}${req.path}`);
                    return res.redirect(`/shards/${slug}${req.path}`);
                }
            }
        } catch (err) {}
    }
    next();
});

// === SHARD API PROXY ===
// Redirects /shards/:slug/api/* to the shard's own backend
app.use('/shards/:slug/api', async (req: Request, res: Response, next: NextFunction) => {
    const slug = req.params['slug'] as string;
    const port = runner.getRunningPort(slug);

    if (port) {
        console.log(`[PROXY] Forwarding to shard ${slug} on port ${port}`);
        return createProxyMiddleware({
            target: `http://localhost:${port}`,
            changeOrigin: true,
            pathRewrite: {
                [`^/shards/${slug}/api`]: '', // Strip the prefix when sending to shard
            }
        })(req, res, next);
    }
    
    // If not running, try to start it once if it's supposed to have a backend
    const shard = db.prepare('SELECT has_backend FROM apps WHERE slug = ?').get(slug) as any;
    if (shard && shard.has_backend) {
        try {
            const newPort = await runner.startShard(slug);
            if (newPort) {
                return createProxyMiddleware({
                    target: `http://localhost:${newPort}`,
                    changeOrigin: true,
                    pathRewrite: {
                        [`^/shards/${slug}/api`]: '',
                    },
                })(req, res, next);
            }
        } catch (err) {
            console.error(`[PROXY] Failed to start shard ${slug} on demand:`, err);
        }
    }

    res.status(503).json({ error: 'Shard backend not running or not found' });
});

// Shard Static Serving (Manual — bypasses express.static for reliability)
app.use('/shards', (req: Request, res: Response, next: NextFunction) => {
    const reqPath = decodeURIComponent(req.path).replace(/^\//, '');
    const fullPath = path.join(SHARDS_DIR, reqPath);
    
    // Sécurité: empêcher la traversée de répertoire
    if (fullPath.indexOf(SHARDS_DIR) !== 0) {
        return res.status(403).send('Forbidden');
    }

    try {
        if (fs.existsSync(fullPath)) {
            const stat = fs.lstatSync(fullPath);
            if (stat.isFile()) {
                console.log(`[SHARD_SERVE] File: ${fullPath}`);
                return res.sendFile(fullPath);
            }
            if (stat.isDirectory()) {
                const indexPath = path.join(fullPath, 'index.html');
                if (fs.existsSync(indexPath)) {
                    console.log(`[SHARD_SERVE] Index: ${indexPath}`);
                    return res.sendFile(indexPath);
                }
            }
        }
    } catch (err) {
        console.error(`[SHARD_SERVE] Error: ${err}`);
    }
    
    next();
});

// === API ROUTES ===

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

// Servir les fichiers statiques (le build du client)
app.use(express.static(path.join(process.cwd(), 'client', 'dist')));

// Gestion du Fallback pour React Router
app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api')) {
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
        console.log(`[RO_OS] Shards: ${SHARDS_DIR}`);
        console.log(`[RO_OS] Apps: ${(deployRoutes as any).APPS_DIR}`);
    });
}

export default app;
