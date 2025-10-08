import React, { useEffect, useState } from "react";
import { View, Text, Button, Image, TextInput, StyleSheet, Alert, ActivityIndicator, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SQLite from "expo-sqlite"; // API ใหม่ (async)
import { api, getNutritionByName, setAuthToken } from "./services/api";

// ---------- SQLite helpers (API ใหม่) ----------
let _dbPromise = null;
function getDb() {
  if (!_dbPromise) _dbPromise = SQLite.openDatabaseAsync("MealRecord.sqlite");
  return _dbPromise;
}

// แปลง string -> number อย่างปลอดภัย (ตัดหน่วยเช่น "kcal", "g")
function n(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const cleaned = String(v).trim().replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return isFinite(num) ? num : null;
}

// ---- DEBUG HELPERS -------------------------------------------------
async function debugLogDbInfo(where = "") {
  try {
    const db = await getDb();
    const list = await db.getAllAsync(`PRAGMA database_list`);
    const path = list?.[0]?.file || "(unknown path)";
    console.log(`[DB] (${where}) database_list ->`, list);
    console.log(`[DB] (${where}) path -> ${path}`);
    const tables = await db.getAllAsync(`SELECT name FROM sqlite_master WHERE type='table'`);
    console.log(`[DB] (${where}) tables ->`, tables?.map(t => t.name));
    const cols = await db.getAllAsync(`PRAGMA table_info('meal_record')`);
    console.log(`[DB] (${where}) meal_record columns ->`, cols);
  } catch (e) {
    console.log(`[DB] debugLogDbInfo error (${where}):`, e?.message);
  }
}

// ---------- สร้าง/อัปสคีม่า ----------
async function ensureSchema() {
  const db = await getDb();

  // ตารางหลักที่ใช้จริง
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS meal_record (
      MealRecordID INTEGER PRIMARY KEY AUTOINCREMENT,
      UserID INTEGER NOT NULL,
      FoodID INTEGER NOT NULL,
      FoodImage TEXT,
      FoodQuantity REAL,
      MealType TEXT,
      Date TEXT NOT NULL,      -- YYYY-MM-DD (LOCAL)
      Time TEXT NOT NULL,      -- HH:MM:SS (LOCAL)
      EnergyKcal REAL,
      ProteinG REAL,
      FatG REAL,
      CarbohydrateG REAL,
      PortionMultiplier REAL DEFAULT 1
    );
  `);

  // Migration: เพิ่ม FoodName ถ้ายังไม่มี
  const cols = await db.getAllAsync(`PRAGMA table_info('meal_record')`);
  const have = new Set(cols.map(c => c.name));
  const alters = [];
  if (!have.has("PortionMultiplier")) alters.push(`ALTER TABLE meal_record ADD COLUMN PortionMultiplier REAL DEFAULT 1;`);
  if (!have.has("FoodName")) alters.push(`ALTER TABLE meal_record ADD COLUMN FoodName TEXT;`);
  for (const sql of alters) await db.execAsync(sql);

  await debugLogDbInfo("ensureSchema");
}

// ---------- utils ----------
function guessMimeFromName(name = "") {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".heic")) return "image/heic";
  if (n.endsWith(".heif")) return "image/heif";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}

// แปลง content:// เป็นไฟล์ใน cache (file://)
async function ensureFileUri(uri, preferredName = `upload_${Date.now()}.jpg`) {
  if (!uri) return null;
  if (uri.startsWith("file://")) return uri;
  try {
    const target = FileSystem.cacheDirectory + preferredName;
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
    return target;
  } catch (e) {
    console.log("ensureFileUri error:", e?.message);
    return uri; // fallback
  }
}

// หา userId ปัจจุบันด้วย 2 ชั้น: AsyncStorage -> UserData.sqlite (จากอีเมล)
async function resolveCurrentUserId() {
  // 1) ลองจาก AsyncStorage ก่อน
  const raw = await AsyncStorage.getItem("userId");
  if (raw) {
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) return id;
  }

  // 2) ลองจาก userEmail + UserData.sqlite
  const email = await AsyncStorage.getItem("userEmail");
  if (email) {
    try {
      const udb = await SQLite.openDatabaseAsync("UserData.sqlite");
      // ปรับชื่อตาราง/คอลัมน์ตรงนี้ให้ตรงกับ DB ของคุณถ้าไม่ใช่ users/Email/UserID
      const row = await udb.getFirstAsync(
        `SELECT UserID AS id FROM users WHERE Email = ? LIMIT 1`,
        [email]
      );
      if (row?.id) {
        await AsyncStorage.setItem("userId", String(row.id)); // cache ไว้
        return Number(row.id);
      }
    } catch (e) {
      console.log("[resolveCurrentUserId] fallback UserData error:", e?.message);
    }
  }

  // 3) ไม่เจอจริง ๆ
  throw new Error("no_user_id_in_storage");
}


export default function UploadFood({ navigation, route }) {
  const mealType = route?.params?.mealType || "other";

  const [imageUri, setImageUri] = useState(null);
  const [fileMeta, setFileMeta] = useState(null); // {name,type}
  const [predName, setPredName] = useState("");
  const [conf, setConf] = useState(null);
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");
  const [carb, setCarb] = useState("");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);

  const API_URL =
    Constants.expoConfig?.extra?.API_URL ||
    process.env.EXPO_PUBLIC_API_URL ||
    (Platform.OS === "android" ? "http://10.0.2.2:5000" : "http://localhost:5000");

  // ---------- auth helper ----------
  async function ensureAuth() {
    const token = await AsyncStorage.getItem("accessToken");
    if (!token) {
      Alert.alert("ต้องล็อกอิน", "กรุณาเข้าสู่ระบบอีกครั้ง", [
        { text: "ไปหน้า Login", onPress: () => navigation.navigate("Login") },
      ]);
      throw new Error("no_token_in_storage");
    }
    setAuthToken(token);
    return token;
  }

  // ---------- health check & ensure schema ----------
  useEffect(() => {
    (async () => {
      try {
        await ensureAuth();
        const r = await api.get("/healthz");
        console.log("healthz =>", r.data);
      } catch (e) {
        console.log("healthz error =>", e.message);
      } finally {
        try {
          await ensureSchema(); // เตรียมตาราง/คอลัมน์
        } catch (err) {
          console.log("ensureSchema error =>", err?.message);
        }
      }
    })();
  }, []);

  // ---------- pickers ----------
  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!res.canceled) {
      const uri = res.assets[0].uri; // file://
      const name = uri.split("/").pop() || `gallery_${Date.now()}.jpg`;
      setImageUri(uri);
      setFileMeta({ name, type: guessMimeFromName(name) });
    }
  }

  async function takePhoto() {
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!res.canceled) {
      const uri = res.assets[0].uri;
      const name = uri.split("/").pop() || `camera_${Date.now()}.jpg`;
      setImageUri(uri);
      setFileMeta({ name, type: guessMimeFromName(name) });
    }
  }

  async function pickFromDrive() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["image/*"],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;

      const asset = Array.isArray(res.assets) ? res.assets[0] : res;
      const rawUri = asset.fileCopyUri || asset.uri;
      const name = asset.name || `drive_${Date.now()}.jpg`;
      const type = asset.mimeType || guessMimeFromName(name);

      setImageUri(rawUri);
      setFileMeta({ name, type });
    } catch (e) {
      Alert.alert("Drive Error", e.message);
    }
  }

  // แนบรูปลง FormData (ใช้ตอน predict)
  async function appendImageToFormData(fd) {
    if (!imageUri) return;
    const name = fileMeta?.name || imageUri.split("/").pop() || `photo_${Date.now()}.jpg`;
    const type = fileMeta?.type || guessMimeFromName(name);
    const safeUri = await ensureFileUri(imageUri, name);
    fd.append("image", { uri: safeUri, name, type: type || "image/jpeg" });
  }

  // ---------- actions ----------
  async function onPredict() {
    if (!imageUri) return Alert.alert("เลือกรูปก่อน");
    try {
      const token = await ensureAuth();
      setLoading(true);

      const fd = new FormData();
      await appendImageToFormData(fd);

      const res = await fetch(`${API_URL}/ai/predict`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      let data;
      try { data = JSON.parse(text); } catch { throw new Error(text); }

      const { label, confidence } = data;
      setPredName(label || "");
      setConf(confidence ?? null);

      if (label) {
        try {
          const nut = await getNutritionByName(label);
          if (nut) {
            setKcal(nut.kcal?.toString() ?? "");
            setProtein(nut.protein?.toString() ?? "");
            setFat(nut.fat?.toString() ?? "");
            setCarb(nut.carb?.toString() ?? "");
          }
        } catch (e) {
          console.log("nutrition error", e?.response?.data || e.message);
        }
      }
    } catch (e) {
      console.log("predict error", e?.message);
      Alert.alert("Predict Error", e?.message || "Network Error");
    } finally {
      setLoading(false);
    }
  }

  async function onSave() {
    if (!predName) return Alert.alert("ยังไม่ทราบชื่อเมนู");
    try {
      setLoading(true);
      await ensureSchema();                 // สร้าง + log schema
      const db = await getDb();

      // --- วันที่/เวลาแบบ LOCAL (เลี่ยง toISOString) ---
      const now = new Date();
      const pad = (x) => (x < 10 ? `0${x}` : `${x}`);
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const userId  = await resolveCurrentUserId();


      const foodId  = 1;  // TODO: map จาก master foods/NutritionDB
      const portion = 1;

      const payload = {
        UserID: userId,
        FoodID: foodId,
        FoodImage: imageUri || null,
        FoodQuantity: n(quantity) ?? 0,
        MealType: mealType,
        Date: dateStr,
        Time: timeStr,
        EnergyKcal: n(kcal) ?? 0,
        ProteinG: n(protein) ?? 0,
        FatG: n(fat) ?? 0,
        CarbohydrateG: n(carb) ?? 0,
        PortionMultiplier: portion,
        FoodName: predName || null,  // NEW: เก็บชื่อเมนู
      };
      console.log("🟨 INSERT payload ->", payload);

      const res = await db.runAsync(
        `INSERT INTO meal_record
          (UserID, FoodID, FoodImage, FoodQuantity, MealType, Date, Time,
           EnergyKcal, ProteinG, FatG, CarbohydrateG, PortionMultiplier, FoodName)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.UserID,
          payload.FoodID,
          payload.FoodImage,
          payload.FoodQuantity,
          payload.MealType,
          payload.Date,
          payload.Time,
          payload.EnergyKcal,
          payload.ProteinG,
          payload.FatG,
          payload.CarbohydrateG,
          payload.PortionMultiplier,
          payload.FoodName,
        ]
      );
      console.log("✅ INSERT done ->", res);

      // ดึงแถวล่าสุดมาดูว่าลงจริงไหม
      const last = await db.getAllAsync(
        `SELECT MealRecordID, Date, Time, MealType, FoodQuantity, FoodName,
                EnergyKcal, ProteinG, FatG, CarbohydrateG, FoodImage
         FROM meal_record
         ORDER BY MealRecordID DESC
         LIMIT 1`
      );
      console.log("🔎 LAST ROW ->", last?.[0] || null);

      Alert.alert("บันทึกแล้ว");
      navigation.goBack();
    } catch (e) {
      console.log("❌ save error:", e?.message);
      await debugLogDbInfo("onSave catch"); // ถ้า error ให้ log โครงสร้างช่วย
      Alert.alert("Save Error", e?.message || "DB Error");
    } finally {
      setLoading(false);
    }
  }

  // ---------- UI ----------
  return (
    <View style={styles.container}>
      {!imageUri ? (
        <>
          <Button title="TAKE PHOTO" onPress={takePhoto} />
          <View style={{ height: 8 }} />
          <Button title="PICK FROM GALLERY" onPress={pickImage} />
          <View style={{ height: 8 }} />
          <Button title="PICK FROM GOOGLE DRIVE" onPress={pickFromDrive} />
        </>
      ) : (
        <>
          <Image
            source={{ uri: imageUri }}
            style={{ width: 240, height: 240, borderRadius: 12, marginBottom: 12, alignSelf: "center" }}
          />
          <Button title="เดาเมนูจากรูป (AI)" onPress={onPredict} />
        </>
      )}

      <View style={{ height: 12 }} />

      <Text>เมนู (แก้ได้):</Text>
      <TextInput style={styles.input} value={predName} onChangeText={setPredName} placeholder="เช่น ข้าวผัด" />
      {conf != null && <Text>ความเชื่อมั่น: {(conf * 100).toFixed(1)}%</Text>}

      <Text>ปริมาณ (g):</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={quantity} onChangeText={setQuantity} />

      <Text>โภชนาการ (ต่อเสิร์ฟ):</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={kcal} onChangeText={setKcal} placeholder="kcal" />
      <TextInput style={styles.input} keyboardType="numeric" value={protein} onChangeText={setProtein} placeholder="protein (g)" />
      <TextInput style={styles.input} keyboardType="numeric" value={fat} onChangeText={setFat} placeholder="fat (g)" />
      <TextInput style={styles.input} keyboardType="numeric" value={carb} onChangeText={setCarb} placeholder="carb (g)" />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 8 }} />
      ) : (
        <Button title="UPLOAD & SAVE MEAL" onPress={onSave} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 8, marginVertical: 6 },
});
