import express from 'express';
import db from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

app.post('/auth/register', async (req, res) => {
  const {
    email,
    password,
    displayName, // = name จากหน้า Register
    weight,
    height,
    age,
    exercise,
    goal
  } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email_and_password_required' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const stmt = db.prepare(`
      INSERT INTO User (email, password, displayName, weight, height, age, exercise, goal)
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
      goal ?? null
    );

    const user = {
      id: info.lastInsertRowid,
      email: String(email).trim().toLowerCase(),
      displayName: displayName ?? null,
      weight: weight !== undefined && weight !== '' ? parseFloat(weight) : null,
      height: height !== undefined && height !== '' ? parseFloat(height) : null,
      age: age !== undefined && age !== '' ? parseInt(age, 10) : null,
      exercise: exercise ?? null,
      goal: goal ?? null
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
  res.json({ user: { id: row.id, email: row.email, displayName: row.displayName }, accessToken: token });
});

export default router;
