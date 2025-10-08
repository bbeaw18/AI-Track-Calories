import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Button, Alert, Platform } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import * as SQLite from "expo-sqlite";          // API ใหม่ (async)
import * as FileSystem from "expo-file-system";  // ใช้ StorageAccessFramework (Android)
import AsyncStorage from "@react-native-async-storage/async-storage";

let _dbPromise = null;
function getDb() {
  if (!_dbPromise) _dbPromise = SQLite.openDatabaseAsync("MealRecord.sqlite");
  return _dbPromise;
}

async function ensureSchema() {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS meal_record (
      MealRecordID INTEGER PRIMARY KEY AUTOINCREMENT,
      UserID INTEGER NOT NULL,
      FoodID INTEGER NOT NULL,
      FoodImage TEXT,
      FoodQuantity REAL,
      MealType TEXT,
      Date TEXT NOT NULL,
      Time TEXT NOT NULL,
      EnergyKcal REAL,
      ProteinG REAL,
      FatG REAL,
      CarbohydrateG REAL,
      PortionMultiplier REAL DEFAULT 1,
      FoodName TEXT
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_meal_record_user_date
    ON meal_record (UserID, Date);
  `);
}

// อ่าน userId ปัจจุบันจาก AsyncStorage
async function getCurrentUserId() {
  const raw = await AsyncStorage.getItem("userId");
  const id = raw ? Number(raw) : NaN;
  if (!raw || !Number.isFinite(id)) throw new Error("no_user_id_in_storage");
  return id;
}

// แปลงวันนี้แบบ LOCAL
function todayLocal() {
  const d = new Date();
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
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
      const row = await udb.getFirstAsync(
        `SELECT UserID AS id FROM users WHERE Email = ? LIMIT 1`,
        [email]
      );
      if (row?.id) {
        await AsyncStorage.setItem("userId", String(row.id));
        return Number(row.id);
      }
    } catch (e) {
      console.log("[History] resolve user fallback error:", e?.message);
    }
  }
  throw new Error("no_user_id_in_storage");
}

export default function History() {
  const [items, setItems] = useState([]);
  const isFocused = useIsFocused();

  async function loadToday() {
    await ensureSchema();
    const db = await getDb();

    let userId;
try {
  userId = await resolveCurrentUserId();
} catch {
  console.log("[History] no_user_id_in_storage");
  setItems([]);
  // ถ้าอยาก force ให้ไปหน้า Login:
  // Alert.alert("ต้องล็อกอิน", "กรุณาเข้าสู่ระบบ", [{ text: "OK" }]);
  return;
}


    const today = todayLocal();
    console.log("[History] today ->", today, "userId ->", userId);

    const rows = await db.getAllAsync(
      `SELECT
         MealRecordID   AS id,
         Date           AS date,
         MealType       AS mealType,
         FoodName       AS name,
         FoodQuantity   AS quantity,
         EnergyKcal     AS kcal,
         ProteinG       AS protein,
         FatG           AS fat,
         CarbohydrateG  AS carb,
         FoodImage      AS image_uri
       FROM meal_record
       WHERE UserID = ? AND Date = ?
       ORDER BY Date DESC, Time DESC, MealRecordID DESC`,
      [userId, today]
    );
    console.log(`[History] rows today for user ${userId} ->`, rows?.length || 0);

    setItems(rows || []);
  }

  useEffect(() => {
    loadToday().catch((e) => console.log("history load error", e?.message));
  }, [isFocused]);

  // ---------- EXPORT HELPERS (ไม่ต้องใช้ expo-sharing) ----------
  async function pickDirAndroid() {
    const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted) throw new Error("ผู้ใช้ยกเลิกการเลือกโฟลเดอร์");
    return perm.directoryUri;
  }

  async function writeFileAndroid(directoryUri, filename, mime, content, isBase64 = false) {
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      directoryUri,
      filename,
      mime
    );
    await FileSystem.writeAsStringAsync(fileUri, content, {
      encoding: isBase64 ? FileSystem.EncodingType.Base64 : FileSystem.EncodingType.UTF8,
    });
    return fileUri;
  }

  // 1) EXPORT JSON (จาก meal_record)
  async function exportAsJSON() {
    try {
      await ensureSchema();
      const db = await getDb();
      const rows = await db.getAllAsync(`SELECT * FROM meal_record ORDER BY MealRecordID`);
      const json = JSON.stringify(rows, null, 2);

      if (Platform.OS === "android") {
        const dir = await pickDirAndroid();
        const filename = `MealRecord-${Date.now()}.json`;
        await writeFileAndroid(dir, filename, "application/json", json);
        Alert.alert("Exported", `บันทึกไฟล์ ${filename} แล้ว`);
      } else {
        const p = FileSystem.documentDirectory + `MealRecord-${Date.now()}.json`;
        await FileSystem.writeAsStringAsync(p, json);
        Alert.alert("Exported (iOS)", p);
      }
    } catch (e) {
      console.log("exportAsJSON error:", e?.message);
      Alert.alert("Export JSON Error", e?.message || "unknown");
    }
  }

  // 2) EXPORT CSV (จาก meal_record)
  async function exportAsCSV() {
    try {
      await ensureSchema();
      const db = await getDb();
      const rows = await db.getAllAsync(`SELECT * FROM meal_record ORDER BY MealRecordID`);

      const header = [
        "MealRecordID","UserID","FoodID","FoodName","FoodImage","FoodQuantity",
        "MealType","Date","Time",
        "EnergyKcal","ProteinG","FatG","CarbohydrateG","PortionMultiplier"
      ];
      const csv = [
        header.join(","),
        ...rows.map(r => header.map(k => {
          const v = r[k] ?? "";
          const s = String(v).replace(/"/g, '""');
          return `"${s}"`;
        }).join(","))
      ].join("\n");

      if (Platform.OS === "android") {
        const dir = await pickDirAndroid();
        const filename = `MealRecord-${Date.now()}.csv`;
        await writeFileAndroid(dir, filename, "text/csv", csv);
        Alert.alert("Exported", `บันทึกไฟล์ ${filename} แล้ว`);
      } else {
        const p = FileSystem.documentDirectory + `MealRecord-${Date.now()}.csv`;
        await FileSystem.writeAsStringAsync(p, csv);
        Alert.alert("Exported (iOS)", p);
      }
    } catch (e) {
      console.log("exportAsCSV error:", e?.message);
      Alert.alert("Export CSV Error", e?.message || "unknown");
    }
  }

  // 3) EXPORT SQL DUMP (สำหรับ meal_record)
  async function exportAsSQL() {
    try {
      await ensureSchema();
      const db = await getDb();
      const rows = await db.getAllAsync(`SELECT * FROM meal_record ORDER BY MealRecordID`);

      const createSQL = `
CREATE TABLE IF NOT EXISTS meal_record (
  MealRecordID INTEGER PRIMARY KEY AUTOINCREMENT,
  UserID INTEGER NOT NULL,
  FoodID INTEGER NOT NULL,
  FoodImage TEXT,
  FoodQuantity REAL,
  MealType TEXT,
  Date TEXT NOT NULL,
  Time TEXT NOT NULL,
  EnergyKcal REAL,
  ProteinG REAL,
  FatG REAL,
  CarbohydrateG REAL,
  PortionMultiplier REAL DEFAULT 1,
  FoodName TEXT
);
`.trim();

      const esc = (v) => {
        if (v === null || v === undefined) return "NULL";
        if (typeof v === "number") return isFinite(v) ? String(v) : "NULL";
        return `'${String(v).replace(/'/g, "''")}'`;
      };

      const inserts = rows.map(r => {
        return `INSERT INTO meal_record (MealRecordID,UserID,FoodID,FoodImage,FoodQuantity,MealType,Date,Time,EnergyKcal,ProteinG,FatG,CarbohydrateG,PortionMultiplier,FoodName) VALUES (${
          [
            esc(r.MealRecordID), esc(r.UserID), esc(r.FoodID), esc(r.FoodImage), esc(r.FoodQuantity),
            esc(r.MealType), esc(r.Date), esc(r.Time),
            esc(r.EnergyKcal), esc(r.ProteinG), esc(r.FatG), esc(r.CarbohydrateG),
            esc(r.PortionMultiplier), esc(r.FoodName)
          ].join(",")
        });`;
      }).join("\n");

      const content = `BEGIN TRANSACTION;\n${createSQL}\n${inserts}\nCOMMIT;`;

      if (Platform.OS === "android") {
        const dir = await pickDirAndroid();
        const filename = `MealRecord-${Date.now()}.sql`;
        await writeFileAndroid(dir, filename, "application/sql", content);
        Alert.alert("Exported", `บันทึกไฟล์ ${filename} แล้ว\nนำไป import ใน DB Browser for SQLite ได้`);
      } else {
        const p = FileSystem.documentDirectory + `MealRecord-${Date.now()}.sql`;
        await FileSystem.writeAsStringAsync(p, content);
        Alert.alert("Exported (iOS)", p);
      }
    } catch (e) {
      console.log("exportAsSQL error:", e?.message);
      Alert.alert("Export SQL Error", e?.message || "unknown");
    }
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      {/* ปุ่ม Export */}
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "space-between" }}>
        <Button title="EXPORT JSON" onPress={exportAsJSON} />
        <Button title="EXPORT CSV" onPress={exportAsCSV} />
        <Button title="EXPORT SQL" onPress={exportAsSQL} />
      </View>

      <FlatList
        style={{ marginTop: 12 }}
        data={items}
        keyExtractor={(it) => String(it.id)}
        renderItem={({ item }) => (
          <View style={{ padding: 12, borderBottomWidth: 1, borderColor: "#eee" }}>
            <Text>{item.date} • {item.mealType}</Text>
            {item.name ? <Text>{item.name}</Text> : null}
            <Text>{`kcal: ${item.kcal ?? 0} | P: ${item.protein ?? 0}g | F: ${item.fat ?? 0}g | C: ${item.carb ?? 0}g`}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: "center", color: "#999", marginTop: 24 }}>
            ยังไม่มีรายการวันนี้
          </Text>
        }
      />
    </View>
  );
}
