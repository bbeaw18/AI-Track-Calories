import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';
import child_process from 'child_process';
import {
  normalizeSex,
  activityFromExercise,
  calcBMR,
  calcTDEE,
  adjustForGoal,
  calcMacros,
} from './services/calc.js';

// ----------------------------------------------------
// Path & constants
// ----------------------------------------------------
const PYTHON_EXEC = process.env.PYTHON_EXEC || (process.platform === 'win32' ? 'py' : 'python');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backendRoot = path.resolve(__dirname, '..');
const dbRoot = path.join(backendRoot, 'Database');

// ----------------------------------------------------
// DB open helpers
// ----------------------------------------------------
function openDb(p) {
  const full = path.join(dbRoot, p);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const conn = new Database(full);
  conn.pragma('journal_mode = WAL');
  return conn;
}

const userDb = openDb('UserData.sqlite');         // users
const nutritionDb = openDb('NutritionDB.sqlite'); // food nutrition lookup
const mealDb = openDb('MealRecord.sqlite');       // meals records

console.log('📂 DB paths:');
console.log('  UserData:', path.join(dbRoot, 'UserData.sqlite'));
console.log('  NutritionDB:', path.join(dbRoot, 'NutritionDB.sqlite'));
console.log('  MealRecord:', path.join(dbRoot, 'MealRecord.sqlite'));

// ----------------------------------------------------
// Schema (ensure tables exist)
// ----------------------------------------------------
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
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
const existingUserCols = userDb.prepare(`PRAGMA table_info(User);`).all().map(c => c.name);
function addUserCol(name, type) {
  if (!existingUserCols.includes(name)) {
    userDb.exec(`ALTER TABLE User ADD COLUMN ${name} ${type};`);
  }
}
addUserCol('displayName', 'TEXT');
addUserCol('weight', 'REAL');
addUserCol('height', 'REAL');
addUserCol('age', 'INTEGER');
addUserCol('exercise', 'TEXT');
addUserCol('goal', 'TEXT');
addUserCol('createdAt', 'TEXT');
addUserCol('sex', 'TEXT'); // male | female


mealDb.exec(`
CREATE TABLE IF NOT EXISTS MealRecord (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  mealType TEXT NOT NULL,        -- breakfast | lunch | dinner | other
  name TEXT,
  quantity REAL,
  unit TEXT,
  imagePath TEXT,                -- public path e.g. /uploads/xxx.jpg
  kcal REAL,
  protein REAL,
  fat REAL,
  carb REAL,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

nutritionDb.exec(`
-- ตารางตัวอย่าง (คุณปรับ / นำเข้าข้อมูลจริงทีหลังได้)
CREATE TABLE IF NOT EXISTS Nutrition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  calories REAL,
  protein REAL,
  fat REAL,
  carbs REAL
);
`);

// ----------------------------------------------------
// Express init
// ----------------------------------------------------
const app = express();
app.use(cors({ origin: '*' })); // dev only
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

// uploads
const uploadsDir = path.join(backendRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(jpeg|png|webp|heic|heif)/.test(file?.mimetype || '');
    if (ok) return cb(null, true);
    return cb(new Error('unsupported_image_type'));
  }
});

// serve uploads
app.use('/uploads', express.static(uploadsDir));

// ----------------------------------------------------
// Middleware
// ----------------------------------------------------
function authGuard(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing_token' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// Nutrition lookup (ปรับชื่อ/คอลัมน์ให้ตรง DB จริงของคุณได้)
function normalizeThaiFoodName(s = '') {
  return String(s).trim().toLowerCase().replace(/\s+/g, '')
    .replace(/ผัดกระเพรา|ผัดกะเพราะ|ผัดกระเพราะ/g, 'ผัดกะเพรา');
}

function getNutritionByNameLike(name) {
  const raw = String(name || '');
  const norm = normalizeThaiFoodName(raw);
  const like = `%${raw}%`;
  const likeNorm = `%${norm}%`;

  // 1) ตาราง foods (ของคุณ)
  const foodsCandidates = [
    // ตรงชื่อไทย
    { sql: `
      SELECT NameTH AS name, EnergyKcal AS kcal, ProteinG AS protein, FatG AS fat, CarbohydrateG AS carb,
             ServingSizeGram AS serving
      FROM foods
      WHERE NameTH LIKE ? LIMIT 1
    `, args: [like] },

    // ตรงชื่ออังกฤษ
    { sql: `
      SELECT NameEng AS name, EnergyKcal AS kcal, ProteinG AS protein, FatG AS fat, CarbohydrateG AS carb,
             ServingSizeGram AS serving
      FROM foods
      WHERE NameEng LIKE ? LIMIT 1
    `, args: [like] },

    // แบบ normalize (ลบช่องว่าง + ตัวเล็ก) ฝั่ง NameTH
    { sql: `
      SELECT NameTH AS name, EnergyKcal AS kcal, ProteinG AS protein, FatG AS fat, CarbohydrateG AS carb,
             ServingSizeGram AS serving
      FROM foods
      WHERE REPLACE(LOWER(NameTH), ' ', '') LIKE ? LIMIT 1
    `, args: [likeNorm] },

    // แบบ normalize ฝั่ง NameEng
    { sql: `
      SELECT NameEng AS name, EnergyKcal AS kcal, ProteinG AS protein, FatG AS fat, CarbohydrateG AS carb,
             ServingSizeGram AS serving
      FROM foods
      WHERE REPLACE(LOWER(NameEng), ' ', '') LIKE ? LIMIT 1
    `, args: [likeNorm] },
  ];

  for (const q of foodsCandidates) {
    try {
      const row = nutritionDb.prepare(q.sql).get(...q.args);
      if (row) {
        // ส่งคืนรูปแบบเดียวกับ API เดิม + แนบ serving ถ้ามี
        return {
          name: row.name,
          kcal: row.kcal != null ? Number(row.kcal) : null,
          protein: row.protein != null ? Number(row.protein) : null,
          fat: row.fat != null ? Number(row.fat) : null,
          carb: row.carb != null ? Number(row.carb) : null,
          serving: row.serving != null ? Number(row.serving) : null, // ขนาดเสิร์ฟ (กรัม) ถ้ามี
        };
      }
    } catch {}
  }

  // 2) fallback: ตาราง Nutrition (ถ้าใครยังใช้ชื่อเดิม)
  const likeLower = `%${raw.toLowerCase()}%`;
  const oldCandidates = [
    { sql: `SELECT name AS name, calories AS kcal, protein, fat, carbs AS carb FROM Nutrition WHERE name LIKE ? LIMIT 1`, args:[like] },
    { sql: `SELECT name AS name, calories AS kcal, protein, fat, carbs AS carb FROM Nutrition WHERE LOWER(name) LIKE ? LIMIT 1`, args:[likeLower] },
  ];
  for (const q of oldCandidates) {
    try {
      const row = nutritionDb.prepare(q.sql).get(...q.args);
      if (row) return row;
    } catch {}
  }

  return null;
}

// ----------------------------------------------------
// Routes
// ----------------------------------------------------
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Auth
app.post('/auth/register', async (req, res) => {
   const { email, password, displayName, weight, height, age, exercise, goal, sex } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const stmt = userDb.prepare(`
      INSERT INTO User (email, password, displayName, weight, height, age, exercise, goal, sex)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      String(email).trim().toLowerCase(),
      hash,
      displayName ?? null,
      weight !== undefined && weight !== '' ? parseFloat(weight) : null,
      height !== undefined && height !== '' ? parseFloat(height) : null,
      age !== undefined && age !== '' ? parseInt(age, 10) : null,
      exercise ?? null,
      goal ?? null,
      (sex && String(sex).toLowerCase()) || null   // 'male' | 'female'
    );

    const user = {
      id: info.lastInsertRowid,
      email: String(email).trim().toLowerCase(),
      displayName: displayName ?? null,
      weight: weight !== undefined && weight !== '' ? parseFloat(weight) : null,
      height: height !== undefined && height !== '' ? parseFloat(height) : null,
      age: age !== undefined && age !== '' ? parseInt(age, 10) : null,
      exercise: exercise ?? null,
      goal: goal ?? null,
      sex: (sex && String(sex).toLowerCase()) || null
    };
    const accessToken = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user, accessToken });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'email_already_used' });
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

  const row = userDb.prepare('SELECT * FROM User WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!row) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, row.password);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const accessToken = jwt.sign({ sub: row.id, email: row.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
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
// ---------------- Nutrition Calc ----------------

// ใช้ JWT → โภชนาการของ "ตัวเอง"
app.get('/auth/me/nutrition', authGuard, (req, res) => {
  try {
    const u = getUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'user_not_found' });

    // รับ sex จาก body (กรณี DB ยังไม่มี)
    const sex = normalizeSex((req.body && req.body.sex) || u.sex);
    const ageYears = Number(u.age);
    const heightCm = Number(u.height);
    const weightKg = Number(u.weight);

    if (!sex) return res.status(400).json({ error: 'missing_sex (provide in DB or body)' });
    if (!Number.isFinite(ageYears) || ageYears <= 0) return res.status(400).json({ error: 'invalid_age' });
    if (!Number.isFinite(heightCm) || heightCm <= 0) return res.status(400).json({ error: 'invalid_height' });
    if (!Number.isFinite(weightKg) || weightKg <= 0) return res.status(400).json({ error: 'invalid_weight' });

    // override ได้ด้วย query: ?activity=1.55&protein_per_kg=1.0&fat_per_kg=1.0
    const activityFactor = activityFromExercise(u.exercise, req.query.activity);
    const proteinPerKg = Number(req.query.protein_per_kg ?? 1.0);
    const fatPerKg     = Number(req.query.fat_per_kg ?? 1.0);

    const bmr  = calcBMR({ sex, weightKg, heightCm, ageYears });
    const tdee = calcTDEE({ bmr, activityFactor });
    const targetCalories = Math.max(0, adjustForGoal(tdee, u.goal));
    const macros = calcMacros({ targetCalories, weightKg, proteinPerKg, fatPerKg });

    const round = (x, d=0) => Number(x.toFixed(d));

    res.json({
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
    });
  } catch (err) {
    console.error('[GET /auth/me/nutrition] error:', err);
    res.status(500).json({ error: 'server_error', detail: String(err.message || err) });
  }
});

// ระบุ userId เอง (เช่น แอดมิน)
app.get('/auth/users/:id/nutrition', (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'invalid_user_id' });
    const u = getUserById(userId);
    if (!u) return res.status(404).json({ error: 'user_not_found' });

    const sex = normalizeSex((req.body && req.body.sex) || u.sex);
    const ageYears = Number(u.age);
    const heightCm = Number(u.height);
    const weightKg = Number(u.weight);

    if (!sex) return res.status(400).json({ error: 'missing_sex (provide in DB or body)' });
    if (!Number.isFinite(ageYears) || ageYears <= 0) return res.status(400).json({ error: 'invalid_age' });
    if (!Number.isFinite(heightCm) || heightCm <= 0) return res.status(400).json({ error: 'invalid_height' });
    if (!Number.isFinite(weightKg) || weightKg <= 0) return res.status(400).json({ error: 'invalid_weight' });

    const activityFactor = activityFromExercise(u.exercise, req.query.activity);
    const proteinPerKg = Number(req.query.protein_per_kg ?? 1.0);
    const fatPerKg     = Number(req.query.fat_per_kg ?? 1.0);

    const bmr  = calcBMR({ sex, weightKg, heightCm, ageYears });
    const tdee = calcTDEE({ bmr, activityFactor });
    const targetCalories = Math.max(0, adjustForGoal(tdee, u.goal));
    const macros = calcMacros({ targetCalories, weightKg, proteinPerKg, fatPerKg });

    const round = (x, d=0) => Number(x.toFixed(d));

    res.json({
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
    });
  } catch (err) {
    console.error('[GET /auth/users/:id/nutrition] error:', err);
    res.status(500).json({ error: 'server_error', detail: String(err.message || err) });
  }
});


// AI Predict
app.post('/ai/predict', authGuard, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image_required' });

    const imageAbs = req.file.path;
    const inferPy = path.join(backendRoot, 'AI', 'Test', 'infer.py');

    console.log('[AI CALL]', { exec: PYTHON_EXEC, script: inferPy, image: imageAbs });

    const out = child_process.spawnSync(PYTHON_EXEC, [inferPy, imageAbs], { encoding: 'utf-8' });
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

// Nutrition lookup
app.get('/nutrition', authGuard, (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'name_required' });

  const nut = getNutritionByNameLike(String(name));
  if (!nut) return res.status(404).json({ error: 'not_found' });

  res.json({
    name: nut.name,
    kcal: nut.kcal ?? null,
    protein: nut.protein ?? null,
    fat: nut.fat ?? null,
    carb: nut.carb ?? (nut.carbs ?? null)
  });
});
function getUserById(userId) {
  return userDb.prepare(`
    SELECT id, email, displayName, sex, age, height, weight, exercise, goal
    FROM User WHERE id = ?
  `).get(userId);
}

// Save meal
app.post('/meals', authGuard, upload.single('image'), (req, res) => {
  const { date, mealType, name, quantity, unit, kcal, protein, fat, carb } = req.body || {};
  if (!date || !mealType || !name) return res.status(400).json({ error: 'missing_required' });

  const imagePath = req.file
    ? '/' + path.relative(backendRoot, req.file.path).replace(/\\/g, '/')
    : (req.body.imagePath || null);

  const stmt = mealDb.prepare(`
    INSERT INTO MealRecord (userId, date, mealType, name, quantity, unit, imagePath, kcal, protein, fat, carb)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    req.user.id,
    String(date),
    String(mealType),
    String(name),
    quantity ? parseFloat(quantity) : null,
    unit ?? 'g',
    imagePath,
    kcal ? parseFloat(kcal) : null,
    protein ? parseFloat(protein) : null,
    fat ? parseFloat(fat) : null,
    carb ? parseFloat(carb) : null
  );

  res.status(201).json({ id: info.lastInsertRowid });
});

// Get meals
app.get('/meals', authGuard, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const rows = mealDb.prepare(
    `SELECT * FROM MealRecord WHERE userId = ? AND date = ? ORDER BY id DESC`
  ).all(req.user.id, String(date));

  const summary = rows.reduce((acc, r) => {
    acc.kcal += r.kcal || 0;
    acc.protein += r.protein || 0;
    acc.fat += r.fat || 0;
    acc.carb += r.carb || 0;
    return acc;
  }, { date, kcal: 0, protein: 0, fat: 0, carb: 0 });

  const perType = { breakfast: 0, lunch: 0, dinner: 0, other: 0 };
  rows.forEach(r => { perType[r.mealType] = (perType[r.mealType] || 0) + (r.kcal || 0); });

  res.json({ items: rows, summary, perType });
});

// Delete meal
app.delete('/meals/:id', authGuard, (req, res) => {
  const id = Number(req.params.id);
  mealDb.prepare(`DELETE FROM MealRecord WHERE id = ? AND userId = ?`).run(id, req.user.id);
  res.json({ ok: true });
});

// ----------------------------------------------------
// Error handler & Start
// ----------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'internal_error', message: String(err?.message || err) });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ API server running on http://localhost:${PORT}`);
});
