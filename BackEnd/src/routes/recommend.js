// BackEnd/src/routes/recommend.js
import express from 'express';

export default function createRecommendRouter(db) {
  const router = express.Router();

  const REQUIRED = ['NameTH','NameEng','EnergyKcal','ProteinG','FatG','CarbohydrateG'];

  const listTables = () =>
    db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all().map(r => r.name);
  const tableCols = (t) => {
    try { return db.prepare(`PRAGMA table_info(${t});`).all().map(c => c.name); } catch { return []; }
  };
  const findTable = () => {
    for (const t of listTables()) {
      const cols = tableCols(t).map(s => s.toLowerCase());
      if (REQUIRED.every(c => cols.includes(c.toLowerCase()))) return t;
    }
    return null;
  };

  let TABLE = findTable();

  router.get('/_debug', (_req, res) => {
    const schema = {};
    for (const t of listTables()) schema[t] = tableCols(t);
    res.json({ tableDetected: TABLE, schema });
  });

  router.get('/', (req, res) => {
    try {
      if (!TABLE) TABLE = findTable();
      if (!TABLE) return res.status(500).json({ error: 'table_not_found' });

      const cols = tableCols(TABLE);
      const idCol = cols.includes('FoodID') ? 'FoodID' : 'ROWID';

      const qAll = String(req.query.all ?? '').toLowerCase();
      const ALL  = qAll === '1' || qAll === 'true' || qAll === 'yes';
      const search = String(req.query.search ?? '').trim();

      const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
      const limit = Math.max(1, Math.min(parseInt(req.query.limit ?? '50', 10), 500));
      const offset = (page - 1) * limit;

      const whereSql = search ? `WHERE NameTH LIKE ? OR NameEng LIKE ?` : ``;
      const whereArgs = search ? [`%${search}%`, `%${search}%`] : [];

      const countRow = db.prepare(`SELECT COUNT(*) AS total FROM ${TABLE} ${whereSql}`).get(...whereArgs);
      const total = Number(countRow?.total ?? 0);

      const baseSel = `
        SELECT
          ${idCol}         AS id,
          NameTH           AS NameTH,
          NameEng          AS NameEng,
          EnergyKcal       AS EnergyKcal,
          ProteinG         AS ProteinG,
          FatG             AS FatG,
          CarbohydrateG    AS CarbohydrateG
        FROM ${TABLE}
      `;

      let rows;
      if (ALL) {
        rows = db.prepare(`${baseSel} ${whereSql} ORDER BY NameTH ASC`).all(...whereArgs);
      } else {
        rows = db.prepare(`${baseSel} ${whereSql} ORDER BY NameTH ASC LIMIT ? OFFSET ?`).all(...whereArgs, limit, offset);
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

      const pageSize = ALL ? items.length : limit;
      const hasMore = ALL ? false : offset + items.length < total;

      res.json({ items, meta: { total, page, pageSize, hasMore, table: TABLE } });
    } catch (e) {
      console.error('[recommend] error:', e);
      res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
    }
  });

  return router;
}
