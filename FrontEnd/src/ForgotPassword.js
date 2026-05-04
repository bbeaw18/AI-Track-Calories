import React, { useState } from "react";
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, ActivityIndicator, Alert
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { resetRequest } from "./services/api";

export default function ForgotPassword({ navigation }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  const emailValid = /\S+@\S+\.\S+/.test(email.trim());
  const showErr = touched && email.length > 0 && !emailValid;

  async function onSubmit() {
    try {
      if (!emailValid) {
        setTouched(true);
        return Alert.alert("อีเมลไม่ถูกต้อง", "กรุณากรอกอีเมลที่ถูกต้อง");
      }
      setLoading(true);
      const res = await resetRequest(email);

      if (res?.requires2fa && res?.userId && res?.tempToken) {
        navigation.navigate("VerifyResetOTP", {
          userId: res.userId,
          tempToken: res.tempToken,
        });
      } else {
        Alert.alert("ตรวจสอบอีเมล", "หากบัญชีนี้รองรับรีเซ็ตแบบอื่น เราจะติดต่อกลับ");
        navigation.goBack();
      }
    } catch (e) {
      console.log("[ForgotPassword] error:", e);
      Alert.alert("เกิดข้อผิดพลาด", e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {/* Header card */}
      <View style={styles.headerCard}>
        <View style={styles.iconWrap}>
          <Ionicons name="key-outline" size={22} color="#1E40AF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>ลืมรหัสผ่าน</Text>
          <Text style={styles.subtitle}>กรอกอีเมลที่ใช้สมัครเพื่อรับขั้นตอนถัดไป</Text>
        </View>
      </View>

      {/* Email input */}
      <Text style={styles.label}>อีเมล</Text>
      <View style={[
        styles.inputWrap,
        showErr && { borderColor: "#EF4444", backgroundColor: "#FEF2F2" }
      ]}>
        <Ionicons name="mail-outline" size={18} color={showErr ? "#EF4444" : "#94A3B8"} />
        <TextInput
          value={email}
          onChangeText={(t) => setEmail(t)}
          onBlur={() => setTouched(true)}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="you@example.com"
          placeholderTextColor="#94A3B8"
          style={styles.input}
        />
        {email.length > 0 && emailValid && (
          <Ionicons name="checkmark-circle" size={18} color="#10B981" />
        )}
      </View>
      {showErr && <Text style={styles.errText}>รูปแบบอีเมลไม่ถูกต้อง</Text>}

      {/* Submit */}
      <TouchableOpacity
        style={[styles.btn, loading && { opacity: 0.7 }]}
        onPress={onSubmit}
        disabled={loading}
        activeOpacity={0.9}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : (
            <>
              <Ionicons name="send" size={18} color="#fff" />
              <Text style={styles.btnText}>ขอรีเซ็ต</Text>
            </>
          )
        }
      </TouchableOpacity>

      {/* Back link */}
      <TouchableOpacity style={styles.backLink} onPress={() => navigation.goBack()}>
        <Ionicons name="arrow-back" size={16} color="#111827" />
        <Text style={styles.backText}>กลับไปหน้าเข้าสู่ระบบ</Text>
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
    marginBottom: 16,
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
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  input: { flex: 1, color: "#111827", fontSize: 16 },
  errText: { color: "#EF4444", marginTop: 6 },

  hintRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 6 },
  hintText: { color: "#1D4ED8", fontSize: 12, flex: 1 },

  btn: {
    marginTop: 14,
    backgroundColor: "#4F46E5",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  backLink: {
    alignSelf: "center",
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backText: { color: "#111827", fontWeight: "700" },
});
