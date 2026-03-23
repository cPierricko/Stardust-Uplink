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
import jwt from 'jsonwebtoken';
import { jwtSecret } from './config/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env['PORT'] || 3000;

// Trust proxy for production (WebAuthn/HTTPS detection)
app.set('trust proxy', 1);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// Global request logger & SUBDOMAINS INTERCEPTOR
app.use((req, res, next) => {
    const host = req.hostname || '';
    
    // Check if it's a subdomain request (e.g. slug.localhost or slug.rogue-one.cloud)
    let shardSlug = null;
    
    if (host.endsWith('.localhost') && host !== 'localhost') {
        const parts = host.split('.');
        if (parts.length >= 2) shardSlug = parts[0];
    } else if (host.endsWith('.rogue-one.cloud') && host !== 'rogue-one.cloud' && host !== 'www.rogue-one.cloud') {
        const parts = host.split('.');
        if (parts.length >= 3) shardSlug = parts[0];
    }

    if (shardSlug) {
        // Rewrite the internal URL so that downstream routers treat it as /shards/slug/...
        if (!req.url.startsWith(`/shards/${shardSlug}`)) {
            req.url = `/shards/${shardSlug}${req.url}`;
        }
    } else {
        console.log(`[REQUEST] ${req.method} ${req.url}`);
    }
    next();
});

// Helper to redirect to login or send 401
const requireShardAuth = (req: Request, res: Response, next: NextFunction) => {
    // The 'stardust' shard is the management interface and handles its own auth/setup
    if (req.params['slug'] === 'stardust') return next();

    const token = req.cookies?.jwt;
    if (!token) {
        if (req.url.startsWith('/api')) return res.status(401).json({ error: 'Auth required' });
        
        // Calculate the central login URL dynamically
        const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
        const host = req.get('host') || '';
        const parts = host.split('.');
        
        let loginUrl = '';
        if (host.includes('localhost')) {
            loginUrl = 'http://localhost:3000/login';
        } else {
            // Redirect to root domain (e.g. rogue-one.cloud)
            const baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : 'rogue-one.cloud';
            loginUrl = `https://${baseDomain}/login`;
        }
        
        return res.redirect(`${loginUrl}?redirect=${encodeURIComponent(protocol + '://' + host + req.originalUrl)}`);
    }

    try {
        jwt.verify(token, jwtSecret);
        next();
    } catch (err) {
        if (req.url.startsWith('/api')) return res.status(401).json({ error: 'Invalid token' });
        
        const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
        const host = req.get('host') || '';
        const parts = host.split('.');
        let loginUrl = host.includes('localhost') ? 'http://localhost:3000/login' : `https://${parts.slice(-2).join('.')}/login`;
        
        return res.redirect(loginUrl);
    }
};

// === SHARD API PROXY ===
// Redirects /shards/:slug/api/* to the shard's own backend
// IMPORTANT: This proxy MUST run BEFORE express.json() parses the body, otherwise the stream is silently consumed!
app.use('/shards/:slug', requireShardAuth, async (req: Request, res: Response, next: NextFunction) => {
    // Only intercept API requests
    if (!req.url.startsWith('/api')) {
        return next();
    }

    const slug = req.params['slug'] as string;
    const port = runner.getRunningPort(slug);

    if (port) {
        console.log(`[PROXY] Forwarding to shard ${slug} on port ${port}`);
        return createProxyMiddleware({
            target: `http://localhost:${port}`,
            changeOrigin: true,
            pathRewrite: (path, req) => path.replace(new RegExp(`^/shards/${slug}`), '')
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
                    pathRewrite: (path, req) => path.replace(new RegExp(`^/shards/${slug}`), '')
                })(req, res, next);
            }
        } catch (err) {
            console.error(`[PROXY] Failed to start shard ${slug} on demand:`, err);
        }
    }

    res.status(503).json({ error: 'Shard backend not running or not found' });
});

// Parsers for Stardust's own API
app.use(express.json());

app.use('/shards/:slug', requireShardAuth, async (req: Request, res: Response, next: NextFunction) => {
    const slug = req.params['slug'] as string;
    const reqPath = decodeURIComponent(req.path).replace(/^\//, '');
    const fullPath = path.join(SHARDS_DIR, slug, reqPath);
    
    // Security check: ensure path is still within SHARDS_DIR/slug
    const shardBasePath = path.join(SHARDS_DIR, slug);
    if (fullPath.indexOf(shardBasePath) !== 0) {
        return res.status(403).send('Forbidden');
    }

    try {
        const stat = await fs.promises.stat(fullPath).catch(() => null);
        
        if (stat) {
            if (stat.isFile()) {
                // Return immediately
                return res.sendFile(fullPath);
            }
            if (stat.isDirectory()) {
                const indexPath = path.join(fullPath, 'index.html');
                const indexStat = await fs.promises.stat(indexPath).catch(() => null);
                if (indexStat && indexStat.isFile()) {
                    return res.sendFile(indexPath);
                }
            }
        } else {
            // SPA FALLBACK FOR SHARDS
            // If the file is not found, but it's not an asset request, 
            // serve the shard's index.html (React Router, Vue Router...)
            const isAsset = /\.(js|css|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot|ico|webmanifest)$/.test(req.path) || req.path.startsWith('/assets/');
            
            if (!isAsset) {
                // Use the slug from the mount point
                const shardIndexPath = path.join(SHARDS_DIR, slug, 'index.html');
                const indexStat = await fs.promises.stat(shardIndexPath).catch(() => null);
                
                if (indexStat && indexStat.isFile()) {
                    return res.sendFile(shardIndexPath);
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
