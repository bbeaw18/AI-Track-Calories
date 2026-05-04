// FrontEnd/src/Register.js
import React, { useMemo, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, Alert, ScrollView,
  TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { register as registerApi, setAuthToken } from "./services/api";
import { Ionicons } from "@expo/vector-icons";

export default function Register({ navigation }) {
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]   = useState(false);

  const [weight, setWeight]   = useState("");
  const [height, setHeight]   = useState("");
  const [age, setAge]         = useState("");
  const [sex, setSex]         = useState("male");
  const [exercise, setExercise] = useState("1.2");
  const [goal, setGoal]       = useState("maintain");

  // นาทีออกกำลังกายเฉลี่ย/วัน
  const [exerciseMinutesPerDay, setExerciseMinutesPerDay] = useState("30");

  const [loading, setLoading] = useState(false);

  const emailValid = useMemo(() => /\S+@\S+\.\S+/.test(email.trim()), [email]);

  function normalizeToken(tok) {
    if (!tok) return null;
    return tok.startsWith("Bearer ") ? tok : `Bearer ${tok}`;
  }

  async function handleRegister() {
    if (!email.trim() || !password.trim()) {
      return Alert.alert("กรุณากรอกข้อมูล", "โปรดใส่อีเมลและรหัสผ่าน");
    }
    if (!emailValid) {
      return Alert.alert("รูปแบบอีเมลไม่ถูกต้อง", "โปรดตรวจสอบอีเมลอีกครั้ง");
    }
    if (!weight || !height || !age) {
      return Alert.alert("ข้อมูลไม่ครบ", "กรุณากรอกน้ำหนัก ส่วนสูง และอายุให้ครบถ้วน");
    }

    try {
      setLoading(true);

      const minutesNum = Math.min(
        300,
        Math.max(0, parseInt(exerciseMinutesPerDay || "0", 10) || 0)
      );

      const payload = {
        email: email.trim().toLowerCase(),
        password: password.trim(),
        displayName: name || null,
        sex,
        weight: weight ? parseFloat(weight) : null,
        height: height ? parseFloat(height) : null,
        age: age ? parseInt(age, 10) : null,
        exercise: parseFloat(exercise),
        goal: goal || "maintain",
        exercise_minutes_per_day: minutesNum,
      };

      const res = await registerApi(payload);

      // ถ้าต้องตั้งค่า 2FA ต่อ
      if (res?.requires2faSetup) {
        const userId    = res?.user?.id ?? res?.userId;
        const tempToken = res?.tempToken;
        const qrDataUrl = res?.qrDataUrl;
        if (!userId || !tempToken || !qrDataUrl) {
          throw new Error("ข้อมูลตั้งค่า 2FA ไม่ครบ (userId/tempToken/qrDataUrl)");
        }
        Alert.alert(
          "สมัครสำเร็จ",
          "ขั้นตอนถัดไป: สแกน QR ด้วยแอป Authenticator แล้วกรอกรหัส 6 หลัก",
          [{ text: "ดำเนินการต่อ", onPress: () =>
            navigation.navigate("Setup2FA", { userId, tempToken, qrDataUrl })
          }]
        );
        return;
      }

      const userRaw  = res?.user || res?.data?.user || null;
      const tokenRaw = res?.accessToken || res?.data?.accessToken || res?.token || null;
      const token    = normalizeToken(tokenRaw);
      if (!token) throw new Error("missing accessToken from register API");

      await AsyncStorage.setItem("accessToken", token);
      await setAuthToken(token);

      const userId = userRaw?.id ?? userRaw?.UserID ?? null;
      if (userId) await AsyncStorage.setItem("userId", String(userId));
      await AsyncStorage.setItem("userEmail", (userRaw?.email ?? email).trim().toLowerCase());

      // NOTE: งดแจ้งเตือนปริมาณน้ำที่ควรดื่มทันทีหลังสมัคร (จะแสดงเฉพาะหน้า Home)
      // if (res?.waterSuggestion) { ... } // intentionally omitted

      Alert.alert("สำเร็จ", "สมัครสมาชิกเรียบร้อย");
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || "เกิดข้อผิดพลาด";
      console.log("[Register] error:", msg);
      Alert.alert("Register Error", String(msg));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1, backgroundColor: "#0F172A" }}
    >
      {/* Header / brand */}
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Ionicons name="leaf-outline" size={24} color="#22D3EE" />
        </View>
        <View style={{ marginLeft: 10 }}>
          <Text style={styles.appName}>AI-Track-Cal</Text>
          <Text style={styles.appTag}>สร้างบัญชีใหม่เพื่อเริ่มต้นดูแลสุขภาพ</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.title}>สมัครสมาชิก</Text>

          {/* Name */}
          <Text style={styles.label}>ชื่อที่แสดง</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="person-outline" size={18} color="#64748B" style={styles.leftIcon} />
            <TextInput
              style={styles.input}
              placeholder="ชื่อของคุณ"
              placeholderTextColor="#94A3B8"
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Email */}
          <Text style={styles.label}>อีเมล</Text>
          <View style={[styles.inputWrap, (!emailValid && !!email) && styles.inputError]}>
            <Ionicons name="mail-outline" size={18} color="#64748B" style={styles.leftIcon} />
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor="#94A3B8"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {emailValid && !!email && (
              <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            )}
          </View>

          {/* Password */}
          <Text style={styles.label}>รหัสผ่าน</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#64748B" style={styles.leftIcon} />
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#94A3B8"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPw}
            />
            <TouchableOpacity onPress={() => setShowPw(v => !v)}>
              <Ionicons name={showPw ? "eye-off" : "eye"} size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Sex */}
          <Text style={styles.label}>เพศ</Text>
          <View style={styles.pickerContainer}>
            <Picker selectedValue={sex} onValueChange={setSex}>
              <Picker.Item label="ชาย (Male)" value="male" />
              <Picker.Item label="หญิง (Female)" value="female" />
            </Picker>
          </View>

          {/* Basic metrics */}
          <Text style={styles.label}>น้ำหนัก (กก.)</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="scale-outline" size={18} color="#64748B" style={styles.leftIcon} />
            <TextInput
              style={styles.input}
              placeholder="เช่น 70"
              placeholderTextColor="#94A3B8"
              keyboardType="numeric"
              value={weight}
              onChangeText={setWeight}
            />
          </View>

          <Text style={styles.label}>ส่วนสูง (ซม.)</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="body-outline" size={18} color="#64748B" style={styles.leftIcon} />
            <TextInput
              style={styles.input}
              placeholder="เช่น 175"
              placeholderTextColor="#94A3B8"
              keyboardType="numeric"
              value={height}
              onChangeText={setHeight}
            />
          </View>

          <Text style={styles.label}>อายุ (ปี)</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="hourglass-outline" size={18} color="#64748B" style={styles.leftIcon} />
            <TextInput
              style={styles.input}
              placeholder="เช่น 22"
              placeholderTextColor="#94A3B8"
              keyboardType="numeric"
              value={age}
              onChangeText={setAge}
            />
          </View>

          {/* Activity level */}
          <Text style={styles.label}>ระดับการออกกำลังกาย</Text>
          <View style={styles.pickerContainer}>
            <Picker selectedValue={exercise} onValueChange={setExercise}>
              <Picker.Item label="แทบไม่ออกกำลังกาย (Sedentary)" value="1.2" />
              <Picker.Item label="ออกกำลังกายเล็กน้อย (1-3 วัน/สัปดาห์)" value="1.375" />
              <Picker.Item label="ออกกำลังกายปานกลาง (3-5 วัน/สัปดาห์)" value="1.55" />
              <Picker.Item label="ออกกำลังกายสม่ำเสมอ (6-7 วัน/สัปดาห์)" value="1.725" />
              <Picker.Item label="ออกกำลังกายหนัก / นักกีฬา" value="1.9" />
            </Picker>
          </View>

          {/* Exercise minutes/day */}
          <Text style={styles.label}>นาทีออกกำลังกายเฉลี่ย/วัน</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="timer-outline" size={18} color="#64748B" style={styles.leftIcon} />
            <TextInput
              style={styles.input}
              placeholder="เช่น 30"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              value={exerciseMinutesPerDay}
              onChangeText={setExerciseMinutesPerDay}
            />
          </View>

          {/* Goal */}
          <Text style={styles.label}>เป้าหมาย</Text>
          <View style={styles.pickerContainer}>
            <Picker selectedValue={goal} onValueChange={setGoal}>
              <Picker.Item label="รักษาน้ำหนัก" value="maintain" />
              <Picker.Item label="ลดน้ำหนัก" value="lose" />
              <Picker.Item label="เพิ่มกล้าม" value="gain" />
            </Picker>
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="person-add-outline" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>สมัครสมาชิก</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Link to login */}
          <View style={styles.linksRow}>
            <Text style={styles.noteText}>มีบัญชีอยู่แล้ว?</Text>
            <TouchableOpacity onPress={() => navigation.navigate("Login")}>
              <Text style={styles.link}>เข้าสู่ระบบ</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.footerNote}>
          เมื่อสมัครสมาชิก แสดงว่าคุณยอมรับนโยบายความเป็นส่วนตัวของเรา
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 54,
    paddingBottom: 20,
    paddingHorizontal: 22,
    backgroundColor: "#0F172A",
    flexDirection: "row",
    alignItems: "center",
  },
  logoCircle: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "#081426",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#22D3EE40",
  },
  appName: { color: "#E5E7EB", fontSize: 18, fontWeight: "800" },
  appTag: { color: "#93C5FD", fontSize: 12, marginTop: 2 },

  scroll: { paddingHorizontal: 18, paddingBottom: 28 },
  card: {
    backgroundColor: "#FFFFFF",
    marginTop: -10,
    borderRadius: 18,
    padding: 18,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },

  title: { fontSize: 22, fontWeight: "800", marginBottom: 12, color: "#111827" },

  label: { marginTop: 10, marginBottom: 6, color: "#334155", fontWeight: "700", fontSize: 13 },

  inputWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12,
    paddingHorizontal: 12, backgroundColor: "#F8FAFC",
    height: 46,
  },
  leftIcon: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 10, color: "#111827" },
  inputError: { borderColor: "#F43F5E", backgroundColor: "#FFF1F2" },

  pickerContainer: {
    borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12,
    backgroundColor: "#F8FAFC", overflow: "hidden",
  },

  primaryBtn: {
    marginTop: 16,
    backgroundColor: "#22C55E",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.2 },

  linksRow: {
    marginTop: 14, flexDirection: "row",
    justifyContent: "center", alignItems: "center", gap: 8,
  },
  noteText: { color: "#64748B", fontSize: 12 },
  link: { color: "#0EA5E9", fontWeight: "800" },

  footerNote: {
    color: "#93C5FD", textAlign: "center", marginTop: 12, fontSize: 12,
  },
});
