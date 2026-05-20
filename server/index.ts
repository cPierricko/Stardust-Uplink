import './logger.js'; // Must be first — captures all console output
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

import db from './db.js';
import { DockerManager } from './services/DockerManager.js';

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

// Global SUBDOMAINS INTERCEPTOR
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
    }
    next();
});

// ── Rate limiter for public shard routes ──────────────────────────────────────
// Sliding window (per route id, per IP), stored in memory
interface RateLimitEntry {
    timestamps: number[];
}
const rateLimitStore: Map<string, RateLimitEntry> = new Map();

function checkRateLimit(routeId: string, ip: string, rpm: number): boolean {
    const key = `${routeId}:${ip}`;
    const now = Date.now();
    const windowMs = 60_000; // 1 minute
    
    let entry = rateLimitStore.get(key);
    if (!entry) {
        entry = { timestamps: [] };
        rateLimitStore.set(key, entry);
    }
    
    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter(ts => now - ts < windowMs);
    
    if (entry.timestamps.length >= rpm) {
        return false; // Rate limit exceeded
    }
    
    entry.timestamps.push(now);
    return true;
}

// Clean up rate limit store every 5 minutes to prevent memory leak
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
        entry.timestamps = entry.timestamps.filter(ts => now - ts < 60_000);
        if (entry.timestamps.length === 0) rateLimitStore.delete(key);
    }
}, 5 * 60_000);

// ── Pattern matching for public routes ────────────────────────────────────────
function matchPublicRoute(pattern: string, urlPath: string): boolean {
    // Normalize: strip query string from urlPath
    const cleanUrl = urlPath.split('?')[0];
    
    if (pattern.endsWith('/*')) {
        // Wildcard: /webhook/* matches /webhook/anything
        const base = pattern.slice(0, -2);
        return cleanUrl === base || cleanUrl.startsWith(base + '/');
    }
    if (pattern.endsWith('*')) {
        return cleanUrl.startsWith(pattern.slice(0, -1));
    }
    return cleanUrl === pattern;
}

// ── Helper to redirect to login or send 401 ───────────────────────────────────
const requireShardAuth = (req: Request, res: Response, next: NextFunction) => {
    // The 'stardust' shard is the management interface and handles its own auth/setup
    if (req.params['slug'] === 'stardust') return next();

    const slug = req.params['slug'];
    const urlPath = req.url.replace(new RegExp(`^/shards/${slug}`), '') || '/';

    // ── Check public routes BEFORE auth ────────────────────────────────────
    try {
        const publicRoutes = db.prepare(
            'SELECT id, path_pattern, method, rate_limit_rpm FROM shard_public_routes WHERE shard_slug = ?'
        ).all(slug) as any[];

        for (const route of publicRoutes) {
            const methodMatch = route.method === '*' || route.method.toUpperCase() === req.method.toUpperCase();
            const pathMatch = matchPublicRoute(route.path_pattern, urlPath);
            
            if (methodMatch && pathMatch) {
                // Rate limiting
                const clientIp = (req.ip || req.socket.remoteAddress || 'unknown').replace('::ffff:', '');
                const rpm = route.rate_limit_rpm || 60;
                
                if (!checkRateLimit(route.id, clientIp, rpm)) {
                    return res.status(429).json({
                        error: 'Rate limit exceeded',
                        message: `Max ${rpm} requests per minute on this public route`,
                        retry_after: 60
                    });
                }
                
                // Pattern matches — bypass auth entirely
                console.log(`[PUBLIC_ROUTE] ${req.method} ${slug}${urlPath} → matched pattern "${route.path_pattern}" (bypassing auth)`);
                return next();
            }
        }
    } catch (dbErr) {
        console.error('[PUBLIC_ROUTE] DB error checking public routes:', dbErr);
        // Continue to auth check on DB error — fail secure
    }

    // ── Standard JWT auth ───────────────────────────────────────────────────
    const token = req.cookies?.jwt;
    if (!token) {
        if (req.url.startsWith('/api')) return res.status(401).json({ error: 'Auth required' });
        
        const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
        const host = req.get('host') || '';
        const parts = host.split('.');
        
        let loginUrl = '';
        if (host.includes('localhost')) {
            loginUrl = 'http://localhost:3000/login';
        } else {
            const baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : 'rogue-one.cloud';
            loginUrl = `https://${baseDomain}/login`;
        }
        
        return res.redirect(`${loginUrl}?redirect=${encodeURIComponent(protocol + '://' + host + req.originalUrl)}`);
    }

    try {
        const decoded = jwt.verify(token, jwtSecret) as any;
        
        // ── Check Operator Shard Access ───────────────────────────────────────
        if (decoded && decoded.role === 'operator') {
            const hasAccess = db.prepare('SELECT 1 FROM user_shard_access WHERE user_id = ? AND shard_slug = ?').get(decoded.id, slug);
            if (!hasAccess) {
                console.warn(`[AUTH] FORBIDDEN: Operator ${decoded.username} attempted to access shard ${slug} via proxy`);
                
                // Return 403 for API or HTML for browser
                if (req.url.startsWith('/api')) {
                    return res.status(403).json({ error: 'Access denied to this shard' });
                }
                
                const host = req.get('host') || '';
                const parts = host.split('.');
                const baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : 'rogue-one.cloud';
                const dashboardUrl = host.includes('localhost') ? 'http://localhost:3000' : `https://${baseDomain}`;
                
                return res.status(403).send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>403 Forbidden</title>
                        <style>
                            body { background: #0a0f18; color: #ef4444; font-family: monospace; padding: 3rem; text-align: center; }
                            h1 { font-size: 2rem; margin-bottom: 1rem; border-bottom: 1px solid #7f1d1d; padding-bottom: 1rem; display: inline-block; }
                            p { color: #9ca3af; margin-bottom: 2rem; }
                            a { display: inline-block; padding: 0.5rem 1rem; border: 1px solid #14b8a6; color: #14b8a6; text-decoration: none; transition: all 0.2s; }
                            a:hover { background: #14b8a6; color: #000; }
                        </style>
                    </head>
                    <body>
                        <h1>403_ACCESS_DENIED</h1>
                        <p>Vous n'avez pas l'autorisation d'accéder au shard <strong>${slug}</strong>.</p>
                        <a href="${dashboardUrl}">RETURN_TO_DASHBOARD</a>
                    </body>
                    </html>
                `);
            }
        }

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
// Redirects /shards/:slug/* to the shard's own backend
// IMPORTANT: This proxy MUST run BEFORE express.json() parses the body, otherwise the stream is silently consumed!
app.use('/shards/:slug', requireShardAuth, async (req: Request, res: Response, next: NextFunction) => {
    // If it's a test environment fallback, only intercept API requests
    if (process.env['NODE_ENV'] === 'test' && !req.url.startsWith('/api')) {
        return next();
    }

    const slug = req.params['slug'] as string;
    

    const shard = db.prepare('SELECT internal_ip, assigned_port, status FROM apps WHERE slug = ?').get(slug) as any;
    
    if (shard && shard.status === 'DEPLOYED' && shard.internal_ip) {
        const targetIP = shard.internal_ip;
        const targetPort = shard.assigned_port || 80;
        
        return createProxyMiddleware({
            target: `http://${targetIP}:${targetPort}`,
            changeOrigin: true,
            pathRewrite: (path, req) => path.replace(new RegExp(`^/shards/${slug}`), ''),
            headers: {
                'X-Forwarded-Prefix': `/shards/${slug}`,
                'Base-URL': `/shards/${slug}`
            },
            on: {
                error: (err: any, req: any, res: any) => {
                    if (res && res.writeHead) {
                        res.writeHead(503, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Shard backend not responding or still booting', details: err.message }));
                    }
                }
            }
        })(req, res, next);
    } else if (shard && shard.status === 'BUILDING') {
         return res.status(503).json({ error: 'Shard is currently building, please wait...' });
    }

    return res.status(503).json({ error: 'Shard backend not deployed, offline, or not found' });
});


// Parsers for Stardust's own API
app.use(express.json());

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
    DockerManager.init().catch(err => {
        console.error('[RO_OS] Docker init failed:', err.message);
    });

    app.listen(PORT, () => {
        console.log(`[RO_OS] Server active on port ${PORT}`);
        console.log(`[RO_OS] Shards: ${SHARDS_DIR}`);
        console.log(`[RO_OS] Apps: ${(deployRoutes as any).APPS_DIR}`);
    });
}

export default app;
