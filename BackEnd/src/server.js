// BackEnd/src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import child_process from 'child_process';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

// ❌ อย่า import nutritionRouter อีกต่อไป
// import nutritionRouter from './routes/nutrition.js';

import createRecommendRouter from './routes/recommend.js';
import sttLocalRouter from './routes/stt.local.js';
import createFoodsSearchRouter, { markFoodsIndexDirty } from './routes/foods.search.js';
import {
  normalizeSex,
  activityFromExercise,
  calcBMR,
  calcTDEE,
  adjustForGoal,
  calcMacros,
} from './services/calc.js';
import { todayThailandISO } from './utils/date.js';
import { calcWaterRange } from './services/calc.js';
/* -------------------------------------------------------------------------- */
/*                                Path & const                                */
/* -------------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const dbRoot      = path.join(backendRoot, 'Database');

const JWT_SECRET  = process.env.JWT_SECRET || 'change_me';
const TEMP_2FA_EXPIRES = '5m';
const APP_ISSUER = 'AI-Track-Cal';
const RESET_TEMP_EXPIRES = '10m';
const RESET_OK_EXPIRES   = '10m';

// ตั้งค่า TOTP (ให้คลาดเคลื่อนได้เล็กน้อย)
authenticator.options = { step: 30, window: 1 };

// ปรับ PYTHON_EXEC ให้ชัดเจน (รองรับทั้ง relative/absolute)
(function normalizePythonExec() {
  const raw = process.env.PYTHON_EXEC;
  let resolved = raw && raw.trim().length
    ? (path.isAbsolute(raw) ? raw : path.resolve(backendRoot, raw))
    : (process.platform === 'win32' ? 'python' : 'python3');
  process.env.PYTHON_EXEC = resolved;
  console.log('🐍 Using PYTHON_EXEC =', process.env.PYTHON_EXEC);
})();

/* -------------------------------------------------------------------------- */
/*                                   DB init                                  */
/* -------------------------------------------------------------------------- */
function resolveDbPath(filename) {
  const candidates = [
    path.join(backendRoot, 'Database', filename),
    path.join(backendRoot, 'DataBase', filename), // เผื่อสะกดอีกแบบ
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return candidates[0];
}
function openDb(filename) {
  const full = resolveDbPath(filename);
  const dir  = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // ไม่ต้อง throw ถ้าไม่มีไฟล์ — ให้ better-sqlite3 สร้างได้เอง
  const conn = new Database(full);
  conn.pragma('journal_mode = WAL');
  conn.pragma('busy_timeout = 15000');
  return conn;
}


// Connections (แยกไฟล์ตามชนิดข้อมูล)
const userDb      = openDb('UserData.sqlite');
const nutritionDb = openDb('NutritionDB.sqlite');
const nfsDb       = openDb('NutritionFromScratch.sqlite');
const mealDb      = openDb('MealRecord.sqlite');
const waterDb     = openDb('WaterRecord.sqlite');

console.log('📂 DB paths:');
console.log('  UserData:', path.join(dbRoot, 'UserData.sqlite'));
console.log('  NutritionDB:', path.join(dbRoot, 'NutritionDB.sqlite'));
console.log('  NutritionFromScratch:', path.join(dbRoot, 'NutritionFromScratch.sqlite'));
console.log('  MealRecord:', path.join(dbRoot, 'MealRecord.sqlite'));
console.log('  WaterRecord:', path.join(dbRoot, 'WaterRecord.sqlite'));

/* -------------------------------------------------------------------------- */
/*                                   Schema                                   */
/* -------------------------------------------------------------------------- */
userDb.exec(`
CREATE TABLE IF NOT EXISTS User (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  displayName TEXT,
  weight REAL,
  height REAL,
  age INTEGER,
  exercise TEXT,
  goal TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  sex TEXT
);
`);

// --- helpers: sleep sync + retry wrapper ---
function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}
function withBusyRetry(fn, tries = 10, baseDelay = 200) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return fn();
    } catch (e) {
      // busy ให้ลองใหม่ พร้อม backoff
      if (String(e?.code) === 'SQLITE_BUSY') {
        const wait = baseDelay * (i + 1);
        console.warn(`[User migration] busy, retry in ${wait}ms (attempt ${i + 1}/${tries})`);
        sleepMs(wait);
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

(function ensureUserSchema(db) {
  withBusyRetry(() => {
    // ขอ exclusive lock ชั่วคราวช่วง migration
    db.pragma('locking_mode = EXCLUSIVE');

    // ทำในทรานแซกชันให้ชัดเจน ลดเวลาถือ lock
    db.exec('BEGIN IMMEDIATE');
    try {
      const cols = db.prepare(`PRAGMA table_info('User')`).all().map(c => c.name);
      const need = (n) => !cols.includes(n);

      if (need('totp_secret')) db.exec(`ALTER TABLE User ADD COLUMN totp_secret TEXT;`);
      if (need('twofa_enabled')) db.exec(`ALTER TABLE User ADD COLUMN twofa_enabled INTEGER DEFAULT 0;`);
      if (need('exercise_minutes_per_day')) db.exec(`ALTER TABLE User ADD COLUMN exercise_minutes_per_day INTEGER DEFAULT 0;`);

      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      throw e;
    } finally {
      // กลับเป็น NORMAL หลังทำเสร็จ
      db.pragma('locking_mode = NORMAL');
      // เคลียร์ WAL สั้น ๆ
      try { db.pragma(`wal_checkpoint(TRUNCATE)`); } catch {}
    }
  }, 12, 250);

  console.log('[User migration] ok.');
})(userDb);



// Meals
mealDb.exec(`
CREATE TABLE IF NOT EXISTS MealRecord (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  mealType TEXT NOT NULL,        -- breakfast | lunch | dinner | other
  name TEXT,
  quantity REAL,
  unit TEXT,
  imagePath TEXT,
  kcal REAL,
  protein REAL,
  fat REAL,
  carb REAL,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
// ---- MIGRATION: ensure MealRecord has latest columns ----
(function ensureMealSchema(db) {
  try {
    const cols = db.prepare(`PRAGMA table_info('MealRecord')`).all();
    const have = new Set(cols.map(c => c.name));
    const alters = [];

    if (!have.has('imagePath')) alters.push(`ALTER TABLE MealRecord ADD COLUMN imagePath TEXT;`);
    if (!have.has('unit'))      alters.push(`ALTER TABLE MealRecord ADD COLUMN unit TEXT;`);
    if (!have.has('createdAt')) alters.push(`ALTER TABLE MealRecord ADD COLUMN createdAt TEXT DEFAULT CURRENT_TIMESTAMP;`);

    for (const sql of alters) db.exec(sql);

    console.log('[MealRecord migration] ok. newColumns =', alters.map(s => s.split(' ')[3]));
  } catch (e) {
    console.error('[MealRecord migration] error:', e);
  }
})(mealDb);

// Nutrition (legacy)
nutritionDb.exec(`
CREATE TABLE IF NOT EXISTS Nutrition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  calories REAL,
  protein REAL,
  fat REAL,
  carbs REAL
);
`);

// Water
function ensureWaterPrepared(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS water_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,         -- YYYY-MM-DD (เวลาไทย)
      glasses INTEGER NOT NULL,   -- 0..20
      ml INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs(user_id, date);
  `);
}
ensureWaterPrepared(waterDb);

/* -------------------------------------------------------------------------- */
/*                                JWT helpers                                 */
/* -------------------------------------------------------------------------- */
function signAccess(user) {
  // user: { id, email }
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
function signTemp2FA(userId) {
  return jwt.sign({ sub: userId, stage: '2fa' }, JWT_SECRET, { expiresIn: TEMP_2FA_EXPIRES });
}
function verifyTemp2FA(token, expectUserId) {
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return p && p.stage === '2fa' && Number(p.sub) === Number(expectUserId);
  } catch {
    return false;
  }
}
function authGuard(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    theToken:{
      const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'missing_token' });
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { id: payload.sub, email: payload.email };
      next();
    }
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function signTempReset(userId) {
  return jwt.sign({ sub: userId, stage: 'reset' }, JWT_SECRET, { expiresIn: RESET_TEMP_EXPIRES });
}
function verifyTempReset(token, expectUserId) {
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return p && p.stage === 'reset' && Number(p.sub) === Number(expectUserId);
  } catch {
    return false;
  }
}
function signResetOK(userId) {
  return jwt.sign({ sub: userId, stage: 'reset_ok' }, JWT_SECRET, { expiresIn: RESET_OK_EXPIRES });
}
function verifyResetOK(token) {
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return p && p.stage === 'reset_ok' ? p : null;
  } catch {
    return null;
  }
}
/* -------------------------------------------------------------------------- */
/*                                   Utils                                    */
/* -------------------------------------------------------------------------- */
function getUserById(userId) {
  return userDb.prepare(`
    SELECT id, email, displayName, sex, age, height, weight, exercise, goal, exercise_minutes_per_day
    FROM User WHERE id = ?
  `).get(userId);
}
function normalizeThaiFoodName(s = '') {
  return String(s).trim().toLowerCase().replace(/\s+/g, '')
    .replace(/ผัดกระเพรา|ผัดกะเพราะ|ผัดกระเพราะ/g, 'ผัดกะเพรา');
}

// ✅ ใช้ nfsDb เป็นหลัก แล้วค่อย fallback ไป NutritionDB เก่า (สำหรับ /nutrition เท่านั้น)
function getNutritionByNameLike(name) {
  const raw = String(name || '');
  const norm = normalizeThaiFoodName(raw);
  const like = `%${raw}%`;
  const likeNorm = `%${norm}%`;

  const foodsCandidates = [
    {
      sql: `
        SELECT NameTH AS name, EnergyKcal AS kcal, ProteinG AS protein, FatG AS fat, CarbohydrateG AS carb,
               ServingSizeGram AS serving
        FROM foods WHERE NameTH LIKE ? LIMIT 1
      `,
      args: [like],
      db: nfsDb,
    },
    {
      sql: `
        SELECT NameEng AS name, EnergyKcal AS kcal, ProteinG AS protein, FatG AS fat, CarbohydrateG AS carb,
               ServingSizeGram AS serving
        FROM foods WHERE NameEng LIKE ? LIMIT 1
      `,
      args: [like],
      db: nfsDb,
    },
    {
      sql: `
        SELECT NameTH AS name, EnergyKcal AS kcal, ProteinG AS protein, FatG AS fat, CarbohydrateG AS carb,
               ServingSizeGram AS serving
        FROM foods WHERE REPLACE(LOWER(NameTH), ' ', '') LIKE ? LIMIT 1
      `,
      args: [likeNorm],
      db: nfsDb,
    },
    {
      sql: `
        SELECT NameEng AS name, EnergyKcal AS kcal, ProteinG AS protein, FatG AS fat, CarbohydrateG AS carb,
               ServingSizeGram AS serving
        FROM foods WHERE REPLACE(LOWER(NameEng), ' ', '') LIKE ? LIMIT 1
      `,
      args: [likeNorm],
      db: nfsDb,
    },
  ];

  for (const q of foodsCandidates) {
    try {
      const row = (q.db || nfsDb).prepare(q.sql).get(...q.args);
      if (row) {
        return {
          name: row.name,
          kcal: row.kcal != null ? Number(row.kcal) : null,
          protein: row.protein != null ? Number(row.protein) : null,
          fat: row.fat != null ? Number(row.fat) : null,
          carb: row.carb != null ? Number(row.carb) : null,
          serving: row.serving != null ? Number(row.serving) : null,
        };
      }
    } catch {}
  }

  const likeLower = `%${raw.toLowerCase()}%`;
  const oldCandidates = [
    { sql: `SELECT name AS name, calories AS kcal, protein, fat, carbs AS carb FROM Nutrition WHERE name LIKE ? LIMIT 1`, args:[like] },
    { sql: `SELECT name AS name, calories AS kcal, protein, fat, carbs AS carb FROM Nutrition WHERE LOWER(name) LIKE ? LIMIT 1`, args:[likeLower] },
  ];
  for (const q of oldCandidates) {
    try {
      const row = nutritionDb.prepare(q.sql).get(...q.args);
      if (row) {
        return {
          name: row.name,
          kcal: row.kcal != null ? Number(row.kcal) : null,
          protein: row.protein != null ? Number(row.protein) : null,
          fat: row.fat != null ? Number(row.fat) : null,
          carb: row.carb != null ? Number(row.carb) : null,
          serving: null,
        };
      }
    } catch {}
  }
  return null;
}

// helper: หา ServingSizeGram จาก NFS ตามชื่อเมนู
function findServingFromNfsByName(db, name) {
  if (!name) return null;
  const like = `%${String(name).trim()}%`;
  const queries = [
    { sql: `SELECT ServingSizeGram AS g FROM foods WHERE NameTH LIKE ? LIMIT 1`, args: [like] },
    { sql: `SELECT ServingSizeGram AS g FROM foods WHERE NameEng LIKE ? LIMIT 1`, args: [like] },
  ];
  for (const q of queries) {
    try {
      const r = db.prepare(q.sql).get(...q.args);
      if (r && Number(r.g) > 0) return Number(r.g);
    } catch {}
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*                                 Express app                                */
/* -------------------------------------------------------------------------- */

const corsOptions = {
  origin: '*', // โปรดักชันควรระบุโดเมนจริง
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};



const app = express();
app.use(cors(corsOptions));
app.use(express.json());

// Static uploads
const uploadsDir = path.join(backendRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const extFromName = path.extname(file?.originalname || '');
    const fallbackExt = (file?.mimetype && file.mimetype.includes('png')) ? '.png' : '.jpg';
    const ext = extFromName || fallbackExt;
    cb(null, `meal_${ts}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(jpeg|png|webp|heic|heif)/.test(file?.mimetype || '');
    if (ok) return cb(null, true);
    return cb(new Error('unsupported_image_type'));
  },
});
app.post('/nfs/foods/upsert', authGuard, (req, res) => {
  try {
    const { name, qtyG, kcal, p, f, c } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name_required' });

    const norm = String(name).trim();
    // ใช้ FoodID เป็นคีย์หลัก
    const row = nfsDb
      .prepare(`SELECT FoodID AS id FROM foods WHERE NameTH = ? OR NameEng = ? LIMIT 1`)
      .get(norm, norm);

    let action = 'updated', foodId;

    if (row) {
      nfsDb.prepare(`
        UPDATE foods
        SET ServingSizeGram = @qtyG,
            EnergyKcal = @kcal,
            ProteinG = @p,
            FatG = @f,
            CarbohydrateG = @c,
            UpdatedAt = datetime('now')
        WHERE FoodID = @id
      `).run({ id: row.id, qtyG, kcal, p, f, c });
      foodId = row.id;

      // ✅ ทำให้ดัชนี search dirty หลัง update
      markFoodsIndexDirty();
    } else {
      const info = nfsDb.prepare(`
        INSERT INTO foods (NameTH, ServingSizeGram, EnergyKcal, ProteinG, FatG, CarbohydrateG, UpdatedAt)
        VALUES (@name, @qtyG, @kcal, @p, @f, @c, datetime('now'))
      `).run({ name: norm, qtyG, kcal, p, f, c });
      foodId = info.lastInsertRowid;
      action = 'inserted';

      // ✅ ทำให้ดัชนี search dirty หลัง insert
      markFoodsIndexDirty();
    }

    return res.json({ ok: true, foodId, action });
  } catch (e) {
    console.error('[POST /nfs/foods/upsert] error:', e);
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
});

/* -------------------------------------------------------------------------- */
/*                                  Routers                                   */
/* -------------------------------------------------------------------------- */
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/__debug/userschema', (_req, res) => {
  try {
    const cols = userDb.prepare(`PRAGMA table_info('User')`).all();
    const locking = userDb.pragma('locking_mode', { simple: true });
    const journal = userDb.pragma('journal_mode', { simple: true });
    res.json({ locking, journal, cols });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// STT + food search (จากโปรเจกต์เพื่อน) → ใช้ NFS
app.use('/stt', sttLocalRouter);
app.use('/', createFoodsSearchRouter(nfsDb));

// ⭐ NEW: AI ต้องการ NutritionDB เท่านั้น → endpoint แยกเฉพาะ NutritionDB
// AI → ใช้ NutritionDB โดยตรง (ไม่ normalize)
// ⭐ NEW: AI ต้องใช้ NutritionDB ก่อน (รองรับทั้ง schema แบบ foods และแบบ Nutrition)
app.get('/foods/by-name-legacy', (req, res) => {
  const raw = req.query.q;
  if (!raw) return res.status(400).json({ error: 'q_required' });

  const q = String(raw || '').trim();
  const like = `%${q}%`;
  const likeLower = `%${q.toLowerCase()}%`;
  const noSpaceLower = q.toLowerCase().replace(/\s+/g, '');

  // ตรวจ schema ของ NutritionDB
  const hasFoods = (() => {
    try {
      const cols = nutritionDb.prepare(`PRAGMA table_info('foods')`).all().map(c => c.name.toLowerCase());
      return ['energykcal','proteing','fatg','carbohydrateg'].every(c => cols.includes(c));
    } catch { return false; }
  })();

  const toNum = v => (v == null ? null : Number(v));

  // 1) ถ้ามีตาราง foods (EnergyKcal/ProteinG/...) → ใช้ก่อน
  if (hasFoods) {
    try {
      // exact TH/EN
      let row =
        nutritionDb.prepare(`
          SELECT NameTH AS name_th, NameEng AS name_en,
                 EnergyKcal AS kcal, ProteinG AS protein,
                 FatG AS fat, CarbohydrateG AS carb,
                 ServingSizeGram AS serving
          FROM foods
          WHERE NameTH = ? OR NameEng = ?
          LIMIT 1
        `).get(q, q);

      // LIKE TH/EN
      if (!row) {
        row = nutritionDb.prepare(`
          SELECT NameTH AS name_th, NameEng AS name_en,
                 EnergyKcal AS kcal, ProteinG AS protein,
                 FatG AS fat, CarbohydrateG AS carb,
                 ServingSizeGram AS serving
          FROM foods
          WHERE NameTH LIKE ? OR NameEng LIKE ?
          LIMIT 1
        `).get(like, like);
      }

      // แบบลบช่องว่างและ lower
      if (!row) {
        row = nutritionDb.prepare(`
          SELECT NameTH AS name_th, NameEng AS name_en,
                 EnergyKcal AS kcal, ProteinG AS protein,
                 FatG AS fat, CarbohydrateG AS carb,
                 ServingSizeGram AS serving
          FROM foods
          WHERE REPLACE(LOWER(NameTH),' ','') = ?
             OR REPLACE(LOWER(NameEng),' ','') = ?
          LIMIT 1
        `).get(noSpaceLower, noSpaceLower);
      }

      if (row) {
        return res.json({
          foodId: null,
          name_th: row.name_th || null,
          name_en: row.name_en || null,
          kcal: toNum(row.kcal),
          protein: toNum(row.protein),
          fat: toNum(row.fat),
          carb: toNum(row.carb),
          serving: toNum(row.serving),
        });
      }
    } catch (e) {
      console.error('[foods.by-name-legacy:foods]', e);
    }
  }

  // 2) fallback: ตาราง Nutrition แบบเดิม (name, calories, protein, fat, carbs)
  try {
    let row = nutritionDb.prepare(`
      SELECT name, calories AS kcal, protein, fat, carbs AS carb
      FROM Nutrition
      WHERE name = ?
      LIMIT 1
    `).get(q);

    if (!row) {
      row = nutritionDb.prepare(`
        SELECT name, calories AS kcal, protein, fat, carbs AS carb
        FROM Nutrition
        WHERE name LIKE ?
        LIMIT 1
      `).get(like);
    }

    if (!row) {
      row = nutritionDb.prepare(`
        SELECT name, calories AS kcal, protein, fat, carbs AS carb
        FROM Nutrition
        WHERE LOWER(name) LIKE ?
        LIMIT 1
      `).get(likeLower);
    }

    if (row) {
      return res.json({
        foodId: null,
        name_th: row.name || null,
        name_en: null,
        kcal: toNum(row.kcal),
        protein: toNum(row.protein),
        fat: toNum(row.fat),
        carb: toNum(row.carb),
        serving: null,
      });
    }
  } catch (e) {
    console.error('[foods.by-name-legacy:Nutrition]', e);
  }

  return res.status(404).json({ error: 'not_found' });
});



// Recommend (รองรับทั้ง /recommend และ /api/recommend) → ใช้ NFS
app.use(['/recommend', '/api/recommend'], createRecommendRouter(nfsDb));

/* --------------------------------- AUTH ----------------------------------- */
// REGISTER (ขั้นที่ 1): สมัคร + สุ่ม secret + ส่ง QR + tempToken (ยังไม่ออก JWT)
app.post('/auth/register', async (req, res) => {
const { email, password, displayName, weight, height, age, exercise, goal, sex, exercise_minutes_per_day } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

  try {
    const hash = await bcrypt.hash(password, 12);

    // ทำ INSERT + SET TOTP ในทรานแซกชันเดียว เพื่อลดโอกาส lock
    const runTx = userDb.transaction((payload) => {
  // ตรวจว่าตาราง User มีคอลัมน์ exercise_minutes_per_day หรือไม่
  const userCols = userDb.prepare(`PRAGMA table_info('User')`).all().map(c => c.name);
  const hasMinutes = userCols.includes('exercise_minutes_per_day');

  const colNames = ['email','password','displayName','weight','height','age','exercise','goal','sex'];
  const placeholders = ['?','?','?','?','?','?','?','?','?'];
  const values = [
    String(payload.email).trim().toLowerCase(),
    payload.hash,
    payload.displayName ?? null,
    payload.weight !== undefined && payload.weight !== '' ? parseFloat(payload.weight) : null,
    payload.height !== undefined && payload.height !== '' ? parseFloat(payload.height) : null,
    payload.age !== undefined && payload.age !== '' ? parseInt(payload.age, 10) : null,
    payload.exercise ?? null,
    payload.goal ?? null,
    (payload.sex && String(payload.sex).toLowerCase()) || null,
  ];

  if (hasMinutes) {
    colNames.push('exercise_minutes_per_day');
    placeholders.push('?');
    values.push(Number(payload.exercise_minutes_per_day || 0));
  }

  const stmt = userDb.prepare(`
    INSERT INTO User (${colNames.join(', ')})
    VALUES (${placeholders.join(', ')})
  `);

  const info = stmt.run(...values);

  const user = {
    id: info.lastInsertRowid,
    email: String(payload.email).trim().toLowerCase(),
    displayName: payload.displayName ?? null,
    weight: payload.weight ? parseFloat(payload.weight) : null,
    height: payload.height ? parseFloat(payload.height) : null,
    age: payload.age ? parseInt(payload.age, 10) : null,
    exercise: payload.exercise ?? null,
    goal: payload.goal ?? null,
    sex: (payload.sex && String(payload.sex).toLowerCase()) || null,
    exercise_minutes_per_day: Number(payload.exercise_minutes_per_day || 0),
  };

  const secret = authenticator.generateSecret();
  userDb.prepare(`UPDATE User SET totp_secret = ?, twofa_enabled = 0 WHERE id = ?`)
    .run(secret, user.id);

  return { user, secret };
});


    const { user, secret } = runTx({
  email, password, displayName, weight, height, age, exercise, goal, sex, hash,
  exercise_minutes_per_day, // ⬅️ เพิ่มตรงนี้
});
const minutesPerDay = Number(exercise_minutes_per_day || 0);
const waterSuggestion = calcWaterRange(user.weight, minutesPerDay);

const otpauth = authenticator.keyuri(user.email, APP_ISSUER, secret);
const qrDataUrl = await QRCode.toDataURL(otpauth);
const tempToken = signTemp2FA(user.id);

res.status(201).json({
  ok: true,
  user,
  requires2faSetup: true,
  tempToken,
  qrDataUrl,
  otpauth,
  waterSuggestion, // ⬅️ แนบได้แล้วเพราะคำนวณไว้ข้างบน
});
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'email_already_used' });
    console.error('[REGISTER ERROR]', e);
    res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
});

// REGISTER (ขั้นที่ 2): ยืนยัน OTP -> ออก JWT จริง
app.post('/auth/register/verify-2fa', (req, res) => {
  const { userId, token, tempToken } = req.body || {};
  if (!userId || !token || !tempToken) return res.status(400).json({ error: 'missing_params' });
  if (!verifyTemp2FA(tempToken, userId)) return res.status(401).json({ error: 'invalid_temp_token' });

  const row = userDb.prepare('SELECT * FROM User WHERE id = ?').get(Number(userId));
  if (!row || !row.totp_secret) return res.status(400).json({ error: 'no_secret' });

  const valid = authenticator.check(String(token), row.totp_secret);
  if (!valid) return res.status(400).json({ error: 'invalid_otp' });

  userDb.prepare('UPDATE User SET twofa_enabled = 1 WHERE id = ?').run(Number(userId));

  const accessToken = signAccess({ id: row.id, email: row.email });
  return res.json({
    ok: true,
    accessToken,
    user: {
      id: row.id, email: row.email, displayName: row.displayName,
      weight: row.weight, height: row.height, age: row.age,
      exercise: row.exercise, goal: row.goal, sex: row.sex
    }
  });
});

/* ---------------------- PASSWORD RESET with TOTP (2FA) --------------------- */
app.post('/auth/reset/request', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email_required' });

  const row = userDb.prepare('SELECT id, email, twofa_enabled, totp_secret FROM User WHERE email = ?')
    .get(String(email).trim().toLowerCase());

  // ไม่บอกว่ามี user หรือไม่ เพื่อความปลอดภัย (แต่ตอบ ok: true เสมอ)
  if (!row || Number(row.twofa_enabled) !== 1 || !row.totp_secret) {
    return res.json({ ok: true, requires2fa: false });
  }

  const tempToken = signTempReset(row.id);
  return res.json({ ok: true, requires2fa: true, userId: row.id, tempToken });
});

app.post('/auth/reset/verify-otp', (req, res) => {
  const { userId, token, tempToken } = req.body || {};
  if (!userId || !token || !tempToken) {
    return res.status(400).json({ error: 'missing_params' });
  }
  if (!verifyTempReset(tempToken, userId)) {
    return res.status(401).json({ error: 'invalid_temp_token' });
  }

  const row = userDb.prepare('SELECT id, totp_secret, twofa_enabled FROM User WHERE id = ?')
    .get(Number(userId));
  if (!row || !row.totp_secret || Number(row.twofa_enabled) !== 1) {
    return res.status(400).json({ error: '2fa_not_enabled' });
  }

  const pass = /^\d{6}$/.test(String(token)) && authenticator.check(String(token), row.totp_secret);
  if (!pass) return res.status(400).json({ error: 'invalid_otp' });

  const resetToken = signResetOK(row.id);
  return res.json({ ok: true, resetToken });
});

app.post('/auth/reset/confirm', async (req, res) => {
  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'missing_params' });

  const payload = verifyResetOK(resetToken);
  if (!payload?.sub) return res.status(401).json({ error: 'invalid_reset_token' });

  const userId = Number(payload.sub);
  const hash = await bcrypt.hash(String(newPassword), 12);

  userDb.prepare('UPDATE User SET password = ? WHERE id = ?').run(hash, userId);
  return res.json({ ok: true });
});

// LOGIN: ถ้าเปิด 2FA -> ส่ง tempToken; ถ้ายังไม่เปิด -> ออก JWT เลย
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

  const row = userDb.prepare('SELECT * FROM User WHERE email = ?')
    .get(String(email).trim().toLowerCase());
  if (!row) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, row.password);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  if (Number(row.twofa_enabled) === 1) {
    const tempToken = signTemp2FA(row.id);
    return res.json({ ok: true, requires2fa: true, userId: row.id, tempToken });
  }

  const accessToken = signAccess({ id: row.id, email: row.email });
  res.json({
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      weight: row.weight,
      height: row.height,
      age: row.age,
      exercise: row.exercise,
      goal: row.goal,
      sex: row.sex
    },
    accessToken
  });
});

// LOGIN (ขั้น OTP): ตรวจรหัส -> ออก JWT จริง
app.post('/auth/2fa/check', (req, res) => {
  const { userId, token, tempToken } = req.body || {};
  if (!userId || !token || !tempToken) return res.status(400).json({ error: 'missing_params' });
  if (!verifyTemp2FA(tempToken, userId)) return res.status(401).json({ error: 'invalid_temp_token' });

  const row = userDb.prepare('SELECT * FROM User WHERE id = ?').get(Number(userId));
  if (!row || !row.totp_secret || Number(row.twofa_enabled) !== 1) {
    return res.status(400).json({ error: '2fa_not_enabled' });
  }

  let pass = false;
  if (/^\d{6}$/.test(String(token))) {
    pass = authenticator.check(String(token), row.totp_secret);
  }
  if (!pass) return res.status(400).json({ error: 'invalid_otp' });

  const accessToken = signAccess({ id: row.id, email: row.email });
  return res.json({
    ok: true,
    accessToken,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      weight: row.weight,
      height: row.height,
      age: row.age,
      exercise: row.exercise,
      goal: row.goal,
      sex: row.sex
    }
  });
});

// ME
app.get('/auth/me', authGuard, (req,res)=>{
  const u = getUserById(req.user.id);
  if(!u) return res.status(404).json({error:'user_not_found'});
  res.json(u);
});
app.put('/auth/me', authGuard, (req,res)=>{
   const {displayName,weight,height,age,sex,exercise,goal, exercise_minutes_per_day} = req.body||{};
  const userId = req.user.id;
  const row = getUserById(userId);
  if(!row) return res.status(404).json({error:'user_not_found'});

  const stmt = userDb.prepare(`
    UPDATE User SET
      displayName = COALESCE(?, displayName),
      weight      = COALESCE(?, weight),
      height      = COALESCE(?, height),
      age         = COALESCE(?, age),
      sex         = COALESCE(?, sex),
      exercise    = COALESCE(?, exercise),
      goal        = COALESCE(?, goal),
      exercise_minutes_per_day = COALESCE(?, exercise_minutes_per_day)
    WHERE id = ?
  `);
  stmt.run(
    displayName ?? null,
    weight!==undefined && weight!=='' ? parseFloat(weight) : null,
    height!==undefined && height!=='' ? parseFloat(height) : null,
    age!==undefined && age!=='' ? parseInt(age,10) : null,
    sex ?? null,
    exercise ?? null,
    goal ?? null,
    (exercise_minutes_per_day!==undefined && exercise_minutes_per_day!==''
      ? Number(exercise_minutes_per_day) : null),
    userId
  );
  
  const updated = getUserById(userId);
  res.json({ok:true,user:updated});
});

/* --------------------------- Nutrition Endpoints -------------------------- */
function respondNutritionFromRow(u, { activity, protein_per_kg, fat_per_kg, sexOverride }) {
  const sex = normalizeSex(sexOverride || u.sex);
  const ageYears = Number(u.age);
  const heightCm = Number(u.height);
  const weightKg = Number(u.weight);

  if (!sex) throw new Error('missing sex: provide in DB or request body (male/female)');
  if (!Number.isFinite(ageYears) || ageYears <= 0) throw new Error('invalid age');
  if (!Number.isFinite(heightCm) || heightCm <= 0) throw new Error('invalid height');
  if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error('invalid weight');

  const activityFactor = activityFromExercise(u.exercise, activity);
  const proteinPerKg = Number(protein_per_kg ?? 1.0);
  const fatPerKg     = Number(fat_per_kg ?? 1.0);

  const bmr  = calcBMR({ sex, weightKg, heightCm, ageYears });
  const tdee = calcTDEE({ bmr, activityFactor });
  const targetCalories = Math.max(0, adjustForGoal(tdee, u.goal));
  const macros = calcMacros({ targetCalories, weightKg, proteinPerKg, fatPerKg });

  const round = (x, d=0) => Number(x.toFixed(d));
  return {
    user: {
      id: u.id, email: u.email, displayName: u.displayName,
      sex, age: ageYears, height_cm: heightCm, weight_kg: weightKg,
      exercise: u.exercise, goal: u.goal,
    },
    assumptions: {
      activity_factor: activityFactor,
      protein_g_per_kg: proteinPerKg,
      fat_g_per_kg: fatPerKg,
      formula: 'Mifflin-St Jeor',
      notes: 'Carbs = (TargetKcal - (Protein*4 + Fat*9))/4',
    },
    energy: {
      bmr_kcal: round(bmr, 0),
      tdee_kcal: round(tdee, 0),
      target_calories_kcal: round(targetCalories, 0),
    },
    macros: {
      protein_g: round(macros.proteinG, 0),
      fat_g:     round(macros.fatG, 0),
      carbs_g:   round(macros.carbsG, 0),
    },
    precise: {
      bmr_kcal: bmr,
      tdee_kcal: tdee,
      target_calories_kcal: targetCalories,
      protein_g: macros.proteinG,
      fat_g: macros.fatG,
      carbs_g: macros.carbsG,
    }
  };
}

app.get('/auth/me/nutrition', authGuard, (req, res) => {
  try {
    const u = getUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'user_not_found' });

    const result = respondNutritionFromRow(u, {
      activity: req.query.activity,
      protein_per_kg: req.query.protein_per_kg,
      fat_per_kg: req.query.fat_per_kg,
      sexOverride: req.body?.sex,
    });
    res.json(result);
  } catch (err) {
    console.error('[GET /auth/me/nutrition] error:', err);
    res.status(500).json({ error: 'server_error', detail: String(err.message || err) });
  }
});
app.get('/auth/users/:id/nutrition', (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'invalid_user_id' });
    const u = getUserById(userId);
    if (!u) return res.status(404).json({ error: 'user_not_found' });

    const result = respondNutritionFromRow(u, {
      activity: req.query.activity,
      protein_per_kg: req.query.protein_per_kg,
      fat_per_kg: req.query.fat_per_kg,
      sexOverride: req.body?.sex,
    });
    res.json(result);
  } catch (err) {
    console.error('[GET /auth/users/:id/nutrition] error:', err);
    res.status(500).json({ error: 'server_error', detail: String(err.message || err) });
  }
});

/* ------------------------------ AI Prediction ----------------------------- */
const mealUpload = multer({ storage }).single('image');
app.post('/ai/predict', authGuard, (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) return mealUpload(req, res, next);
  return next();
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image_required' });

    const imageAbs = req.file.path;
    const inferPy  = path.join(backendRoot, 'AI', 'Test', 'infer.py');

    console.log('[AI CALL]', { exec: process.env.PYTHON_EXEC, script: inferPy, image: imageAbs });

    const out = child_process.spawnSync(process.env.PYTHON_EXEC, [inferPy, imageAbs], { encoding: 'utf-8' });
    if (out.error) {
      console.error('[AI ERROR]', out.error);
      return res.status(500).json({ error: 'ai_process_error', detail: String(out.error) });
    }
    if (out.status !== 0) {
      console.error('[AI STDERR]', out.stderr);
      console.error('[AI STDOUT]', out.stdout);
      return res.status(500).json({ error: 'ai_infer_error', detail: out.stderr || out.stdout });
    }

    let pred = null;
    try { pred = JSON.parse(out.stdout); } catch {}
    if (!pred?.label) return res.status(500).json({ error: 'invalid_ai_output', raw: out.stdout });

    const urlPath = '/' + path.relative(backendRoot, imageAbs).replace(/\\/g, '/');
    res.json({ label: pred.label, confidence: pred.confidence ?? null, imagePath: urlPath });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ---------------------------- Nutrition Lookup ---------------------------- */
// NOTE: เส้นนี้ยังคง logic เดิม (NFS ก่อน แล้วค่อย fallback NutritionDB)
// ใช้กับหน้าค้น/เสียง/ฯลฯ
app.get('/nutrition', authGuard, (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'name_required' });

  const nut = getNutritionByNameLike(String(name));
  if (!nut) return res.status(404).json({ error: 'not_found' });

  // ✅ คืน serving ด้วย และ map เป็น ServingSizeGram ให้ฝั่งแอปอ่านได้แน่ๆ
  res.json({
    name: nut.name,
    kcal: nut.kcal ?? null,
    protein: nut.protein ?? null,
    fat: nut.fat ?? null,
    carb: nut.carb ?? (nut.carbs ?? null),
    serving: nut.serving ?? null,
    ServingSizeGram: nut.serving ?? null,
  });
});

/* ---------------------------------- Water --------------------------------- */
app.get('/water', authGuard, (req, res) => {
  try {
    const userId = req.user.id;
    const date = (req.query.date && String(req.query.date).slice(0, 10)) || todayThailandISO();

    const row = waterDb.prepare(`
      SELECT user_id, date, glasses, ml
      FROM water_logs
      WHERE user_id = ? AND date = ?
      LIMIT 1
    `).get(userId, date);

    res.json({ date, glasses: row?.glasses ?? 0, ml: row?.ml ?? 0 });
  } catch (e) {
    console.error('[GET /water] error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
});
app.put('/water', authGuard, (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};
    const date = (body.date && String(body.date).slice(0, 10)) || todayThailandISO();

    let glasses = Number(body.glasses);
    if (!Number.isFinite(glasses) || glasses < 0) glasses = 0;
    if (glasses > 20) glasses = 20;

    const mlPerGlass = Number(body.mlPerGlass);
    const ml = Number.isFinite(mlPerGlass) && mlPerGlass > 0
      ? Math.round(glasses * mlPerGlass)
      : Math.round(glasses * 250);

    const upsert = waterDb.prepare(`
      INSERT INTO water_logs (user_id, date, glasses, ml)
      VALUES (@user_id, @date, @glasses, @ml)
      ON CONFLICT(user_id, date)
      DO UPDATE SET glasses = excluded.glasses, ml = excluded.ml, updated_at = datetime('now')
    `);

    upsert.run({ user_id: userId, date, glasses, ml });
    res.json({ ok: true, date, glasses, ml });
  } catch (e) {
    console.error('[PUT /water] error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
});
app.get('/auth/me/water', authGuard, (req, res) => {
  const u = userDb.prepare(`
    SELECT id, weight, exercise_minutes_per_day
    FROM User WHERE id = ?
  `).get(req.user.id);

  if (!u) return res.status(404).json({ error: 'user_not_found' });

  const minutesPerDay = Number(u.exercise_minutes_per_day || 0);
  const water = calcWaterRange(u.weight, minutesPerDay);

  return res.json({
    ok: true,
    minutes_per_day: Number(minutesPerDay.toFixed(1)),
    min_l_per_day: water.min,
    max_l_per_day: water.max,
    extra_from_exercise: water.extra
  });
});
/* ---------------------------------- Meals --------------------------------- */
app.get('/meals', authGuard, (req, res) => {
  try {
    const userId = req.user.id;
    const date = (req.query.date && String(req.query.date).slice(0, 10)) || todayThailandISO();

    const items = mealDb.prepare(`
      SELECT id, date, mealType, name, quantity, unit, imagePath, kcal, protein, fat, carb
      FROM MealRecord
      WHERE userId = ? AND date = ?
      ORDER BY createdAt ASC, id ASC
    `).all(userId, date);

    const sum = items.reduce((acc, it) => {
      acc.kcal += Number(it.kcal) || 0;
      acc.protein += Number(it.protein) || 0;
      acc.fat += Number(it.fat) || 0;
      acc.carb += Number(it.carb) || 0;
      return acc;
    }, { kcal: 0, protein: 0, fat: 0, carb: 0 });

    const perType = {};
    for (const it of items) {
      const t = it.mealType || 'unknown';
      if (!perType[t]) perType[t] = [];
      perType[t].push(it);
    }

    res.json({
      items,
      summary: { kcal: sum.kcal, protein: sum.protein, fat: sum.fat, carb: sum.carb },
      perType
    });
  } catch (e) {
    console.error('[GET /meals] error:', e);
    res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
});

const mealImgUpload2 = upload.single('image');
app.post('/meals',
  authGuard,
  (req, res, next) => {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (ct.includes('multipart/form-data')) return mealImgUpload2(req, res, next);
    return next();
  },
  (req, res) => {
    try {
      const userId = req.user.id;
      const body = req.body || {};
      const date     = (body.date && String(body.date).slice(0, 10)) || todayThailandISO();
      const mealType = String(body.mealType || 'other');
      const name     = body.name ? String(body.name) : null;

      const quantity = body.quantity != null ? Number(body.quantity) : null;
      const unit     = body.unit ? String(body.unit) : null;
      const kcal     = body.kcal    != null ? Number(body.kcal)    : null;
      const protein  = body.protein != null ? Number(body.protein) : null;
      const fat      = body.fat     != null ? Number(body.fat)     : null;
      const carb     = body.carb    != null ? Number(body.carb)    : null;

      let imagePath = null;
      if (req.file && req.file.path) {
        const rel = path.relative(backendRoot, req.file.path).replace(/\\/g, '/');
        imagePath = '/' + rel;
      }

      // เติม qty อัตโนมัติจาก NFS ถ้าไม่ได้ส่งมา/ไม่เวิร์ก
      let finalQty = Number.isFinite(quantity) && quantity > 0 ? quantity : null;
      if (!finalQty && name) {
        const guess = findServingFromNfsByName(nfsDb, name);
        finalQty = Number.isFinite(guess) && guess > 0 ? guess : null;
      }
      if (!finalQty) finalQty = 100; // fallback
      const finalUnit = unit || 'g';

      // ใส่คอลัมน์ตามที่มีจริง (กันกรณี imagePath ไม่มี)
      const cols = mealDb.prepare(`PRAGMA table_info('MealRecord')`).all().map(c => c.name);
      const names = ['userId','date','mealType','name','quantity','unit','kcal','protein','fat','carb'];
      const vals  = [ userId,  date,  mealType,  name,  finalQty,  finalUnit,  kcal,  protein,  fat,  carb ];
      if (cols.includes('imagePath')) {
        names.splice(6, 0, 'imagePath');
        vals.splice(6, 0, imagePath);
      }
      const placeholders = names.map(() => '?').join(', ');
      const sql = `INSERT INTO MealRecord (${names.join(', ')}) VALUES (${placeholders})`;
      const info = mealDb.prepare(sql).run(...vals);

      res.status(201).json({ id: info.lastInsertRowid, ok: true, imagePath });
    } catch (e) {
      console.error('[POST /meals] error:', e);
      res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
    }
  }
);

app.delete('/meals/:id', authGuard, (req, res) => {
  const id = Number(req.params.id);
  mealDb.prepare(`DELETE FROM MealRecord WHERE id = ? AND userId = ?`).run(id, req.user.id);
  res.json({ ok: true });
});

app.get('/__debug/mealdb', (_req, res) => {
  try {
    const dbList = mealDb.prepare(`PRAGMA database_list`).all();
    const tableInfo = mealDb.prepare(`PRAGMA table_info('MealRecord')`).all();
    const createSQL = mealDb.prepare(`
      SELECT sql FROM sqlite_master WHERE type='table' AND name='MealRecord'
    `).get();

    res.json({ dbList, tableInfo, createSQL });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/* -------------------------------------------------------------------------- */
/*                              Error & start server                           */
/* -------------------------------------------------------------------------- */
app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'internal_error', message: String(err?.message || err) });
});

const PORT = Number(process.env.PORT || 5000);
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`✅ API server running on http://${HOST}:${PORT}`);
});
