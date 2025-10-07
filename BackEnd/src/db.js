import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// สร้าง path ไปยังไฟล์ ../DataBase/UserData.sqlite
const dbPath = path.resolve(__dirname, '..', process.env.USER_DB || '../DataBase/UserData.sqlite');

// เปิดฐานข้อมูล (WAL ลดปัญหา lock เวลา DB Browser เปิดทิ้งไว้)
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// สร้างตารางถ้ายังไม่มี
db.exec(`
CREATE TABLE IF NOT EXISTS User (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  displayName TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

export default db;
