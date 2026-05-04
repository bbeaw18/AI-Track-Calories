// routes/auth.js
import express from 'express';
import db from '../db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import {
  normalizeSex,
  activityFromExercise,
  calcBMR,
  calcTDEE,
  adjustForGoal,
  calcMacros,
} from '../services/calc.js';
import { calcWaterRange } from '../services/calc.js';


const TEMP_2FA_EXPIRES = '5m'; 
const APP_ISSUER = 'AI-Track-Cal';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
authenticator.options = { step: 30, window: 1 };
function signAccess(user) {
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
function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const [, token] = hdr.split(' ');
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, raw: payload };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

 function getUserById(userId) {
   return db.prepare(`
     SELECT id, email, displayName, sex, age, height, weight, exercise, goal
           , exercise_minutes_per_day
     FROM User WHERE id = ?
   `).get(userId);
 }


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

router.post('/register', async (req, res) => {
  const {
    email, password, displayName, weight, height, age, exercise, goal, sex,
    exercise_minutes_per_day   // <— NEW (นาทีเฉลี่ย/วัน)
  } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email_and_password_required' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);

    const stmt = db.prepare(`
      INSERT INTO User (email, password, displayName, weight, height, age, exercise, goal, sex,
                      exercise_minutes_per_day)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      (sex ? String(sex).toLowerCase() : null),
    Number(exercise_minutes_per_day || 0)
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
      sex: (sex ? String(sex).toLowerCase() : null),
    exercise_minutes_per_day: Number(exercise_minutes_per_day || 0)
    };

    const secret = authenticator.generateSecret();
    db.prepare(`UPDATE User SET totp_secret = ?, twofa_enabled = 0 WHERE id = ?`)
      .run(secret, user.id);

    const otpauth = authenticator.keyuri(user.email, APP_ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    const tempToken = signTemp2FA(user.id);
    const minutesPerDay = Number(exercise_minutes_per_day || 0);
    const waterSuggestion = calcWaterRange(user.weight, minutesPerDay);

    res.status(201).json({
      ok: true,
      user,
      requires2faSetup: true,
      tempToken,
      qrDataUrl,
      otpauth,
      waterSuggestion
    });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return res.status(409).json({ error: 'email_already_used' });
    }
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/register/verify-2fa', async (req, res) => {
  const { userId, token, tempToken } = req.body || {};
  if (!userId || !token || !tempToken) {
    return res.status(400).json({ error: 'missing_params' });
  }
  if (!verifyTemp2FA(tempToken, userId)) {
    return res.status(401).json({ error: 'invalid_temp_token' });
  }

  const row = db.prepare('SELECT * FROM User WHERE id = ?').get(Number(userId));
  if (!row || !row.totp_secret) return res.status(400).json({ error: 'no_secret' });

  const valid = authenticator.check(String(token), row.totp_secret);
  if (!valid) return res.status(400).json({ error: 'invalid_otp' });

  db.prepare('UPDATE User SET twofa_enabled = 1 WHERE id = ?').run(Number(userId));

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

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

  const row = db.prepare('SELECT * FROM User WHERE email = ?').get(String(email).trim().toLowerCase());
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
      sex: row.sex,
      exercise_minutes_per_day: row.exercise_minutes_per_day ?? 0
    },
    accessToken
  });
});
router.post('/2fa/check', (req, res) => {
  const { userId, token, tempToken } = req.body || {};
  if (!userId || !token || !tempToken) {
    return res.status(400).json({ error: 'missing_params' });
  }
  if (!verifyTemp2FA(tempToken, userId)) {
    return res.status(401).json({ error: 'invalid_temp_token' });
  }

  const row = db.prepare('SELECT * FROM User WHERE id = ?').get(Number(userId));
  if (!row || !row.totp_secret || Number(row.twofa_enabled) !== 1) {
    return res.status(400).json({ error: '2fa_not_enabled' });
  }

  let ok = false;
  if (/^\d{6}$/.test(String(token))) {
    ok = authenticator.check(String(token), row.totp_secret);
  } else {
    ok = false;
  }

  if (!ok) return res.status(400).json({ error: 'invalid_otp' });

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
      sex: row.sex,
      exercise_minutes_per_day: row.exercise_minutes_per_day ?? 0
    }
  });
});



router.get('/me', requireAuth, (req, res) => {
  const row = db.prepare(`
    SELECT id, email, displayName, sex, weight, height, age, exercise, goal, exercise_minutes_per_day
    FROM User WHERE id = ?
  `).get(req.user.id);

  if (!row) return res.status(404).json({ error: 'user_not_found' });
  res.json(row);
});

router.put('/me', requireAuth, (req, res) => {
  const { displayName, weight, height, age, sex, exercise, goal } = req.body || {};
  const userId = req.user.id;

  const row = db.prepare('SELECT * FROM User WHERE id = ?').get(userId);
  if (!row) return res.status(404).json({ error: 'user_not_found' });

  const stmt = db.prepare(`
    UPDATE User SET
      displayName = COALESCE(?, displayName),
      weight      = COALESCE(?, weight),
      height      = COALESCE(?, height),
      age         = COALESCE(?, age),
      sex         = COALESCE(?, sex),
      exercise    = COALESCE(?, exercise),
      goal        = COALESCE(?, goal)
    WHERE id = ?
  `);

  stmt.run(
    displayName ?? null,
    weight !== undefined && weight !== '' ? parseFloat(weight) : null,
    height !== undefined && height !== '' ? parseFloat(height) : null,
    age !== undefined && age !== '' ? parseInt(age, 10) : null,
    sex ?? null,
    exercise ?? null,
    goal ?? null,
    userId
  );

  const updated = db.prepare(`
    SELECT id, email, displayName, sex, weight, height, age, exercise, goal,exercise_minutes_per_day
    FROM User WHERE id = ?
  `).get(userId);

  res.json({ ok: true, user: updated });
});


router.get('/me/nutrition', requireAuth, (req, res) => {
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
    return res.status(400).json({ error: String(err.message || err) });
  }
});

router.get('/users/:id/nutrition', (req, res) => {
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
// BackEnd/src/routes/auth.js
import express from 'express';
import db from '../server.js'; // ใช้ instance เดียวกับ server
import { calcWaterRange, /* อื่นๆ */ } from '../services/calc.js';
// ...โค้ดเดิม

// ---- น้ำตามโปรไฟล์ที่บันทึกไว้ ----
router.get('/me/water', requireAuth, (req, res) => {
  const u = db.prepare(`
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

// ---- น้ำแบบลองกรอกนาทีชั่วคราว ----
router.get('/me/water/estimate', requireAuth, (req, res) => {
  const u = db.prepare(`SELECT id, weight FROM User WHERE id = ?`).get(req.user.id);
  if (!u) return res.status(404).json({ error: 'user_not_found' });

  const minutesPerDay = Number(req.query.minutesPerDay ?? 0);
  const water = calcWaterRange(u.weight, minutesPerDay);

  return res.json({
    ok: true,
    minutes_per_day: Number(minutesPerDay.toFixed(1)),
    min_l_per_day: water.min,
    max_l_per_day: water.max,
    extra_from_exercise: water.extra
  });
});

export default router;

