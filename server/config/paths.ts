import path from 'path';
import fs from 'fs';

// Auto-detect SHARDS_DIR: check production path first, fallback to dev
const prodShardsPath = path.resolve(process.cwd(), '../storage/apps');
const devShardsPath = path.resolve(process.cwd(), 'shards_storage');

export const SHARDS_DIR = fs.existsSync(prodShardsPath) ? prodShardsPath : devShardsPath;
