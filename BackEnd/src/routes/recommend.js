// BackEnd/src/routes/recommend.js
import express from 'express';

export default function createRecommendRouter(db) {
  const router = express.Router();

  // ตรวจว่ามีตารางไหนมีคอลัมน์ชุดที่ต้องการ
  const REQUIRED = ['NameTH','NameEng','EnergyKcal','ProteinG','FatG','CarbohydrateG'];

  function listTables() {
    return db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all().map(r => r.name);
  }
  function tableCols(t) {
    try { return db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); } catch { return []; }
  }
  function findTable() {
    const candidates = listTables();
    for (const t of candidates) {
      const cols = tableCols(t).map(s => s.toLowerCase());
      const ok = REQUIRED.every(c => cols.includes(c.toLowerCase()));
      if (ok) return t;
    }
    return null;
  }

  let TABLE = findTable(); // cache

  router.get('/_debug', (_req, res) => {
    const schema = {};
    for (const t of listTables()) schema[t] = tableCols(t);
    res.json({ tableDetected: TABLE, schema });
  });

  router.get('/', (req, res) => {
  try {
    if (!TABLE) TABLE = findTable();
    if (!TABLE) return res.status(500).json({ error: 'table_not_found' });

    // column id (ถ้ามี FoodID ก็ใช้, ไม่มีก็ ROWID)
    const cols = tableCols(TABLE);
    const hasFoodId = cols.includes('FoodID');
    const ID = hasFoodId ? 'FoodID' : 'ROWID';

    // ─── query params ───────────────────────────────────────────────
    const qAll   = String(req.query.all ?? '').toLowerCase();
    const ALL    = qAll === '1' || qAll === 'true' || qAll === 'yes';
    const search = String(req.query.search ?? '').trim();

    // pagination
    const page   = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit  = Math.max(1, Math.min(parseInt(req.query.limit ?? '50', 10), 500));
    const offset = (page - 1) * limit;

    // ─── base select/where ──────────────────────────────────────────
    const selectSql = `
      SELECT
        ${ID}            AS id,
        NameTH           AS NameTH,
        NameEng          AS NameEng,
        EnergyKcal       AS EnergyKcal,
        ProteinG         AS ProteinG,
        FatG             AS FatG,
        CarbohydrateG    AS CarbohydrateG
      FROM ${TABLE}
    `;
    const whereSql = search
      ? `WHERE NameTH LIKE ? OR NameEng LIKE ?`
      : ``;
    const whereArgs = search ? [`%${search}%`, `%${search}%`] : [];

    // ─── count ทั้งหมด (เพื่อคำนวณ hasMore) ───────────────────────
    const countRow = db.prepare(
      `SELECT COUNT(*) AS total FROM ${TABLE} ${whereSql}`
    ).get(...whereArgs);
    const total = Number(countRow?.total ?? 0);

    // ─── query หลัก ─────────────────────────────────────────────────
    let rows;
    if (ALL) {
      rows = db.prepare(
        `${selectSql} ${whereSql} ORDER BY NameTH ASC`
      ).all(...whereArgs);
    } else {
      rows = db.prepare(
        `${selectSql} ${whereSql} ORDER BY NameTH ASC LIMIT ? OFFSET ?`
      ).all(...whereArgs, limit, offset);
    }

    const toNum = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
    const items = rows.map(r => ({
      id: r.id,
      name: r.NameTH,
      nameEng: r.NameEng,
      kcal: toNum(r.EnergyKcal),
      protein: toNum(r.ProteinG),
      fat: toNum(r.FatG),
      carb: toNum(r.CarbohydrateG),
      tags: [],
    }));

    // meta
    const pageSize = ALL ? items.length : limit;
    const hasMore  = ALL ? false : offset + items.length < total;

    res.json({
      items,
      meta: { total, page, pageSize, hasMore, table: TABLE }
    });
  } catch (err) {
    console.error('[GET /recommend] error:', err);
    res.status(500).json({ error: 'server_error', detail: String(err?.message || err) });
  }
});


  return router;
}
