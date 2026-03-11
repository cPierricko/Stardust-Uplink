import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure db directory exists
// Database path relative to project root
const dbPath = path.resolve(process.cwd(), 'db.sqlite');

const db = new Database(dbPath, { verbose: console.log });

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    currentChallenge TEXT,
    setupToken TEXT,
    setupTokenExpiresAt INTEGER,
    role TEXT DEFAULT 'operator'
  );

  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    public_key BLOB,
    counter INTEGER,
    transports TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,
    name TEXT,
    slug TEXT UNIQUE,
    deploy_method TEXT CHECK(deploy_method IN ('manual', 'auto')),
    api_token TEXT,
    env_vars TEXT,
    path TEXT
  );

  CREATE TABLE IF NOT EXISTS deploy_tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Automated Migrations: Ensure apps table has all required columns
const tableInfo = db.prepare("PRAGMA table_info(apps)").all() as any[];
const columnNames = tableInfo.map(info => info.name);

if (!columnNames.includes('api_token')) {
    console.log('[DB_MIGRATION] Adding column api_token to apps table');
    db.exec('ALTER TABLE apps ADD COLUMN api_token TEXT');
}

if (!columnNames.includes('env_vars')) {
    console.log('[DB_MIGRATION] Adding column env_vars to apps table');
    db.exec("ALTER TABLE apps ADD COLUMN env_vars TEXT DEFAULT '{}'");
}

if (!columnNames.includes('path')) {
    console.log('[DB_MIGRATION] Adding column path to apps table');
    db.exec('ALTER TABLE apps ADD COLUMN path TEXT');
}

// First-Boot Logic
function runFirstBootCheck() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
  const userCountRow = stmt.get() as { count: number };

  if (userCountRow.count === 0) {
    const setupToken = crypto.randomBytes(32).toString('hex');
    console.log('\n======================================================');
    console.log('⚠️  SECURITY WARNING: FIRST-BOOT SETUP TOKEN GENERATED  ⚠️');
    console.log('Use this token to create your first admin user.');
    console.log(`Token: ${setupToken}`);
    console.log('======================================================\n');

    process.env['INITIAL_SETUP_TOKEN'] = setupToken;
  }
}

runFirstBootCheck();

export default db;
