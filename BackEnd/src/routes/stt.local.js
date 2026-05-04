//backend/src/routes/stt.local
import express from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import Database from "better-sqlite3";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");

const PYTHON_EXEC = process.env.PYTHON_EXEC || "python";
const uploadsDir = path.join(backendRoot, "uploads");
await fs.mkdir(uploadsDir, { recursive: true }).catch(() => {});


const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(backendRoot, "../Database/NutritionFromScratch.sqlite");

const nfsDb = new Database(dbPath, { readonly: true });

 

function pickId(row) {
  return row.id ?? row.ID ?? row.FoodID ?? row.food_id ?? row.foodID ?? null;
}

function pickNameTH(row) {
  return String(row.NameTH ?? row.name_th ?? row.name ?? "").trim();
}


function toArabicDigits(s = "") {
  const map = { "๐":"0","๑":"1","๒":"2","๓":"3","๔":"4","๕":"5","๖":"6","๗":"7","๘":"8","๙":"9" };
  return s.replace(/[๐-๙]/g, ch => map[ch] ?? ch);
}

function normalizeThai(input = "") {
  const s = toArabicDigits(String(input ?? "").normalize("NFC"));
  const DIAC = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g;
  return s.replace(/\s+/g, "").replace(DIAC, "");
}

function tokenizeWords(s = "") {
  return String(s).trim().split(/\s+/).filter(Boolean);
}

function charBigrams(s = "") {
  const a = Array.from(s);
  const out = [];
  for (let i = 0; i < a.length - 1; i++) out.push(a[i] + a[i + 1]);
  return out;
}

function freqMap(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

function cosineSim(aStr, bStr) {
  const A = freqMap(charBigrams(aStr));
  const B = freqMap(charBigrams(bStr));
  if (A.size === 0 || B.size === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (const [k, va] of A) {
    const vb = B.get(k) || 0;
    dot += va * vb;
    na += va * va;
  }
  for (const [, vb] of B) nb += vb * vb;
  return dot === 0 ? 0 : (dot / (Math.sqrt(na) * Math.sqrt(nb)));
}

function jaccardWords(a = "", b = "") {
  const A = new Set(tokenizeWords(a));
  const B = new Set(tokenizeWords(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return inter / uni;
}

function levenshtein(a = "", b = "") {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      cur[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function levSim(a = "", b = "") {
  const L = Math.max(a.length, b.length) || 1;
  return 1 - (levenshtein(a, b) / L);
}


function compositeSimilarity(queryNorm, nameNorm, queryRaw, nameRaw) {
  const sLev = levSim(queryNorm, nameNorm);          
  const sCos = cosineSim(queryNorm, nameNorm);      
  const sJac = jaccardWords(queryRaw, nameRaw);      
  
  const score = (0.50 * sLev) + (0.35 * sCos) + (0.15 * sJac);
  
  const bonus = (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) ? 0.05 : 0;
  return Math.max(0, Math.min(1, score + bonus));
}


function fetchCandidates(db, kwRaw) {
  const like = `%${kwRaw}%`;
  let rows = [];
  
  const selects = [
    
    `SELECT FoodID AS id, NameTH, NameEng, EnergyKcal FROM foods WHERE NameTH LIKE ? LIMIT 300`,
    `SELECT FoodID AS id, NameTH, NameEng, EnergyKcal FROM FoodList WHERE NameTH LIKE ? LIMIT 300`,
    
    `SELECT id, NameTH, NameEng, EnergyKcal FROM foods WHERE NameTH LIKE ? LIMIT 300`,
  ];
  for (const sql of selects) {
    try {
      const part = db.prepare(sql).all(like);
      rows.push(...part);
    } catch {}
  }
  
  if (rows.length < 50) {
    const moreSQL = [
      `SELECT FoodID AS id, NameTH, NameEng, EnergyKcal FROM foods LIMIT 2000`,
      `SELECT FoodID AS id, NameTH, NameEng, EnergyKcal FROM FoodList LIMIT 2000`,
      `SELECT id, NameTH, NameEng, EnergyKcal FROM foods LIMIT 2000`,
    ];
    for (const sql of moreSQL) {
      try {
       const more = db.prepare(sql).all();
        rows.push(...more);
      } catch {}
    }
  }
  const uniq = new Map();
  for (const r of rows) {
    const key = pickId(r);
    if (key != null) uniq.set(String(key), r);
  }
  return [...uniq.values()];
}

function searchFoods(keyword, topN = 15) {
  if (!keyword) return [];
  const rawQ = String(keyword).trim();
  if (!rawQ) return [];

  const normQ = normalizeThai(rawQ);

  const candidates = fetchCandidates(nfsDb, rawQ);

  const scored = candidates.map((r) => {
    const nameTH = pickNameTH(r);
    const normName = normalizeThai(nameTH);
    const score = compositeSimilarity(normQ, normName, rawQ, nameTH);
    return { ...r, _score: score };
  });

  return scored
    .filter(it => it._score >= 0.30) 
    .sort((a, b) => b._score - a._score)
    .slice(0, topN)
    .map(({ _score, ...rest }) => ({ ...rest, score: Number(_score.toFixed(3)) }));
}

const upload = multer({ dest: uploadsDir });


router.post("/local", upload.single("audio"), async (req, res) => {
  console.log("[/stt/local] called");

  try {
    
    if (!req.file) {
      console.log("[/stt/local] no file received");
      return res.status(400).json({ error: "no_audio_file" });
    }

    const audioAbs = path.resolve(req.file.path);
    
    const scriptAbs = path.resolve(backendRoot, "../stt/whisper_transcribe.py");
    
    console.log("[/stt/local] audio:", audioAbs);
    console.log("[/stt/local] script:", scriptAbs);

    
    let prompt = "";
    try {
      const rows = nfsDb.prepare(`SELECT NameTH FROM foods LIMIT 400`).all();
      prompt = rows.map((r) => r.NameTH).filter(Boolean).slice(0, 300).join(" ");
      if (prompt.length > 3000) prompt = prompt.slice(0, 3000);
      console.log("[/stt/local] prompt length =", prompt.length);
    } catch (err) {
      console.log("[/stt/local] prompt gen error:", err);
    }

    const env = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      WHISPER_MODEL: process.env.WHISPER_MODEL || "small",  
      WHISPER_LANG: process.env.WHISPER_LANG || "th",
      WHISPER_TEMPERATURE: process.env.WHISPER_TEMPERATURE || "0",
      WHISPER_PROMPT: prompt,
    };

    const args = [scriptAbs, audioAbs];

    
    const child = spawn(PYTHON_EXEC, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let out = "";
    let err = "";

    
    child.stdout.on("data", (buf) => (out += buf.toString()));
    child.stderr.on("data", (buf) => (err += buf.toString()));


    child.on("error", async (e) => {
      await fs.unlink(audioAbs).catch(() => {});
      console.error("[/stt/local] spawn_failed:", e);
      return res.status(500).json({ error: "spawn_failed", detail: String(e) });
    });

    
    child.on("close", async (code) => {
      await fs.unlink(audioAbs).catch(() => {});
      console.log("[/stt/local] python exit:", code);

      if (code !== 0) {
        console.error("[/stt/local] Python error:", err);
        return res.status(500).json({ error: "py_failed", exitCode: code, stderr: err });
      }

      
      let text = "";
      try {
        const json = JSON.parse(out);
        text = (json?.text || "").trim();
      } catch {
        text = out.trim();
      }

      console.log("[/stt/local] text =", text);

      if (!text) return res.json({ text: "", items: [] });

      const rawItems = searchFoods(text);
const items = rawItems.map(it => ({
  id: pickId(it),
  NameTH: pickNameTH(it),
  NameEng: it.NameEng ?? it.name_en ?? null,
  EnergyKcal: it.EnergyKcal ?? it.calories ?? null,
  score: it.score ?? null,
}));

      res.json({ text, items });
    });
  } catch (e) {
    console.error("[/stt/local] top-level error:", e);
    return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
});


export default router;
