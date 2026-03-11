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

// Diagnostic public (Top-level)
app.get('/diag', (req, res) => {
    try {
        const paths = {
            cwd: process.cwd(),
            __dirname,
            SHARDS_DIR,
            shards_exists: fs.existsSync(SHARDS_DIR),
            shards_ls: fs.existsSync(SHARDS_DIR) ? fs.readdirSync(SHARDS_DIR) : 'NOT_FOUND',
            parent_ls: fs.readdirSync(path.resolve(process.cwd(), '..')),
            env_node_env: process.env.NODE_ENV
        };
        res.json(paths);
    } catch (err: any) {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
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
                    console.log(`[MAGIC_REDIRECT] Found orphaned asset ${req.path} for shard ${slug}. Redirecting...`);
                    return res.redirect(`/shards/${slug}${req.path}`);
                }
            }
        } catch (err) {}
    }
    next();
});

// Shard Static serving (High priority)
app.use('/shards', (req, res, next) => {
    const shardRelPath = req.path.replace(/^\//, '');
    const requestedPath = path.join(SHARDS_DIR, shardRelPath);
    const exists = fs.existsSync(requestedPath);
    
    if (exists && fs.lstatSync(requestedPath).isFile()) {
        console.log(`[SHARDS_STATIC] FILE_MATCH: ${req.url} -> serving file`);
        return express.static(SHARDS_DIR, { dotfiles: 'allow' })(req, res, next);
    } else if (exists && fs.lstatSync(requestedPath).isDirectory()) {
         const hasIndex = fs.existsSync(path.join(requestedPath, 'index.html'));
         console.log(`[SHARDS_STATIC] DIR_MATCH: ${req.url} -> has index: ${hasIndex}`);
         if (hasIndex) {
            return express.static(SHARDS_DIR, { dotfiles: 'allow', index: ['index.html'] })(req, res, next);
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


// Route de diagnostic pour l'admin
app.get('/api/admin/debug-paths', requireAuth, (req, res) => {
    const report = {
        cwd: process.cwd(),
        SHARDS_DIR: SHARDS_DIR,
        APPS_DIR: (deployRoutes as any).APPS_DIR,
        shards_exists: fs.existsSync(SHARDS_DIR),
        shards_contents: fs.existsSync(SHARDS_DIR) ? fs.readdirSync(SHARDS_DIR) : 'MISSING',
        test_shard_contents: fs.existsSync(path.join(SHARDS_DIR, 'test')) ? fs.readdirSync(path.join(SHARDS_DIR, 'test')) : 'MISSING',
        env: process.env.NODE_ENV
    };
    res.json(report);
});

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

