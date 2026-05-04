import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const dbRoot = path.join(backendRoot, 'Database');
const dbPath = path.join(dbRoot, 'main.sqlite'); // ปรับตามโครงของคุณ

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS water_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,         -- รูปแบบ YYYY-MM-DD (ตามโซนเวลาไทย)
    glasses INTEGER NOT NULL,   -- จำนวนแก้ว เช่น 0..20
    ml INTEGER,                 -- คำนวณกำกับไว้ (เช่น 250ml/แก้ว) จะใส่หรือไม่ก็ได้
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs(user_id, date);
`);

console.log('water_logs table ready.');
