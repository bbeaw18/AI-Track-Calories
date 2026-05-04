// FrontEnd/src/TwoFA.js
import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { checkLogin2FA, setAuthToken } from "./services/api";

export default function TwoFA({ route, navigation }) {
  const { userId, tempToken } = route.params || {};
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  async function onVerify() {
    try {
      if (!otp || otp.length !== 6) return Alert.alert("OTP", "กรุณากรอก OTP 6 หลัก");
      setLoading(true);
      const res = await checkLogin2FA({ userId, token: otp, tempToken });

      const accessToken = res?.accessToken;
      if (!accessToken) throw new Error("missing accessToken after 2FA check");

      const bearer = accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`;
      await AsyncStorage.setItem("accessToken", bearer);
      await setAuthToken(bearer);

      const user = res?.user || null;
      if (user?.id) await AsyncStorage.setItem("userId", String(user.id));
      if (user?.email) await AsyncStorage.setItem("userEmail", String(user.email).toLowerCase());

      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    } catch (e) {
      console.log("[TwoFA] verify error:", e);
      Alert.alert("OTP ไม่ถูกต้อง", e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  }

  // สร้างกล่องแสดงตัวเลข 6 หลัก (UI เท่านั้น)
  const cells = useMemo(() => {
    const chars = otp.split("");
    return Array.from({ length: 6 }, (_, i) => chars[i] ?? "");
  }, [otp]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0F172A" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header area */}
      <View style={styles.header}>
        <View style={styles.lockIconWrap}>
          <Ionicons name="shield-checkmark" size={28} color="#1D4ED8" />
        </View>
        <Text style={styles.title}>ยืนยันสองชั้น (2FA)</Text>
        <Text style={styles.subtitle}>
          กรอกรหัส 6 หลักจากแอป Google Authenticator เพื่อยืนยันตัวตนของคุณ
        </Text>
      </View>

      {/* Card */}
      <View style={styles.card}>
        {/* OTP cells (กดที่ไหนก็โฟกัส input เดียวกัน) */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => inputRef.current?.focus?.()}
          style={styles.otpRow}
        >
          {cells.map((c, i) => (
            <View key={i} style={[styles.otpCell, c ? styles.otpCellFilled : null]}>
              <Text style={styles.otpChar}>{c}</Text>
            </View>
          ))}
        </TouchableOpacity>

        {/* Hidden/overlay input ตัวเดียว เก็บค่า OTP จริง */}
        <TextInput
          ref={inputRef}
          value={otp}
          onChangeText={(t) => {
            const onlyNum = t.replace(/[^0-9]/g, "").slice(0, 6);
            setOtp(onlyNum);
          }}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="รหัส 6 หลัก"
          placeholderTextColor="#94A3B8"
          style={styles.hiddenInput}
          textContentType="oneTimeCode"
          autoFocus
          onSubmitEditing={onVerify}
        />

        <TouchableOpacity
          style={[styles.btn, loading && { opacity: 0.7 }]}
          onPress={onVerify}
          disabled={loading}
          activeOpacity={0.85}
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

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Ionicons name="chevron-back" size={18} color="#1E40AF" />
          <Text style={styles.secondaryText}>กลับ</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 60,
    paddingHorizontal: 22,
    paddingBottom: 22,
    backgroundColor: "#0F172A",
  },
  lockIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: "#E0EAFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  title: { color: "#FFFFFF", fontSize: 22, fontWeight: "800" },
  subtitle: { color: "#CBD5E1", marginTop: 6, lineHeight: 20 },

  card: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 22,
  },

  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
    marginBottom: 14,
  },
  otpCell: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  otpCellFilled: {
    backgroundColor: "#EEF2FF",
    borderColor: "#C7D2FE",
  },
  otpChar: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
  },

  // อินพุตจริงซ่อนสไตล์ไว้ แต่ยังเข้าถึงได้ (สำหรับคีย์บอร์ด/autoFill)
  hiddenInput: {
    opacity: 0,
    height: 0,
  },

  hint: {
    color: "#475569",
    fontSize: 13,
    marginTop: 6,
    marginBottom: 16,
  },

  btn: {
    backgroundColor: "#4F46E5",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16 },

  secondaryBtn: {
    marginTop: 12,
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
  },
  secondaryText: { color: "#1E40AF", fontWeight: "700" },
});
