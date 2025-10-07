// FrontEnd/src/UploadFood.js
import React, { useEffect, useState } from "react";
import { View, Text, Button, Image, TextInput, StyleSheet, Alert, ActivityIndicator, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SQLite from "expo-sqlite"; // ใช้ API ใหม่ (async)
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

// สร้าง/อัปสคีม่า (มี migration เพิ่มคอลัมน์หากขาด)
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

  const cols = await db.getAllAsync(`PRAGMA table_info(meals)`);
  const have = new Set(cols.map(c => c.name));
  const alters = [];
  if (!have.has("quantity"))  alters.push(`ALTER TABLE meals ADD COLUMN quantity REAL;`);
  if (!have.has("unit"))      alters.push(`ALTER TABLE meals ADD COLUMN unit TEXT;`);
  if (!have.has("kcal"))      alters.push(`ALTER TABLE meals ADD COLUMN kcal REAL;`);
  if (!have.has("protein"))   alters.push(`ALTER TABLE meals ADD COLUMN protein REAL;`);
  if (!have.has("fat"))       alters.push(`ALTER TABLE meals ADD COLUMN fat REAL;`);
  if (!have.has("carb"))      alters.push(`ALTER TABLE meals ADD COLUMN carb REAL;`);
  if (!have.has("image_uri")) alters.push(`ALTER TABLE meals ADD COLUMN image_uri TEXT;`);
  if (!have.has("created_at")) alters.push(`ALTER TABLE meals ADD COLUMN created_at TEXT DEFAULT (datetime('now'));`);
  for (const sql of alters) await db.execAsync(sql);
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

export default function UploadFood({ navigation, route }) {
  const mealType = route?.params?.mealType || "other";
  const today = new Date().toISOString().slice(0, 10);

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

  // บันทึกลง SQLite (API ใหม่ + sanitize + migration)
  async function onSave() {
    if (!predName) return Alert.alert("ยังไม่ทราบชื่อเมนู");
    try {
      setLoading(true);
      await ensureSchema();
      const unit = "g";
      const db = await getDb();

      const payload = [
        today,
        mealType,
        predName,
        n(quantity),
        unit,
        n(kcal),
        n(protein),
        n(fat),
        n(carb),
        imageUri || null,
      ];
      console.log("INSERT payload:", payload);

      await db.runAsync(
        `INSERT INTO meals
          (date, mealType, name, quantity, unit, kcal, protein, fat, carb, image_uri)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        payload
      );

      Alert.alert("บันทึกแล้ว");
      navigation.goBack();
    } catch (e) {
      console.log("save error", e?.message);
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
