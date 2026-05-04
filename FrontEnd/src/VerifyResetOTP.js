// FrontEnd/src/VerifyResetOTP.js
import React, { useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, ActivityIndicator, Alert, Keyboard, Pressable
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { resetVerifyOtp } from "./services/api";

export default function VerifyResetOTP({ route, navigation }) {
  const { userId, tempToken } = route.params || {};
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  async function onVerify() {
    try {
      if (!otp || otp.length !== 6) return Alert.alert("OTP", "กรุณากรอก OTP 6 หลัก");
      setLoading(true);
      const res = await resetVerifyOtp({ userId, token: otp, tempToken });
      const resetToken = res?.resetToken;
      if (!resetToken) throw new Error("missing resetToken");
      navigation.navigate("ResetPassword", { resetToken });
    } catch (e) {
      console.log("[VerifyResetOTP] error:", e);
      Alert.alert("OTP ไม่ถูกต้อง", e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  }

  const focusInput = () => {
    inputRef.current?.focus();
  };

  const onChangeOtp = (t) => {
    // รับเฉพาะตัวเลข สูงสุด 6 หลัก
    const digits = t.replace(/\D/g, "").slice(0, 6);
    setOtp(digits);
  };

  return (
    <View style={styles.wrap}>
      {/* Header card */}
      <View style={styles.headerCard}>
        <View style={styles.iconWrap}>
          <Ionicons name="shield-checkmark-outline" size={20} color="#1E40AF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>ยืนยัน OTP</Text>
          <Text style={styles.subtitle}>กรอกรหัส 6 หลักจาก Google Authenticator</Text>
        </View>
      </View>

      {/* OTP Boxes */}
      <Pressable style={styles.otpBoxWrap} onPress={focusInput}>
        {[...Array(6)].map((_, i) => {
          const char = otp[i] ?? "";
          const active = i === otp.length && otp.length < 6;
          return (
            <View key={i} style={[styles.otpCell, active && styles.otpCellActive]}>
              <Text style={styles.otpChar}>{char}</Text>
            </View>
          );
        })}
        {/* Hidden input รับค่าจริง */}
        <TextInput
          ref={inputRef}
          value={otp}
          onChangeText={onChangeOtp}
          keyboardType="number-pad"
          maxLength={6}
          style={styles.hiddenInput}
          autoFocus
        />
      </Pressable>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.btn, loading && { opacity: 0.7 }]}
        onPress={onVerify}
        disabled={loading}
        activeOpacity={0.9}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
            <Text style={styles.btnText}>ยืนยัน</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Back */}
      <TouchableOpacity
        style={styles.backLink}
        onPress={() => { Keyboard.dismiss(); navigation.goBack(); }}
      >
        <Ionicons name="arrow-back" size={16} color="#111827" />
        <Text style={styles.backText}>กลับไปก่อนหน้า</Text>
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

  otpBoxWrap: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  otpCell: {
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  otpCellActive: {
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },
  otpChar: { fontSize: 22, fontWeight: "800", color: "#111827" },

  hiddenInput: {
    // ซ่อนแต่ยังรับโฟกัส/คีย์บอร์ด
    position: "absolute",
    opacity: 0,
    width: 1,
    height: 1,
  },

  hintRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  hintText: { color: "#1D4ED8", fontSize: 12, flex: 1 },

  btn: {
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
