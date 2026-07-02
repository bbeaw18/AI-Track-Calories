# AI-Track-Cal

A Thai food calorie-tracking application. Users log meals by **photo** (a CNN identifies the Thai dish), by **voice** (speech-to-text + fuzzy food search), or by **manual entry**. The backend computes personalized calorie / macronutrient / water targets from the user's profile.

This README is written to help a reviewer understand, run, and audit the project.

---

## Objectives

1. **2.1** — Build a mobile application that lets users add food items by photo
   or by voice, and automatically estimate calories and nutrients.
2. **2.2** — Apply AI techniques (Deep Learning, food recognition) to analyze
   and classify Thai dishes.
3. **2.3** — Promote effective diet control, nutrition planning, and health
   tracking for users.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Mobile client | Expo SDK 54, React Native 0.81, React 19, React Navigation (native-stack) |
| API | Node.js (ESM), Express 5, `better-sqlite3` |
| Auth | JWT (7-day) + mandatory TOTP 2FA (`otplib`), bcrypt password hashing |
| Food image AI | Python, PyTorch, EfficientNet-B0 (50 Thai-dish classes) |
| Speech-to-text | Python, Whisper / faster-whisper |
| Storage | Multiple separate SQLite files (one per data domain) |

---

## Food image model (trained in-house)

The Thai-dish classifier is **trained by us**, not an off-the-shelf pretrained
classifier — we fine-tuned an ImageNet backbone on a Thai food dataset.

| Item | Detail |
|------|--------|
| Architecture | **EfficientNet-B0** (`torchvision`), ImageNet-pretrained backbone with the final classifier head replaced by a 50-class head |
| Task | Single-label classification of 50 Thai dishes (**THFOOD-50**, classes 50–99) |
| Dataset | **THFOOD-50** — 50 Thai food categories, **30,460 images** total, **stratified** split into Train **22,331** (73.31%) / Validation **8,129** (26.69%) |
| Training | Two-stage transfer learning: Stage 1 freezes the backbone and trains only the head; Stage 2 unfreezes ~70% of the backbone and fine-tunes at a lower LR |
| Recipe | AdamW, mixed-precision (AMP), label smoothing 0.05, `ReduceLROnPlateau`, early stopping (patience = 10); data augmentation (flip, rotation, color jitter, random-resized crop); 224×224 input, ImageNet normalization |
| Artifacts | Weights `AI/Model/best_model_thfood50.pth`; class map `AI/class_map_thfood50_min.csv` |
| Scripts | Train: `AI/Train/train_pt_50.py` · Inference: `AI/Test/infer.py` |

### Training results (Stage 2 — fine-tuning)

Best checkpoint reached at **Stage 2, epoch 46 / 60** (max), then **early
stopping** triggered after validation accuracy failed to improve for
`patience = 10` epochs.

| Metric | Value |
|--------|-------|
| Train accuracy | **0.9984** (≈ 99.84%) |
| Validation accuracy | **0.9556** (≈ 95.56%) |
| Best validation accuracy | **0.9558** (≈ 95.58%) |
| Validation loss | **0.5563** |

The gap between train (~99.8%) and validation (~95.6%) accuracy — with a low,
stable validation loss — indicates the model generalizes well without severe
overfitting. The fine-tuned EfficientNet-B0 classifies Thai dishes with ~95.6%
average validation accuracy: accurate and stable.

### Inference pipeline

When a user submits a photo, `AI/Test/infer.py` runs:

1. **Preprocessing** — resize to 224×224, normalize with ImageNet mean/std.
2. **Prediction** — the model produces per-class **logits**.
3. **Softmax** — logits are converted to a probability distribution (sums to 1).
4. **Top-K selection** — the **Top-5** classes are returned, with the rank-1
   class taken as the primary prediction (`{label, confidence}`).
5. **Nutrition lookup** — the predicted dish is joined against the nutrition
   database to surface energy (kcal), protein, fat, and carbohydrate.

---

## Repository structure

```
BackEnd/
  src/
    server.js              # the live API server (package.json "main")
    routes/
      recommend.js         # /recommend  — food list, table auto-detected
      foods.search.js      # /foods/search — in-memory Thai fuzzy index
      stt.local.js         # /stt/local — Whisper subprocess + food match
    services/calc.js       # BMR / TDEE / macros / water (single source of truth)
    utils/date.js          # Thailand-local date helper
  AI/
    Test/infer.py          # image -> {label, confidence} (one JSON line on stdout)
    Train/train_pt_50.py   # training script
    Model/                 # trained weights (best_model_thfood50.pth)
    class_map_thfood50_min.csv
  stt/whisper_transcribe.py # audio -> {text}
FrontEnd/
  App.js                   # boot: notifications, then mounts navigator
  src/
    nav/index.js           # native-stack navigator (initial route: Login)
    services/api.js         # axios instance + all API helpers (token via AsyncStorage)
    services/notification.js# water-reminder scheduling
    *.js                    # screens (Login, Home, UploadFood, History, …)
```

> **Not in the repository** (excluded for security / size): `BackEnd/.env`,
> all `*.sqlite` database files, Python virtualenvs, and `node_modules/`.
> A reviewer must supply these locally — see *Setup* below.

---

## Architecture notes

- **Single live entrypoint.** `BackEnd/src/server.js` contains the entire API
  (auth, meals, water, nutrition lookup, AI predict) and mounts the three
  routers. There is no separate controller layer.
- **Multi-database SQLite.** Instead of one database, the server opens separate
  files per domain, each in WAL mode:
  - `UserData.sqlite` — accounts, profile, TOTP secret
  - `NutritionFromScratch.sqlite` (**NFS**) — `foods` table; the canonical
    nutrition source used by search, recommend, STT matching, and meal auto-fill
  - `NutritionDB.sqlite` — legacy fallback only
  - `MealRecord.sqlite`, `WaterRecord.sqlite` — per-user logs
  - Directory casing is probed both ways (`Database/` and `DataBase/`).
- **Boot-time migrations.** Schema is created/migrated idempotently at server
  start via `CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE ADD COLUMN`
  (driven by `PRAGMA table_info`). Old DB files missing columns are upgraded
  in place.
- **Auth flow.** Registration and login are two-step: credentials first, then
  a TOTP code, before any 7-day JWT is issued. Password reset is also gated by
  TOTP through staged short-lived tokens.
- **Nutrition math** (`services/calc.js`): Mifflin–St Jeor BMR → TDEE via an
  activity factor snapped to `[1.2, 1.375, 1.55, 1.725, 1.9]` → ±300 kcal for
  lose/gain → macros (protein/fat per kg, carbs = remainder). Water target =
  `weight·0.033 L` + `0.2 L` per 30 min/day of exercise.
- **Python is invoked as a subprocess** (`spawn`/`spawnSync`). The Python
  scripts communicate **only via a single JSON line on stdout** — any stray
  print breaks the Node-side `JSON.parse`.

---

## Setup

### Prerequisites
- Node.js 18+
- Python 3.10+ with the inference / STT dependencies installed (PyTorch,
  torchvision, Pillow; `whisper` or `faster-whisper`). The project expects
  prebuilt virtualenvs under `BackEnd/AI/`.
- The SQLite database files (not committed). At minimum a populated
  `NutritionFromScratch.sqlite` is required for search / recommend / STT.
  `server.js` will create the empty user/meal/water databases on first run.

### Backend
```bash
cd BackEnd
npm install
# create BackEnd/.env (see below), place .sqlite files under BackEnd/DataBase/
npm run dev      # nodemon + watch
# or: npm start
```

`BackEnd/.env`:
```
PORT=5000
JWT_SECRET=<a long random string>
PYTHON_EXEC=<path to the python interpreter with the AI/STT deps>
USER_DB=DataBase/UserData.sqlite
```

### Frontend
```bash
cd FrontEnd
npm install
npm start        # Expo; or: npm run android / npm run web
```

The API base URL is read from `app.json` → `expo.extra.API_URL`
(default `http://10.0.2.2:5000`, i.e. the Android emulator). For a physical
device or web, set it to the machine's LAN IP.

There is **no automated test suite or linter**. Verification is manual:
server boot logs, endpoint responses (with a real `Bearer` token), the
`/healthz` and `/__debug/*` routes, and running the Python scripts directly
against samples in `AI/Pic-test/` and `stt/sample/`.

---

## Features & how to use

Navigation is a single stack starting at **Login**. After authentication the
app lands on **Home**, which has a bottom menu: Home · Recommend · History ·
Profile · Settings.

### 1. Sign up + 2FA enrolment
*Screens:* Register → Setup2FA. *Endpoints:* `POST /auth/register` →
`POST /auth/register/verify-2fa`.
1. On Login, tap **สมัครสมาชิก** (Sign up).
2. Fill display name, email, password, sex, weight, height, age, activity
   level, average exercise minutes/day, and goal (maintain / lose / gain).
3. Submit. The server creates the account and returns a TOTP QR code.
4. On Setup2FA, scan the QR with Google Authenticator (or similar) and enter
   the 6-digit code. On success a 7-day JWT is issued and you land on Home.

### 2. Login
*Screens:* Login → (TwoFA if 2FA on). *Endpoints:* `POST /auth/login` →
`POST /auth/2fa/check`.
1. Enter email + password, tap **เข้าสู่ระบบ**.
2. If 2FA is enabled, enter the 6-digit Authenticator code on the TwoFA
   screen. The token + `userId`/`userEmail` are stored in `AsyncStorage`.

### 3. Forgot / reset password (TOTP-gated)
*Screens:* ForgotPassword → VerifyResetOTP → ResetPassword.
*Endpoints:* `POST /auth/reset/request` → `/auth/reset/verify-otp` →
`/auth/reset/confirm`.
1. From Login tap **ลืมรหัสผ่าน?**, enter the account email.
2. Enter the current 6-digit TOTP code from the Authenticator app.
3. Set and confirm the new password.

### 4. Home dashboard
*Endpoints:* `GET /auth/me/nutrition`, `GET /meals`, `GET /water`,
`GET /auth/me/water`.
- Shows today's consumed vs. target calories, a 3-ring macro chart
  (protein / fat / carbs vs. target), per-meal-type totals, and a water
  tracker. Meals are kept in a local SQLite mirror and reconciled with the
  server on focus / app-resume / pull-to-refresh.

### 5. Log a meal by photo (AI)
*Screen:* UploadFood. *Endpoints:* `POST /ai/predict`,
`GET /foods/by-name-legacy`, `POST /nfs/foods/upsert`, `POST /meals`.
1. On Home, tap **+ เพิ่ม** on a meal type (breakfast / lunch / dinner / other).
2. Take a photo, pick from gallery, or pick from Drive.
3. Tap **วิเคราะห์ด้วย AI**. The dish name + confidence come back and
   nutrition fields auto-fill from the database.
4. Adjust quantity (g) / kcal / macros if needed, tap **บันทึก**.

### 6. Log a meal by voice
*Component:* VoiceFoodButton (inside UploadFood). *Endpoints:*
`POST /stt/local`, `GET /foods/search`.
1. In UploadFood tap the microphone, speak the dish name in Thai, tap again
   to stop.
2. The audio is transcribed and matched; pick one of the top candidates to
   fill the nutrition fields, then save.

### 7. Log a meal manually
*Screen:* UploadFood. Type the dish name, quantity and macros directly in the
form and tap **บันทึก** (no photo / voice required).

### 8. Recommended foods
*Screen:* Recommend. *Endpoints:* `GET /recommend`, `GET /nutrition`,
`POST /meals`.
1. Open **Recommend** from the bottom menu; browse or search the food list.
2. Tap **เพิ่ม** on an item, choose a meal type in the dialog — it is logged
   for today. The screen also shows your top foods of the day.

### 9. History
*Screen:* History. *Endpoints:* `GET /meals`, `DELETE /meals/:id`,
`GET /water`, `GET /auth/me/water`.
1. Open **History**; pick a date on the calendar to load that day's meals
   and water.
2. Tap the trash icon on an entry to delete it (removed on server + local
   mirror).

### 10. Weekly summary
*Screen:* WeeklySummary (via History → **ดูสรุปทั้งหมด**). *Endpoints:*
`GET /meals` (Mon–Sun), `GET /auth/me/nutrition`. Shows 7-day total energy
vs. target and a per-day breakdown with over/under status.

### 11. Profile & edit
*Screens:* Profile → EditProfile. *Endpoints:* `GET /auth/me`,
`PUT /auth/me`. View weight/height/age/sex/activity/goal; tap
**แก้ไขข้อมูล** to update. Changing weight or exercise minutes updates the
calorie/water targets used everywhere.

### 12. Settings — water reminder
*Screen:* Settings. Schedules repeating water-reminder notifications; when
the daily glass goal (derived from `GET /auth/me/water`) is reached, reminders
auto-cancel. On Expo Go a mock interval is used instead of OS notifications.

### 13. Water intake logging
On Home, tap the glass icons to set how many glasses you've had today (or
**reset to 0**). *Endpoint:* `PUT /water` (250 ml/glass).

---

## Code review notes

State of the codebase as reviewed:

**Cleaned up in this branch**
- Removed an unused parallel backend stack: `src/app.js`, `src/routes/auth.js`
  (also had a duplicate `import` that made it fail to parse), and `src/db.js`.
  These were never reachable from the live `server.js`.
- Removed obsolete / broken standalone files: `src/migrate_water.js`,
  `UploadPic/SavePic.js`.
- Removed a stale duplicate `FrontEnd/src/services/auth.js`, dead API helpers
  (`enableTwoFASetup`, `verifyTwoFASetup`, `checkTwoFA` — pointed at endpoints
  the server does not expose), and an unused `calc.js` export.
- Hardened the NFS database path resolution in `stt.local.js` to probe both
  `Database/` and `DataBase/` casings (behavior unchanged on Windows; now also
  correct on case-sensitive filesystems).

**Known limitations / things to look at**
- `POST /stt/local` is **not** behind the auth guard while `POST /ai/predict`
  is. The mobile client currently calls STT without a token, so adding the
  guard would be a breaking change — flagged, intentionally not changed.
- The login / 2FA responses omit `exercise_minutes_per_day` although
  `/auth/me` returns it — a minor response-shape inconsistency.
- `AI/Test/infer.py` loads the checkpoint with a `strict=False` fallback, so a
  class/head mismatch degrades accuracy silently instead of erroring.
- `FrontEnd/src/VoiceFoodSearch.js` still ships a debug screen as its default
  export; only the named `VoiceFoodButton` is used by the app. Left in place
  because it is entangled with the in-use button and never mounted.
- `Profile.js` reads `AsyncStorage.getItem("token")` (the app stores the JWT
  under `accessToken`) and passes it as an explicit header. It works only
  because the axios interceptor re-injects the correct token; the explicit
  header / key is dead and misleading.

**Security**
- `.env` and the SQLite files are excluded from the repository going forward.
  Note that if they were committed in earlier history, the secrets/data still
  exist in that history on the remote; rotating `JWT_SECRET` and purging
  history are recommended follow-ups outside this change.
- CORS is currently `origin: '*'` — restrict to known origins for production.
