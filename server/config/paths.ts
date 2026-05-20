import path from 'path';
import fs from 'fs';

// Auto-detect SHARDS_DIR: check production path first, fallback to dev
const prodShardsPath = path.resolve(process.cwd(), '../storage/apps');
const devShardsPath = path.resolve(process.cwd(), 'shards_storage');

export const SHARDS_DIR = fs.existsSync(prodShardsPath) ? prodShardsPath : devShardsPath;

const prodTemplatesPath = path.resolve(process.cwd(), '../storage/templates');
const devTemplatesPath = path.resolve(process.cwd(), 'templates_storage');
export const TEMPLATES_DIR = fs.existsSync(prodShardsPath) ? prodTemplatesPath : devTemplatesPath;

// Ensure templates dir exists
if (!fs.existsSync(TEMPLATES_DIR)) {
    try {
        fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
    } catch (err) {
        console.error('[PATHS] Could not create templates directory:', err);
    }
}
