// db.js
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- เส้นทางฐานข้อมูลผู้ใช้ (ของเดิม) ---
const userDbPath = path.resolve(
  __dirname,
  '..',
  process.env.USER_DB || '../DataBase/UserData.sqlite'
);

// --- เส้นทางฐานข้อมูลเมนูโภชนาการ (ใหม่) ---
const nutDbPath = path.resolve(
  __dirname,
  '..',
  process.env.NUT_DB || '../DataBase/NutritionFromScratch.sqlite'
);

// เปิดฐานข้อมูลหลัก (User)
const db = new Database(userDbPath);
db.pragma('journal_mode = WAL');

// สร้างตารางผู้ใช้ (ถ้ายังไม่มี)
db.exec(`
CREATE TABLE IF NOT EXISTS User (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  displayName TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ATTACH โภชนาการเป็น alias "nut" (ถ้ามีไฟล์)
try {
  if (fs.existsSync(nutDbPath)) {
    // ระวัง single quote ใน path
    const escaped = nutDbPath.replaceAll("'", "''");
    db.exec(`ATTACH DATABASE '${escaped}' AS nut;`);
    console.log('[DB] ATTACHED NutritionFromScratch as alias "nut":', nutDbPath);
  } else {
    console.warn('[DB] NutritionFromScratch.sqlite not found at:', nutDbPath);
  }
} catch (err) {
  console.error('[DB] ATTACH failed:', err);
}

export default db;
