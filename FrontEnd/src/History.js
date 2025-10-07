// FrontEnd/src/History.js
import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Button, Alert, Platform } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import * as SQLite from "expo-sqlite";          // API ใหม่ (async)
import * as FileSystem from "expo-file-system";  // ใช้ StorageAccessFramework (Android)

let _dbPromise = null;
function getDb() {
  if (!_dbPromise) _dbPromise = SQLite.openDatabaseAsync("MealRecord.sqlite");
  return _dbPromise;
}

async function ensureSchema() {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      mealType TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity REAL,
      unit TEXT,
      kcal REAL,
      protein REAL,
      fat REAL,
      carb REAL,
      image_uri TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

export default function History() {
  const [items, setItems] = useState([]);
  const today = new Date().toISOString().slice(0, 10);
  const isFocused = useIsFocused();

  async function loadToday() {
    await ensureSchema();
    const db = await getDb();
    const rows = await db.getAllAsync(
      `SELECT id, date, mealType, name, quantity, unit, kcal, protein, fat, carb, image_uri, created_at
       FROM meals
       WHERE date = ?
       ORDER BY created_at DESC, id DESC`,
      [today]
    );
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

  // 1) EXPORT JSON
  async function exportAsJSON() {
    try {
      await ensureSchema();
      const db = await getDb();
      const rows = await db.getAllAsync(`SELECT * FROM meals ORDER BY id`);
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

  // 2) EXPORT CSV
  async function exportAsCSV() {
    try {
      await ensureSchema();
      const db = await getDb();
      const rows = await db.getAllAsync(`SELECT * FROM meals ORDER BY id`);

      const header = [
        "id","date","mealType","name","quantity","unit",
        "kcal","protein","fat","carb","image_uri","created_at"
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

  // 3) EXPORT SQL DUMP (สร้าง DB เดิมได้)
  async function exportAsSQL() {
    try {
      await ensureSchema();
      const db = await getDb();
      const rows = await db.getAllAsync(`SELECT * FROM meals ORDER BY id`);

      // คำสั่งสำหรับ recreate ตาราง
      const createSQL = `
CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  mealType TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  kcal REAL,
  protein REAL,
  fat REAL,
  carb REAL,
  image_uri TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`;
      // INSERT rows
      const inserts = rows.map(r => {
        const esc = (v) => {
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return isFinite(v) ? String(v) : "NULL";
          return `'${String(v).replace(/'/g,"''")}'`;
        };
        return `INSERT INTO meals (id,date,mealType,name,quantity,unit,kcal,protein,fat,carb,image_uri,created_at) VALUES (${[
          esc(r.id), esc(r.date), esc(r.mealType), esc(r.name), esc(r.quantity), esc(r.unit),
          esc(r.kcal), esc(r.protein), esc(r.fat), esc(r.carb), esc(r.image_uri), esc(r.created_at)
        ].join(",")});`;
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
      {/* ปุ่ม Export (ไม่ต้องใช้ expo-sharing) */}
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
            <Text>{item.name}</Text>
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
