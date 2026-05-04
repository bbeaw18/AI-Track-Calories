// FrontEnd/src/ResetPassword.js
import React, { useMemo, useState } from "react";
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, ActivityIndicator, Alert
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { resetConfirm } from "./services/api";

export default function ResetPassword({ route, navigation }) {
  const { resetToken } = route.params || {};
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    try {
      if (!pw1 || pw1.length < 6) return Alert.alert("รหัสผ่านสั้น", "อย่างน้อย 6 ตัวอักษร");
      if (pw1 !== pw2) return Alert.alert("ไม่ตรงกัน", "รหัสผ่านทั้งสองช่องต้องตรงกัน");
      setLoading(true);
      await resetConfirm({ resetToken, newPassword: pw1 });
      Alert.alert("สำเร็จ", "ตั้งรหัสผ่านใหม่เรียบร้อย");
      navigation.reset({ index: 0, routes: [{ name: "Login" }] });
    } catch (e) {
      console.log("[ResetPassword] error:", e);
      Alert.alert("เกิดข้อผิดพลาด", e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  }

  // แถบประเมินคร่าว ๆ เพื่อ feedback สั้น ๆ (ไม่ยุ่งกับ logic ส่งข้อมูล)
  const strength = useMemo(() => {
    const s = pw1 || "";
    let score = 0;
    if (s.length >= 6) score++;
    if (/[A-Z]/.test(s)) score++;
    if (/[0-9]/.test(s)) score++;
    if (/[^A-Za-z0-9]/.test(s)) score++;
    // 0–4
    const label = ["อ่อนมาก", "อ่อน", "ปานกลาง", "ดี", "แข็งแรง"][score] || "อ่อนมาก";
    const pct = (score / 4) * 100;
    const color = score <= 1 ? "#EF4444" : score === 2 ? "#F59E0B" : score === 3 ? "#10B981" : "#16A34A";
    return { pct, label, color };
  }, [pw1]);

  const match = pw1.length > 0 && pw2.length > 0 && pw1 === pw2;

  return (
    <View style={styles.wrap}>
      {/* Header */}
      <View style={styles.headerCard}>
        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed-outline" size={20} color="#1E40AF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>ตั้งรหัสผ่านใหม่</Text>
          <Text style={styles.subtitle}>อย่างน้อย 6 ตัวอักษร แนะนำให้ใช้ตัวเลข/สัญลักษณ์ร่วมด้วย</Text>
        </View>
      </View>

      {/* Password 1 */}
      <Text style={styles.label}>รหัสผ่านใหม่</Text>
      <View style={[styles.input, styles.row]}>
        <TextInput
          value={pw1}
          onChangeText={setPw1}
          secureTextEntry={!show1}
          placeholder="รหัสผ่านใหม่"
          style={{ flex: 1, paddingRight: 8 }}
        />
        <TouchableOpacity onPress={() => setShow1(v => !v)}>
          <Ionicons name={show1 ? "eye-off" : "eye"} size={22} color="#64748B" />
        </TouchableOpacity>
      </View>

      {/* Strength bar */}
      <View style={styles.strengthWrap}>
        <View style={styles.strengthTrack}>
          <View style={[styles.strengthFill, { width: `${strength.pct}%`, backgroundColor: strength.color }]} />
        </View>
        <Text style={[styles.strengthText, { color: strength.color }]}>{pw1 ? strength.label : "—"}</Text>
      </View>

      {/* Password 2 */}
      <Text style={[styles.label, { marginTop: 8 }]}>ยืนยันรหัสผ่านใหม่</Text>
      <View style={[styles.input, styles.row, pw2 ? (match ? styles.okBorder : styles.errBorder) : null]}>
        <TextInput
          value={pw2}
          onChangeText={setPw2}
          secureTextEntry={!show2}
          placeholder="ยืนยันรหัสผ่านใหม่"
          style={{ flex: 1, paddingRight: 8 }}
        />
        <TouchableOpacity onPress={() => setShow2(v => !v)}>
          <Ionicons name={show2 ? "eye-off" : "eye"} size={22} color="#64748B" />
        </TouchableOpacity>
      </View>
      {!!pw2 && !match && <Text style={styles.errText}>รหัสผ่านทั้งสองช่องต้องตรงกัน</Text>}
      {!!pw2 && match && (
        <View style={styles.matchRow}>
          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          <Text style={styles.matchText}>รหัสผ่านตรงกัน</Text>
        </View>
      )}

      {/* Submit */}
      <TouchableOpacity
        style={[styles.btn, loading && { opacity: 0.7 }]}
        onPress={onSubmit}
        disabled={loading}
        activeOpacity={0.9}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="save-outline" size={18} color="#fff" />
            <Text style={styles.btnText}>บันทึก</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Back to login */}
      <TouchableOpacity style={styles.backLink} onPress={() => navigation.navigate("Login")}>
        <Ionicons name="log-in-outline" size={16} color="#111827" />
        <Text style={styles.backText}>กลับสู่หน้าเข้าสู่ระบบ</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, backgroundColor: "#F8FAFC", justifyContent: "center" },

  headerCard: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: "#E0EAFF", borderWidth: 1, borderColor: "#BFDBFE",
    alignItems: "center", justifyContent: "center",
  },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  subtitle: { color: "#CBD5E1", fontSize: 12, marginTop: 2 },

  label: { marginBottom: 6, color: "#374151", fontWeight: "700" },
  input: {
    borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff",
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  strengthWrap: { marginTop: 8, marginBottom: 4, flexDirection: "row", alignItems: "center", gap: 8 },
  strengthTrack: { flex: 1, height: 8, backgroundColor: "#E5E7EB", borderRadius: 999, overflow: "hidden" },
  strengthFill: { height: "100%", borderRadius: 999 },
  strengthText: { fontSize: 12, fontWeight: "700" },

  errText: { color: "#EF4444", marginTop: 6 },
  errBorder: { borderColor: "#EF4444" },
  okBorder: { borderColor: "#10B981" },
  matchRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  matchText: { color: "#065F46", fontWeight: "700" },

  btn: {
    backgroundColor: "#4F46E5",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  backLink: { alignSelf: "center", marginTop: 14, flexDirection: "row", alignItems: "center", gap: 6 },
  backText: { color: "#111827", fontWeight: "700" },
});
