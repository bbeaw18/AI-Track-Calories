// routes/auth.js
import express from 'express';
import db from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// ✅ เพิ่มบรรทัดนี้
import {
  normalizeSex,
  activityFromExercise,
  calcBMR,
  calcTDEE,
  adjustForGoal,
  calcMacros,
} from '../services/calc.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

// ---------------- AUTH ----------------

// ❌ เดิม: app.post('/auth/register', ...)  // app ไม่ได้อยู่ในไฟล์นี้
// ✅ แก้เป็น:
router.post('/register', async (req, res) => {
  const {
    email,
    password,
    displayName, // = name จากหน้า Register
    weight,
    height,
    age,
    exercise,
    goal,
    sex
  } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email_and_password_required' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const stmt = db.prepare(`
      INSERT INTO User (email, password, displayName, weight, height, age, exercise, goal,sex)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
      (sex && String(sex).toLowerCase()) || null // 'male' | 'female'
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

    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ user, accessToken: token });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return res.status(409).json({ error: 'email_already_used' });
    }
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

  const row = db.prepare('SELECT * FROM User WHERE email = ?').get(email.trim().toLowerCase());
  if (!row) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, row.password);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  const token = jwt.sign({ sub: row.id, email: row.email }, JWT_SECRET, { expiresIn: '7d' });
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

// ------------- JWT middleware (เบา ๆ) -------------
function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const [, token] = hdr.split(' ');
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// ------------- Helpers -------------
function getUserById(userId) {
  return db.prepare(`
    SELECT id, email, displayName, sex, age, height, weight, exercise, goal FROM User WHERE id = ?

  `).get(userId);
}

function respondNutritionFromRow(u, { activity, protein_per_kg, fat_per_kg, sexOverride }) {
  const sex = normalizeSex(sexOverride || u.gender || u.sex);
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

// ------------- Nutrition Endpoints -------------

// ใช้ JWT → user ตนเอง
router.get('/me/nutrition', requireAuth, express.json(), (req, res) => {
  try {
    const u = getUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'user_not_found' });

    const result = respondNutritionFromRow(u, {
      activity: req.query.activity,
      protein_per_kg: req.query.protein_per_kg,
      fat_per_kg: req.query.fat_per_kg,
      sexOverride: req.body?.sex, // เผื่อ DB ไม่มี sex
    });
    res.json(result);
  } catch (err) {
    return res.status(400).json({ error: String(err.message || err) });
  }
});

// ระบุ userId (เช่น แอดมินเรียก)
router.get('/users/:id/nutrition', express.json(), (req, res) => {
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
    return res.status(400).json({ error: String(err.message || err) });
  }
});

export default router;
