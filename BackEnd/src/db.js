// db.js
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Paths ----------
const userDbPath = path.resolve(
  __dirname,
  '..',
  process.env.USER_DB || 'database/UserData.sqlite'
);

const nutDbPath = path.resolve(
  __dirname,
  '..',
  process.env.NUT_DB || 'database/NutritionFromScratch.sqlite'
);

// ensure dir exists
fs.mkdirSync(path.dirname(userDbPath), { recursive: true });

// ---------- Open DB ----------
const db = new Database(userDbPath);
db.pragma('journal_mode = WAL');

// ---------- Bootstrap: create table if not exists ----------
db.exec(`
CREATE TABLE IF NOT EXISTS User (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,          -- bcrypt hash
  displayName TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------- Safe migration helpers ----------
function columnExists(table, name) {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const cols = stmt.all();
  return cols.some(c => c.name === name);
}

function addColumnIfMissing(table, name, ddl) {
  if (!columnExists(table, name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
    // console.log(`[DB] Added column ${table}.${name}`);
  }
}

// Add the columns referenced by your routes/auth code
try {
  addColumnIfMissing('User', 'sex',            'sex TEXT');
  addColumnIfMissing('User', 'age',            'age INTEGER');
  addColumnIfMissing('User', 'height',         'height REAL');
  addColumnIfMissing('User', 'weight',         'weight REAL');
  addColumnIfMissing('User', 'exercise',       'exercise TEXT');
  addColumnIfMissing('User', 'goal',           'goal TEXT');

  // Email-first policy
  addColumnIfMissing('User', 'isEmailVerified','isEmailVerified INTEGER DEFAULT 0');

  // TOTP 2FA
  addColumnIfMissing('User', 'totp_secret',    'totp_secret TEXT');
  addColumnIfMissing('User', 'twofa_enabled',  'twofa_enabled INTEGER DEFAULT 0');
} catch (e) {
  console.error('[DB] Migration error:', e);
}

// Optional indices
db.exec(`
CREATE INDEX IF NOT EXISTS idx_user_email ON User(email);
`);

// ---------- ATTACH nutrition db if present ----------
try {
  if (fs.existsSync(nutDbPath)) {
    const escaped = nutDbPath.replaceAll("'", "''");
    db.exec(`ATTACH DATABASE '${escaped}' AS nut;`);
    console.log('[DB] ATTACHED NutritionFromScratch as "nut":', nutDbPath);
  } else {
    console.warn('[DB] NutritionFromScratch.sqlite not found at:', nutDbPath);
  }
} catch (err) {
  console.error('[DB] ATTACH failed:', err);
}

export default db;
