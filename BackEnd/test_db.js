import Database from "better-sqlite3";
import path from "path";

// ใช้ path จริงไปยังไฟล์ .sqlite
const dbPath = path.resolve("Database/NutritionFromScratch.sqlite");
console.log("📂 Opening:", dbPath);

const db = new Database(dbPath, { readonly: true });

// ดึงชื่อทุกตาราง
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
console.log("✅ Tables in DB:");
for (const t of tables) console.log("-", t.name);

db.close();
