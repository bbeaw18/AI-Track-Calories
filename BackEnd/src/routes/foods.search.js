// BackEnd/src/routes/foods.search.js
import express from "express";

/* --------------------------- Thai normalize helpers --------------------------- */
const THAI_DIAC = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g;
const THAI_NUM = { "๐":"0","๑":"1","๒":"2","๓":"3","๔":"4","๕":"5","๖":"6","๗":"7","๘":"8","๙":"9" };
const toArabic = s => String(s).replace(/[๐-๙]/g, ch => THAI_NUM[ch] ?? ch);
const normalizeThai = (s="") => {
  s = toArabic(String(s ?? "").normalize("NFC")).toLowerCase();
  s = s.replace(THAI_DIAC, "");
  s = s.replace(/[()\[\]{}"“”'’.,:;!?/\\\-–_|+]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
};
const noSpace = s => String(s).replace(/\s+/g, "");

/* ------------------------ fuzzy & similarity helpers ------------------------ */
function levenshtein(a="",b=""){
  if(a===b) return 0; if(!a) return b.length; if(!b) return a.length;
  const m=a.length,n=b.length; let prev=new Array(n+1),cur=new Array(n+1);
  for(let j=0;j<=n;j++) prev[j]=j;
  for(let i=1;i<=m;i++){ cur[0]=i; const ai=a.charCodeAt(i-1);
    for(let j=1;j<=n;j++){ const cost=ai===b.charCodeAt(j-1)?0:1;
      const del=prev[j]+1, ins=cur[j-1]+1, sub=prev[j-1]+cost;
      cur[j]=Math.min(del, ins, sub);
    } [prev,cur]=[cur,prev];
  } return prev[n];
}
const levSim = (a,b) => 1 - (levenshtein(a,b)/(Math.max(a.length,b.length)||1));
const charBigrams = s => { const a=[...s]; const out=[]; for(let i=0;i<a.length-1;i++) out.push(a[i]+a[i+1]); return out; };
function cosineSim(aStr,bStr){
  const A=new Map(),B=new Map(); for(const x of charBigrams(aStr)) A.set(x,(A.get(x)||0)+1);
  for(const x of charBigrams(bStr)) B.set(x,(B.get(x)||0)+1);
  if(!A.size||!B.size) return 0; let dot=0,na=0,nb=0;
  for(const [k,va] of A){ const vb=B.get(k)||0; dot+=va*vb; na+=va*va; }
  for(const [,vb] of B) nb+=vb*vb;
  return dot===0?0:(dot/(Math.sqrt(na)*Math.sqrt(nb)));
}

/* -------------------------- module-level shared state -------------------------- */
/** db ที่ใช้จริงจาก server */
let _db = null;
/** โครงสร้าง meta เกี่ยวกับ table/column/sql ที่เจอใน DB */
let _meta = null;
/** ดัชนีคำในหน่วยความจำ */
let _idx = [];
let _inv = new Map();
/** ธงบอกว่าควร rebuild index */
let _isDirty = true;

/* --------------------------- meta & index builders --------------------------- */
const tableExists  = (t)=>{ try{ return !!_db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t); }catch{ return false; } };
const columnExists = (t,c)=>{ try{ return _db.prepare(`PRAGMA table_info(${t})`).all().some(x=>x.name===c); }catch{ return false; } };

function resolveMeta() {
  const TABLE = tableExists("foods") ? "foods" : (tableExists("FoodList") ? "FoodList" : null);
  if (!TABLE) throw new Error("[foods.search] no table 'foods' or 'FoodList' found");

  const ID_COL   = columnExists(TABLE,"id") ? "id" : (columnExists(TABLE,"FoodID") ? "FoodID" : null);
  const NTH_COL  = columnExists(TABLE,"NameTH") ? "NameTH" : (columnExists(TABLE,"name_th") ? "name_th" : null);
  const NEN_COL  = columnExists(TABLE,"NameEng") ? "NameEng" : (columnExists(TABLE,"name_en") ? "name_en" : null);
  const KCAL_COL = columnExists(TABLE,"EnergyKcal") ? "EnergyKcal" : (columnExists(TABLE,"calories") ? "calories" : null);
  const PROT_COL = columnExists(TABLE,"ProteinG") ? "ProteinG" : (columnExists(TABLE,"protein") ? "protein" : null);
  const FAT_COL  = columnExists(TABLE,"FatG") ? "FatG" : (columnExists(TABLE,"fat") ? "fat" : null);
  const CARB_COL = columnExists(TABLE,"CarbohydrateG") ? "CarbohydrateG" : (columnExists(TABLE,"carb") ? "carb" : null);
  const SERV_COL = columnExists(TABLE,"ServingSizeGram") ? "ServingSizeGram" : (columnExists(TABLE,"serving") ? "serving" : null);

  if (!ID_COL || !NTH_COL) throw new Error(`[foods.search] missing ID/NameTH columns in ${TABLE}`);

  const SELECT_BASE = `
    SELECT
      ${ID_COL}             AS id,
      ${NTH_COL}            AS name_th,
      ${NEN_COL ?? "NULL"}  AS name_en,
      ${KCAL_COL ?? "NULL"} AS calories,
      ${PROT_COL ?? "NULL"} AS protein,
      ${FAT_COL  ?? "NULL"} AS fat,
      ${CARB_COL ?? "NULL"} AS carb,
      ${SERV_COL ?? "NULL"} AS serving
    FROM ${TABLE}
  `;
  const LIKE_SQL = `
    ${SELECT_BASE}
    WHERE ${NTH_COL} LIKE ? OR REPLACE(LOWER(${NTH_COL}),' ','') LIKE ?
    LIMIT 50
  `;
  const SELECT_BY_ID_SQL = `${SELECT_BASE} WHERE ${ID_COL}=?`;
  const SELECT_DISTINCT_NAMES_SQL = `
    SELECT ${ID_COL} AS id, ${NTH_COL} AS name_th
    FROM ${TABLE}
    WHERE ${NTH_COL} IS NOT NULL AND TRIM(${NTH_COL})!=''
    GROUP BY ${ID_COL}, ${NTH_COL}
  `;

  return { TABLE, ID_COL, NTH_COL, NEN_COL, SELECT_BASE, LIKE_SQL, SELECT_BY_ID_SQL, SELECT_DISTINCT_NAMES_SQL };
}

function rebuildIndex() {
  if (!_db) return;
  if (!_meta) _meta = resolveMeta();
  let rows = [];
  try {
    rows = _db.prepare(_meta.SELECT_DISTINCT_NAMES_SQL).all();
  } catch (e) {
    console.warn("[foods.search] index load fail:", e.message);
    rows = [];
  }
  _idx = rows.map(r => {
    const norm = normalizeThai(r.name_th);
    return { dbId: r.id, name: r.name_th, norm, normNo: noSpace(norm) };
  });
  _inv = new Map();
  _idx.forEach(it => {
    for (const bg of charBigrams(it.normNo)) {
      if (!_inv.has(bg)) _inv.set(bg, new Set());
      _inv.get(bg).add(it.dbId);
    }
  });
  _isDirty = false;
}

function ensureIndex() {
  if (_isDirty || !_idx.length) rebuildIndex();
}

/** ให้ server เรียกหลังจาก upsert/insert/delete เพื่อบอกให้รีเฟรชดัชนีรอบถัดไป */
export function markFoodsIndexDirty() { _isDirty = true; }

/* ----------------------------- public router API ---------------------------- */
export default function createFoodsSearchRouter(db) {
  // รับ db จาก server แล้วเตรียม meta + ทำให้ดัชนี dirty ไว้ก่อน
  _db = db;
  _meta = resolveMeta();
  _isDirty = true;

  const router = express.Router();

  const candidateIdsByNgram = (qNo, max=1500) => {
    const seen = new Map();
    for (const bg of charBigrams(qNo)) {
      const set = _inv.get(bg);
      if (!set) continue;
      for (const dbId of set) seen.set(dbId, (seen.get(dbId)||0) + 1);
    }
    return [...seen.entries()].sort((a,b)=>b[1]-a[1]).slice(0, max).map(([dbId])=>dbId);
  };
  const scoreAgainst = (it, qNorm, qNo) => 0.65*levSim(it.normNo, qNo) + 0.35*cosineSim(it.normNo, qNo);

  function suggestName(rawQ) {
    ensureIndex();
    const qNorm = normalizeThai(rawQ);
    const qNo   = noSpace(qNorm);
    const candIds = candidateIdsByNgram(qNo, 1200);
    const byId = new Map(_idx.map(x => [x.dbId, x]));
    const scored = candIds.map(dbId => {
      const it = byId.get(dbId);
      return { dbId, name: it?.name || "", score: scoreAgainst(it, qNorm, qNo) };
    }).sort((a,b)=>b.score-a.score);

    const best = scored[0];
    if (!best) return { suggestion: null, score: 0 };
    const len = qNo.length;
    const th = len >= 8 ? 0.75 : len >= 5 ? 0.78 : 0.82;
    if (best.score >= th && normalizeThai(best.name) !== qNorm) {
      return { suggestion: best.name, score: Number(best.score.toFixed(3)) };
    }
    return { suggestion: null, score: Number(best?.score?.toFixed(3) || 0) };
  }

  // ------------------------------- endpoints -------------------------------

  // สำคัญ: ให้โหลด/รีบิลด์ดัชนีก่อนค้นทุกครั้ง (ถ้า dirty)
  router.get("/foods/search", (req, res) => {
    ensureIndex();

    const rawQ = String(req.query.q || "").trim();
    if (!rawQ) return res.json({ items: [], usedQuery: "", didYouMean: null });

    let rows = [];
    const likeRaw  = `%${rawQ}%`;
    const likeRawN = `%${noSpace(normalizeThai(rawQ))}%`;

    try { rows = _db.prepare(_meta.LIKE_SQL).all(likeRaw, likeRawN); } catch {}

    let used = rawQ;
    let suggestionPayload = null;

    if (rows.length < 1) {
      const { suggestion, score } = suggestName(rawQ);
      if (suggestion) {
        used = suggestion;
        suggestionPayload = { text: suggestion, confidence: score };
        const likeS  = `%${used}%`;
        const likeSN = `%${noSpace(normalizeThai(used))}%`;
        try { rows = _db.prepare(_meta.LIKE_SQL).all(likeS, likeSN); } catch {}
      }
    }

    if (rows.length < 2) {
      const qNorm = normalizeThai(used);
      const qNo   = noSpace(qNorm);
      const candIds = candidateIdsByNgram(qNo, 1500);
      const byId = new Map(_idx.map(x => [x.dbId, x]));
      const ranked = candIds.map(dbId => {
        const it = byId.get(dbId);
        return { dbId, name_th: it?.name || "", _score: scoreAgainst(it, qNorm, qNo) };
      }).sort((a,b)=>b._score-a._score).slice(0, 50);

      const stmt = _db.prepare(_meta.SELECT_BY_ID_SQL);
      rows = ranked.map(r => {
        let nut = {};
        try { const x = stmt.get(r.dbId); if (x) nut = x; } catch {}
        return { ...nut, id: r.dbId, name_th: nut?.name_th || r.name_th, score: Number(r._score.toFixed(3)) };
      });
    }

    const items = rows.map(r => ({
      id: r.id,
      name_th: r.name_th ?? null,
      name_en: r.name_en ?? null,
      calories: r.calories ?? null,
      protein: r.protein ?? null,
      fat: r.fat ?? null,
      carb: r.carb ?? null,
      serving: r.serving ?? null,
      score: r.score ?? null,
    }));

    res.json({ items, usedQuery: used, didYouMean: suggestionPayload });
  });

  router.get("/foods/nameth", (req, res) => {
    const search = String(req.query.search || "").trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = (page - 1) * limit;
    const where = search
      ? `WHERE ${_meta.NTH_COL} IS NOT NULL AND TRIM(${_meta.NTH_COL})!='' AND ${_meta.NTH_COL} LIKE @like`
      : `WHERE ${_meta.NTH_COL} IS NOT NULL AND TRIM(${_meta.NTH_COL})!=''`;

    const sql = `
      SELECT DISTINCT ${_meta.NTH_COL} AS name_th
      FROM ${_meta.TABLE}
      ${where}
      ORDER BY ${_meta.NTH_COL} COLLATE NOCASE ASC
      LIMIT @limit OFFSET @offset
    `;
    const countSql = `
      SELECT COUNT(*) AS cnt FROM (
        SELECT DISTINCT ${_meta.NTH_COL} AS name_th
        FROM ${_meta.TABLE}
        ${where}
      ) t
    `;
    try {
      const rows = _db.prepare(sql).all({ like: `%${search}%`, limit, offset });
      const total = _db.prepare(countSql).get({ like: `%${search}%` })?.cnt || 0;
      res.json({ items: rows.map(r => r.name_th), page, limit, total, hasMore: offset + rows.length < total });
    } catch (e) {
      res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
    }
  });

  router.get("/foods/nameth/all", (_req, res) => {
    try {
      const rows = _db.prepare(`
        SELECT DISTINCT ${_meta.NTH_COL} AS name_th
        FROM ${_meta.TABLE}
        WHERE ${_meta.NTH_COL} IS NOT NULL AND TRIM(${_meta.NTH_COL})!=''
        ORDER BY ${_meta.NTH_COL} COLLATE NOCASE ASC
      `).all();
      res.json({ items: rows.map(r => r.name_th), total: rows.length });
    } catch (e) {
      res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
    }
  });

  router.get("/foods/suggest", (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ suggestion: null, score: 0 });
    const { suggestion, score } = suggestName(q);
    res.json({ suggestion, score });
  });

  return router;
}
