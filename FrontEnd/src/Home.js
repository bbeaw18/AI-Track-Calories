import React, { useCallback, useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl,
  ScrollView, ActivityIndicator, Alert, AppState, DeviceEventEmitter
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getMyNutrition, getWater, putWater, getMyProfile, getMeals, api } from "./services/api";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from "@react-navigation/native";
import { useWindowDimensions } from "react-native";
import * as SQLite from "expo-sqlite";
import Svg, { G, Circle, Defs, LinearGradient, Stop } from "react-native-svg";

/* ---------------- DB helper ---------------- */
let _dbPromise = null;
function getDb() {
  if (!_dbPromise) _dbPromise = SQLite.openDatabaseAsync("MealRecord.sqlite");
  return _dbPromise;
}
async function ensureTables() {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS meal_record (
      MealRecordID       INTEGER PRIMARY KEY AUTOINCREMENT,
      ServerMealID       INTEGER,
      UserID             INTEGER        NOT NULL,
      Date               TEXT           NOT NULL,
      Time               TEXT           NOT NULL,
      MealType           TEXT,
      FoodName           TEXT,
      EnergyKcal         REAL           DEFAULT 0,
      ProteinG           REAL           DEFAULT 0,
      FatG               REAL           DEFAULT 0,
      CarbohydrateG      REAL           DEFAULT 0,
      FoodID             INTEGER,
      FoodImage          TEXT,
      FoodQuantity       REAL,
      PortionMultiplier  REAL           DEFAULT 1
    );
  `);
  const cols = await db.getAllAsync(`PRAGMA table_info('meal_record')`);
  const have = new Set(cols.map(c => c.name));
  const alters = [];
  if (!have.has('ServerMealID'))      alters.push(`ALTER TABLE meal_record ADD COLUMN ServerMealID INTEGER;`);
  if (!have.has('FoodID'))            alters.push(`ALTER TABLE meal_record ADD COLUMN FoodID INTEGER;`);
  if (!have.has('FoodImage'))         alters.push(`ALTER TABLE meal_record ADD COLUMN FoodImage TEXT;`);
  if (!have.has('FoodQuantity'))      alters.push(`ALTER TABLE meal_record ADD COLUMN FoodQuantity REAL;`);
  if (!have.has('PortionMultiplier')) alters.push(`ALTER TABLE meal_record ADD COLUMN PortionMultiplier REAL DEFAULT 1;`);
  if (!have.has('FoodName'))          alters.push(`ALTER TABLE meal_record ADD COLUMN FoodName TEXT;`);
  if (!have.has('Time'))              alters.push(`ALTER TABLE meal_record ADD COLUMN Time TEXT NOT NULL DEFAULT '00:00:00';`);
  for (const sql of alters) await db.execAsync(sql);

  await db.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_meal_user_server
    ON meal_record (UserID, ServerMealID)
    WHERE ServerMealID IS NOT NULL;
  `);
}

function todayThailandISO() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const th = new Date(utc + 7 * 60 * 60 * 1000);
  const y = th.getFullYear();
  const m = String(th.getMonth() + 1).padStart(2, "0");
  const d = String(th.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function toISODateTH(input) {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const th = new Date(utc + 7 * 60 * 60 * 1000);
  const y = th.getFullYear();
  const m = String(th.getMonth() + 1).padStart(2, "0");
  const day = String(th.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ProgressBar = ({ progress }) => {
  const p = Math.min(progress, 100);
  const color = p < 60 ? "#10B981" : p <= 100 ? "#F59E0B" : "#DC2626";
  return (
    <View style={barStyles.container}>
      <View style={[barStyles.bar, { width: `${p}%`, backgroundColor: color }]} />
    </View>
  );
};
const barStyles = StyleSheet.create({
  container: { height: 10, backgroundColor: "#E5E7EB", borderRadius: 999, marginTop: 8, overflow: "hidden" },
  bar: { height: "100%", borderRadius: 999 },
});

export default function Home({ navigation }) {
  const [today, setToday] = useState(todayThailandISO());
  const { width } = useWindowDimensions();
  function refreshTodayIfChanged() {
    const now = todayThailandISO();
    if (now !== today) {
      console.log("[Home] day changed:", today, "->", now);
      setToday(now);
    }
  }

  const [water, setWater] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ date: today, kcal: 0, protein: 0, fat: 0, carb: 0 });
  const [meals, setMeals] = useState([
    { id: "breakfast", title: "มื้อเช้า", icon: "sunny", color: "#FFD580", kcal: 0 },
    { id: "lunch", title: "มื้อกลางวัน", icon: "fast-food", color: "#FFB347", kcal: 0 },
    { id: "dinner", title: "มื้อเย็น", icon: "moon", color: "#87CEFA", kcal: 0 },
    { id: "other", title: "มื้ออื่นๆ", icon: "ice-cream", color: "#C3B1E1", kcal: 0 },
  ]);
  const [nutri, setNutri] = useState(null);
  const [nutriLoading, setNutriLoading] = useState(false);
  const [nutriErr, setNutriErr] = useState(null);
  const [waterLoading, setWaterLoading] = useState(false);
  const [userName, setUserName] = useState(null);

  // 👉 NEW: Advice น้ำขั้นต่ำ–สูงสุด
  const [waterAdvice, setWaterAdvice] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getMyProfile();
        if (!mounted) return;
        const name = data?.displayName || data?.user?.displayName || data?.email || data?.user?.email || null;
        setUserName(name);
      } catch (e) {
        console.log('[Home] getMyProfile error', e?.message || e);
        if (mounted) setUserName(null);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function resolveCurrentUserId() {
    const raw = await AsyncStorage.getItem("userId");
    if (raw) {
      const id = Number(raw);
      if (Number.isFinite(id) && id > 0) return id;
    }
    const email = await AsyncStorage.getItem("userEmail");
    if (email) {
      try {
        const udb = await SQLite.openDatabaseAsync("UserData.sqlite");
        const row = await udb.getFirstAsync(`SELECT UserID AS id FROM users WHERE Email = ? LIMIT 1`, [email]);
        if (row?.id) {
          await AsyncStorage.setItem("userId", String(row.id));
          return Number(row.id);
        }
      } catch (e) {
        console.log("[Home] resolve user fallback error:", e?.message);
      }
    }
    throw new Error("no_user_id_in_storage");
  }

  async function dedupeTodayOnce(dayStr) {
    try {
      const key = `dedup_v2_done_${dayStr}`;
      if (await AsyncStorage.getItem(key)) return;
      const db = await SQLite.openDatabaseAsync("MealRecord.sqlite");
      await db.runAsync(`
        DELETE FROM meal_record
        WHERE Date = ? AND rowid NOT IN (
          SELECT MIN(rowid) FROM meal_record
          WHERE Date = ?
          GROUP BY UserID, Date, MealType, TRIM(LOWER(IFNULL(FoodName,''))), ROUND(IFNULL(EnergyKcal,0))
        )
      `, [dayStr, dayStr]);
      await AsyncStorage.setItem(key, '1');
      console.log('[Home] dedupeTodayOnce done');
    } catch (e) {
      console.log('[Home] dedupeTodayOnce error:', e?.message || e);
    }
  }

  const syncMealsFromServerToSQLite = useCallback(async () => {
    try {
      await ensureTables();
      const db = await getDb();
      const userId = await resolveCurrentUserId();

      let serverMeals = [];
      try {
        const res = await getMeals(today);
        serverMeals = Array.isArray(res) ? res : (res?.items || []);
      } catch {
        const res2 = await getMeals({ date: today });
        serverMeals = Array.isArray(res2) ? res2 : (res2?.items || []);
      }

      serverMeals = (serverMeals || []).filter(it => {
        const d = toISODateTH(it?.date ?? it?.Date ?? it?.mealDate ?? it?.created_at ?? it?.createdAt);
        return d === today;
      });

      const serverIds = serverMeals
        .map(it => Number(it.id ?? it.ID))
        .filter(id => Number.isFinite(id) && id > 0);

      const delByServerId = await db.prepareAsync(`DELETE FROM meal_record WHERE UserID = ? AND ServerMealID = ?`);
      const ins = await db.prepareAsync(`
        INSERT INTO meal_record
          (ServerMealID, UserID, Date, Time, MealType, FoodName,
           EnergyKcal, ProteinG, FatG, CarbohydrateG,
           FoodID, FoodImage, FoodQuantity, PortionMultiplier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      try {
        for (const it of serverMeals) {
          const serverId = Number(it.id ?? it.ID);
          if (!Number.isFinite(serverId) || serverId <= 0) continue;

          const dateRaw = it.date ?? it.Date ?? it.mealDate ?? it.created_at ?? it.createdAt ?? null;
          const date = toISODateTH(dateRaw);
          if (!date) continue;

          const time = it.time ?? it.Time ?? it.mealTime ?? "00:00:00";
          const mealType = (it.mealType ?? it.MealType ?? "other") || "other";
          const foodName = (it.foodName ?? it.FoodName ?? it.name ?? "") || "";

          const kcal = Number(it.kcal ?? it.energy_kcal ?? it.EnergyKcal ?? 0) || 0;
          const p    = Number(it.protein ?? it.ProteinG ?? 0) || 0;
          const f    = Number(it.fat     ?? it.FatG     ?? 0) || 0;
          const c    = Number(it.carb    ?? it.CarbohydrateG ?? 0) || 0;

          const foodIdNum = Number(it.food_id ?? it.FoodID);
          const foodId = Number.isFinite(foodIdNum) && foodIdNum > 0 ? foodIdNum : 0;

          const img = it.image ?? it.FoodImage ?? null;
          const qty = Number(it.quantity ?? it.FoodQuantity ?? 0) || 0;
          const portion = Number(it.portion ?? it.PortionMultiplier ?? 1) || 1;

          await delByServerId.executeAsync([userId, serverId]);
          await ins.executeAsync([
            serverId, userId, date, time, mealType, foodName,
            kcal, p, f, c, foodId, img, qty, portion
          ]);
        }
      } finally {
        try { await delByServerId.finalizeAsync(); } catch {}
        try { await ins.finalizeAsync(); } catch {}
      }

      if (serverIds.length > 0) {
        const placeholders = serverIds.map(() => '?').join(',');
        await db.runAsync(
          `DELETE FROM meal_record
           WHERE UserID = ? AND Date = ? AND ServerMealID IS NOT NULL
             AND ServerMealID NOT IN (${placeholders})`,
          [userId, today, ...serverIds]
        );
      } else {
        await db.runAsync(
          `DELETE FROM meal_record
           WHERE UserID = ? AND Date = ? AND ServerMealID IS NOT NULL`,
          [userId, today]
        );
      }

      await db.runAsync(
        `DELETE FROM meal_record AS local
           WHERE local.UserID = ? AND local.Date = ? AND local.ServerMealID IS NULL
             AND EXISTS (
               SELECT 1 FROM meal_record AS srv
               WHERE srv.UserID = ? AND srv.Date = ?
                 AND srv.ServerMealID IS NOT NULL
                 AND srv.MealType = local.MealType
                 AND TRIM(LOWER(srv.FoodName)) = TRIM(LOWER(local.FoodName))
                 AND ABS(IFNULL(srv.EnergyKcal,0) - IFNULL(local.EnergyKcal,0)) <= 1
             )`,
        [userId, today, userId, today]
      );

    } catch (e) {
      console.log('[Home] syncMealsFromServerToSQLite error:', e?.message || e);
    }
  }, [today]);

  const fetchMealsFromSQLite = useCallback(async () => {
    try {
      setLoading(true);
      const db = await getDb();

      let userId;
      try {
        userId = await resolveCurrentUserId();
      } catch {
        setSummary({ date: today, kcal: 0, protein: 0, fat: 0, carb: 0 });
        setMeals(m => m.map(x => ({ ...x, kcal: 0 })));
        return;
      }

      const rows = await db.getAllAsync(
        `SELECT MealType, SUM(EnergyKcal) AS totalKcal
         FROM meal_record
         WHERE UserID = ? AND Date = ?
         GROUP BY MealType`, [userId, today]
      );

      const sumRow = await db.getFirstAsync(
        `SELECT SUM(EnergyKcal) AS kcal,
                SUM(ProteinG) AS protein,
                SUM(FatG) AS fat,
                SUM(CarbohydrateG) AS carb
         FROM meal_record
         WHERE UserID = ? AND Date = ?`, [userId, today]
      );

      const noRowsToday = !rows || rows.length === 0;

      setSummary({
        date: today,
        kcal: noRowsToday ? 0 : Math.round(Number(sumRow?.kcal ?? 0)),
        protein: noRowsToday ? 0 : Math.round(Number(sumRow?.protein ?? 0)),
        fat: noRowsToday ? 0 : Math.round(Number(sumRow?.fat ?? 0)),
        carb: noRowsToday ? 0 : Math.round(Number(sumRow?.carb ?? 0)),
      });

      setMeals(m => m.map(x => {
        if (noRowsToday) return { ...x, kcal: 0 };
        const found = rows.find(r => r.MealType === x.id);
        return { ...x, kcal: Math.round(Number(found?.totalKcal ?? 0)) };
      }));
    } catch (e) {
      console.log("load from SQLite error:", e?.message);
    } finally {
      setLoading(false);
    }
  }, [today]);

  const fetchNutrition = useCallback(async () => {
    try {
      setNutriErr(null);
      setNutriLoading(true);
      const data = await getMyNutrition();
      setNutri(data);
    } catch (e) {
      setNutriErr(e?.response?.data?.error || e.message);
    } finally {
      setNutriLoading(false);
    }
  }, []);

  const fetchWater = useCallback(async () => {
    try {
      setWaterLoading(true);
      const w = await getWater(today);
      setWater(Number(w?.glasses ?? 0));
    } catch (e) {
      console.log("Fetch water error:", e?.response?.data || e.message);
    } finally {
      setWaterLoading(false);
    }
  }, [today]);

  // 👉 NEW: ดึงคำแนะนำการดื่มน้ำจาก /auth/me/water
  const fetchWaterAdvice = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me/water');
      setWaterAdvice(data || null);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'unknown';
      console.log('Fetch water advice error:', msg);
      setWaterAdvice(null);
    }
  }, []);

  useEffect(() => {
    const subIns = DeviceEventEmitter.addListener('MEAL_LOCAL_INSERTED', async () => {
      await fetchMealsFromSQLite();
    });
    const subDel = DeviceEventEmitter.addListener('MEAL_LOCAL_DELETED', async () => {
      await fetchMealsFromSQLite();
      await syncMealsFromServerToSQLite();
      await fetchMealsFromSQLite();
    });
    return () => { subIns.remove(); subDel.remove(); };
  }, [fetchMealsFromSQLite, syncMealsFromServerToSQLite]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      refreshTodayIfChanged();
      await ensureTables();
      await dedupeTodayOnce(today);
      await syncMealsFromServerToSQLite();
      if (!cancelled) {
        await fetchMealsFromSQLite();
        fetchNutrition();
        fetchWater();
        fetchWaterAdvice();
      }
    })();
    return () => { cancelled = true; };
  }, [today, syncMealsFromServerToSQLite, fetchMealsFromSQLite, fetchNutrition, fetchWater, fetchWaterAdvice]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active') {
        refreshTodayIfChanged();
        await syncMealsFromServerToSQLite();
        await fetchMealsFromSQLite();
        fetchNutrition();
        fetchWater();
        fetchWaterAdvice();
      }
    });
    return () => sub.remove();
  }, [today, syncMealsFromServerToSQLite, fetchMealsFromSQLite, fetchNutrition, fetchWater, fetchWaterAdvice]);

  const onSelectWater = async (glasses) => {
    const prev = water;
    setWater(glasses);
    try {
      await putWater({ date: today, glasses, mlPerGlass: 250 });
    } catch (e) {
      setWater(prev);
      Alert.alert("บันทึกน้ำไม่สำเร็จ", String(e?.response?.data?.error || e.message));
    }
  };

  const targetKcal = (() => {
    if (!nutri) return 0;
    const pG = nutri?.macros?.protein_g ?? 0;
    const fG = nutri?.macros?.fat_g ?? 0;
    const cG = nutri?.macros?.carbs_g ?? 0;
    const proteinKcal = pG * 4;
    const fatKcal = fG * 9;
    const carbsKcal = cG * 4;
    return Math.round(nutri?.energy?.target_calories_kcal ?? proteinKcal + fatKcal + carbsKcal);
  })();
  const kcalProgress = targetKcal > 0 ? (summary.kcal / targetKcal) * 100 : 0;
  const donutSize = Math.min(width - 40, 300);

  const R_OUT = (donutSize ?? Math.min(width - 40, 300)) * 0.42;
  const GAP = 12;
  const STROKE = 12;
  const RINGS_LAYOUT = [
    { label: "โปรตีน", radius: R_OUT },
    { label: "ไขมัน",  radius: R_OUT - (STROKE + GAP) },
    { label: "คาร์บ",  radius: R_OUT - 2*(STROKE + GAP) },
  ];
  const rings = (() => {
    const cP = (summary.protein || 0) * 4;
    const cF = (summary.fat || 0) * 9;
    const cC = (summary.carb || 0) * 4;

    const tP = (nutri?.macros?.protein_g ?? 0) * 4;
    const tF = (nutri?.macros?.fat_g ?? 0) * 9;
    const tC = (nutri?.macros?.carbs_g ?? 0) * 4;

    const pct = (consumed, target) => target > 0 ? consumed / target : 0;

    return [
      { key: "โปรตีน", consumedKcal: cP, targetKcal: tP, pct: pct(cP, tP), colorGrad: ["#6366F1","#818CF8"], track: "#EEF2FF", grams: summary.protein, gramsTarget: nutri?.macros?.protein_g ?? 0 },
      { key: "ไขมัน",  consumedKcal: cF, targetKcal: tF, pct: pct(cF, tF), colorGrad: ["#F59E0B","#FBBF24"], track: "#FFF7ED", grams: summary.fat,     gramsTarget: nutri?.macros?.fat_g ?? 0 },
      { key: "คาร์บ",  consumedKcal: cC, targetKcal: tC, pct: pct(cC, tC), colorGrad: ["#10B981","#34D399"], track: "#ECFDF5", grams: summary.carb,    gramsTarget: nutri?.macros?.carbs_g ?? 0 },
    ];
  })();
  const legendItems = rings.map(r => ({
    name: r.key,
    percent: Math.round(Math.min(r.pct, 1) * 100),
    grams: r.grams,
    gramsTarget: r.gramsTarget
  }));

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        refreshControl={
          <RefreshControl
            refreshing={loading || nutriLoading || waterLoading}
            onRefresh={async () => {
              refreshTodayIfChanged();
              await syncMealsFromServerToSQLite();
              await fetchMealsFromSQLite();
              fetchNutrition();
              fetchWater();
              fetchWaterAdvice();
            }}
          />
        }
      >
        {/* Header */}
        <View style={styles.headerWrap}>
          <View style={styles.headerLeft}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person-circle-outline" size={30} color="#1F2937" />
            </View>
            <View>
              <Text style={styles.headerHello}>
                {userName ? `สวัสดี ${userName} 👋` : "สวัสดี 👋"}
              </Text>
              <Text style={styles.headerDate}>วันนี้ {summary.date}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.badge}>
              <Ionicons name="calendar-outline" size={14} color="#2563EB" />
              <Text style={styles.badgeText}>Track ต่อเนื่อง</Text>
            </View>
          </View>
        </View>

        <View style={styles.cardBox}>
          <Text style={styles.sectionTitle}>🎯 สรุปแคลอรีวันนี้</Text>

          <View style={styles.summaryRow}>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryKcalConsumed}>{summary.kcal.toLocaleString()}</Text>
              <Text style={styles.summaryLabel}>Kcal ที่กินไปแล้ว</Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={styles.summaryKcalTarget}>/ {targetKcal.toLocaleString()}</Text>
              <Text style={styles.summaryLabel}>Kcal เป้าหมาย</Text>
            </View>
          </View>

          <ProgressBar progress={kcalProgress} />
          <Text style={styles.progressNote}>
            {targetKcal === 0 ? "ยังไม่มีเป้าหมายแคลอรี"
              : summary.kcal > targetKcal ? `เกินเป้าหมายไป ${(summary.kcal - targetKcal).toLocaleString()} kcal`
              : `เหลืออีก ${Math.max(0, targetKcal - summary.kcal).toLocaleString()} kcal`}
          </Text>

          <View style={{ marginTop: 16 }}>
            <Text style={styles.sectionTitle}>สัดส่วน Macro (เทียบเป้าหมาย)</Text>

            {nutriLoading && !nutri ? (
              <View style={styles.centerRow}><ActivityIndicator /><Text style={{ marginLeft: 8 }}>กำลังโหลด...</Text></View>
            ) : nutriErr ? (
              <Text style={styles.err}>โหลดโภชนาการไม่สำเร็จ: {String(nutriErr)}</Text>
            ) : nutri ? (
              <View style={styles.donutWrap}>
                <Svg width={donutSize} height={donutSize} style={{ alignSelf: "center" }}>
                  <Defs>
                    <LinearGradient id="gradProtein" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor="#6366F1" /><Stop offset="1" stopColor="#818CF8" />
                    </LinearGradient>
                    <LinearGradient id="gradFat" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor="#F59E0B" /><Stop offset="1" stopColor="#FBBF24" />
                    </LinearGradient>
                    <LinearGradient id="gradCarb" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor="#10B981" /><Stop offset="1" stopColor="#34D399" />
                    </LinearGradient>
                  </Defs>

                  <G x={donutSize / 2} y={donutSize / 2} rotation={-90}>
                    {RINGS_LAYOUT.map((ring, idx) => {
                      const track =
                        ring.label === "โปรตีน" ? "#EEF2FF"
                        : ring.label === "ไขมัน" ? "#FFF7ED"
                        : "#ECFDF5";
                      return (
                        <Circle key={`track-${idx}`} cx={0} cy={0} r={ring.radius}
                          stroke={track} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
                      );
                    })}
                    {RINGS_LAYOUT.map((ring, idx) => {
                      const data = rings.find(r => r.key === ring.label);
                      if (!data) return null;
                      const C = 2 * Math.PI * ring.radius;
                      const pct = data.pct;
                      const mainPct = Math.min(pct, 1);
                      const overflow = Math.max(0, pct - 1);
                      const gradId =
                        data.key === "โปรตีน" ? "url(#gradProtein)"
                        : data.key === "ไขมัน" ? "url(#gradFat)"
                        : "url(#gradCarb)";
                      const dashMain = [mainPct * C, (1 - mainPct) * C];
                      const dashOver = [Math.min(overflow, 0.6) * C, (1 - Math.min(overflow, 0.6)) * C];
                      return (
                        <React.Fragment key={`ring-${idx}`}>
                          <Circle cx={0} cy={0} r={ring.radius}
                            stroke={gradId} strokeWidth={STROKE}
                            strokeDasharray={dashMain.join(",")}
                            strokeLinecap="round" fill="none" />
                          {overflow > 0 && (
                            <Circle cx={0} cy={0} r={ring.radius}
                              stroke="#EF4444" strokeWidth={STROKE * 0.66}
                              strokeDasharray={dashOver.join(",")}
                              strokeLinecap="round" fill="none" />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </G>
                </Svg>

                <View style={styles.donutCenter}>
                  <Text style={styles.centerKcal}>{summary.kcal.toLocaleString()}</Text>
                  <Text style={styles.centerLabel}>kcal วันนี้</Text>
                  {targetKcal > 0 && <Text style={styles.centerSub}>จาก {targetKcal.toLocaleString()}</Text>}
                </View>

                <View style={styles.legendRow}>
                  {legendItems.map((i) => (
                    <View key={`pct-${i.name}`} style={styles.legendChip}>
                      <View style={[styles.legendDot, {
                        backgroundColor: i.name === "โปรตีน" ? "#6366F1" : i.name === "ไขมัน" ? "#F59E0B" : "#10B981"
                      }]} />
                      <Text style={styles.legendText}>{i.name} {i.percent}%</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.legendRow}>
                  {legendItems.map((i) => (
                    <View key={`g-${i.name}`} style={styles.legendChip}>
                      <View style={[styles.legendDot, {
                        backgroundColor: i.name === "โปรตีน" ? "#6366F1" : i.name === "ไขมัน" ? "#F59E0B" : "#10B981"
                      }]} />
                      <Text style={styles.legendText}>
                        {i.name} {i.grams} g / {i.gramsTarget} g
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={{ marginTop: 6 }}>ยังไม่มีข้อมูลโภชนาการ</Text>
            )}
          </View>
        </View>

        <Text style={styles.subText}>บันทึกมื้ออาหาร</Text>

        <FlatList
          data={meals}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: item.color }]}>
              <Ionicons name={item.icon} size={28} color="#333" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text>รวม: {item.kcal.toLocaleString()} kcal</Text>
              </View>
              <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate("UploadFood", { mealType: item.id })}>
                <Text style={{ color: "#fff" }}>+ เพิ่ม</Text>
              </TouchableOpacity>
            </View>
          )}
        />

        {/* น้ำดื่ม (UI เท่านั้น, logic เดิม) */}
        <View style={styles.waterBox}>
          <Text style={styles.waterTitle}>การดื่มน้ำ 💧</Text>

          {(() => {
            const GLASS_ML = 250;
            const totalGlasses = waterAdvice
              ? Math.min(20, Math.max(8, Math.ceil((waterAdvice.max_l_per_day * 1000) / GLASS_ML)))
              : 8;

            const pct = totalGlasses > 0 ? Math.min(1, water / totalGlasses) : 0;

            return (
              <>
                <View style={styles.waterTopRow}>
                  <Text style={styles.waterText}>
                    วันนี้ดื่มแล้ว <Text style={styles.waterStrong}>{water}</Text> / {totalGlasses} แก้ว
                  </Text>

                  {waterAdvice && (
                    <View style={styles.tipChip}>
                      <Ionicons name="bulb-outline" size={14} color="#1E40AF" />
                      <Text style={styles.tipChipText}>
                        {waterAdvice.min_l_per_day}–{waterAdvice.max_l_per_day} L/วัน
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.waterProgressTrack}>
                  <View style={[styles.waterProgressFill, { width: `${pct * 100}%` }]} />
                </View>
                <Text style={styles.waterProgressNote}>
                  {pct >= 1 ? "🎉 ครบตามเป้าสูงสุดแล้ว!" : `เหลืออีก ${(totalGlasses - water) > 0 ? (totalGlasses - water) : 0} แก้ว`}
                </Text>

                <View style={styles.waterRow}>
                  {[...Array(totalGlasses)].map((_, i) => (
                    <TouchableOpacity
                      key={i}
                      onPress={() => onSelectWater(i + 1)}
                      style={[
                        styles.glass,
                        i < water ? styles.glassOn : styles.glassOff
                      ]}
                      activeOpacity={0.8}
                    />
                  ))}
                </View>

                <View style={{ marginTop: 10 }}>
                  <TouchableOpacity
                    onPress={() => onSelectWater(0)}
                    style={[styles.addBtn, { backgroundColor: "#6B7280", alignSelf: "flex-start" }]}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="refresh" size={16} color="#fff" />
                    <Text style={{ color: "#fff", marginLeft: 6 }}>รีเซ็ตเป็น 0 แก้ว</Text>
                  </TouchableOpacity>
                </View>
              </>
            );
          })()}
        </View>

      </ScrollView>

      <View style={styles.bottomMenu}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Home")}>
          <Ionicons name="home" size={24} color="#4F46E5" />
          <Text style={[styles.menuText, { color: "#4F46E5", fontWeight: "bold" }]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Recommend")}>
          <Ionicons name="star" size={24} color="#333" />
          <Text style={styles.menuText}>Recommend</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("History")}>
          <Ionicons name="list" size={24} color="#333" />
          <Text style={styles.menuText}>ประวัติการกิน</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Profile")}>
          <Ionicons name="person" size={24} color="#333" />
          <Text style={styles.menuText}>ผู้ใช้</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Setting")}>
          <Ionicons name="settings" size={24} color="#333" />
          <Text style={styles.menuText}>ตั้งค่า</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff", paddingBottom: 80 },
  scrollBody: { paddingBottom: 140 },
  cardBox: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8, color: "#111827" },
  subtitle: { marginTop: 4, color: "#555" },
  centerRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  err: { color: "red", marginTop: 6 },

  summaryRow: { flexDirection: "row", justifyContent: "center", alignItems: "flex-end", marginBottom: 6 },
  summaryCol: { alignItems: "center", paddingHorizontal: 10 },
  summaryKcalConsumed: { fontSize: 48, fontWeight: "800", color: "#111827" },
  summaryKcalTarget: { fontSize: 28, fontWeight: "600", color: "#9CA3AF", marginBottom: 6 },
  summaryLabel: { fontSize: 14, color: "#6B7280", marginTop: -6 },
  progressNote: { marginTop: 6, color: "#6B7280", fontSize: 13, textAlign: "right" },

  donutWrap: { alignItems: "center", justifyContent: "center" },
  donutCenter: {
    position: "absolute",
    alignSelf: "center",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 12,
  },
  centerKcal: { fontSize: 26, fontWeight: "800", color: "#111827" },
  centerLabel: { fontSize: 12, color: "#6B7280", marginTop: -2 },
  centerSub: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },

  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 10 },
  legendChip: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#FFF",
  },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendText: { fontSize: 13, color: "#111827" },

  greet: { fontSize: 24, fontWeight: "bold", marginBottom: 2, color: "#111827" },
  subText: { color: "#6B7280", marginBottom: 15, fontSize: 16 },

  card: { flexDirection: "row", alignItems: "center", padding: 15, borderRadius: 14, marginBottom: 10 },
  cardTitle: { fontSize: 18, fontWeight: "600", color: "#111827" },
  addBtn: { backgroundColor: "#111827", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, flexDirection: "row", alignItems: "center" },

  waterBox: {
    marginTop: 20, marginBottom: 10, padding: 20,
    backgroundColor: "#f8fafc", borderRadius: 16, borderWidth: 1, borderColor: "#eef2f7",
  },
  waterTitle: { fontSize: 18, fontWeight: "bold", color: "#111827" },
  waterText: { marginVertical: 8, fontSize: 16, color: "#111827" },
  waterRow: { flexDirection: "row", flexWrap: "wrap" },
  glass: { width: 30, height: 50, borderRadius: 6, margin: 4 },
  glassOn: { backgroundColor: "#00BFFF" },
  glassOff: { backgroundColor: "#E5E7EB" },

  /* ---------- Header UI (ใหม่) ---------- */
  headerWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatarCircle: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: "#F3F4F6",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#E5E7EB",
  },
  headerHello: { fontSize: 18, fontWeight: "800", color: "#111827" },
  headerDate: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  headerRight: { alignItems: "flex-end" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EFF6FF",
    borderColor: "#DBEAFE",
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  badgeText: { color: "#2563EB", fontWeight: "700", fontSize: 12 },

  /* ---------- Water progress (ใหม่) ---------- */
  waterTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  waterStrong: { fontWeight: "800", color: "#0F172A" },
  tipChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#E0EAFF",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tipChipText: { color: "#1E40AF", fontWeight: "700", fontSize: 12 },

  waterProgressTrack: {
    height: 10,
    backgroundColor: "#E5E7EB",
    borderRadius: 999,
    marginTop: 10,
    overflow: "hidden",
  },
  waterProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#3B82F6",
  },
  waterProgressNote: {
    marginTop: 6,
    color: "#6B7280",
    fontSize: 12,
    textAlign: "right",
  },

  bottomMenu: {
    flexDirection: "row", justifyContent: "space-around", alignItems: "center",
    paddingVertical: 10, borderTopWidth: 1, borderColor: "#eee", backgroundColor: "#fafafa",
    position: "absolute", left: 0, right: 0, bottom: 0,
  },
  menuBtn: { alignItems: "center", flex: 1 },
  menuText: { fontSize: 12, color: "#333", marginTop: 2 },
});
