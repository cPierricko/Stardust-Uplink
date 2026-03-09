const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Ensure db directory exists
const dbPath = path.resolve(__dirname, 'db.sqlite');

const db = new Database(dbPath, { verbose: console.log });

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    currentChallenge TEXT,
    setupToken TEXT
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
    name TEXT UNIQUE,
    path TEXT
  );

  CREATE TABLE IF NOT EXISTS deploy_tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add columns if they don't exist
try {
  db.exec('ALTER TABLE users ADD COLUMN setupToken TEXT');
} catch (e) {
  // Ignore if column already exists
}

// First-Boot Logic
function runFirstBootCheck() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
  const userCountRow = stmt.get();

  if (userCountRow.count === 0) {
    const setupToken = crypto.randomBytes(32).toString('hex');
    console.log('\n======================================================');
    console.log('⚠️  SECURITY WARNING: FIRST-BOOT SETUP TOKEN GENERATED  ⚠️');
    console.log('Use this token to create your first admin user.');
    console.log(`Token: ${setupToken}`);
    console.log('======================================================\n');

    // In a real scenario, we might want to store this token somewhere temporarily 
    // or validate it against a single 'setup' endpoint until first registration.
    // For now, let's keep it in memory for the app to validate via an env var or just log it. 
    process.env.INITIAL_SETUP_TOKEN = setupToken;
  }
}

runFirstBootCheck();

module.exports = db;
