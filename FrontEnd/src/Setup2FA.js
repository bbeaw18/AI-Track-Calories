// FrontEnd/src/Setup2FA.js
import React, { useState } from "react";
import {
  View, Text, TextInput, StyleSheet, Image,
  TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { verifyRegister2FA, setAuthToken } from "./services/api";
import { Ionicons } from "@expo/vector-icons";

export default function Setup2FA({ route, navigation }) {
  const { userId, tempToken, qrDataUrl } = route.params || {};
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  async function onVerify() {
    try {
      if (!otp || otp.length !== 6) {
        return Alert.alert("ต้องการรหัส 6 หลัก", "โปรดกรอก OTP ให้ครบ 6 หลักจากแอป Authenticator");
      }
      setLoading(true);
      const res = await verifyRegister2FA({ userId, token: otp, tempToken });

      const accessToken = res?.accessToken;
      if (!accessToken) throw new Error("missing accessToken after verify");

      const bearer = accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`;
      await AsyncStorage.setItem("accessToken", bearer);
      await setAuthToken(bearer);

      const user = res?.user || null;
      if (user?.id) await AsyncStorage.setItem("userId", String(user.id));
      if (user?.email) await AsyncStorage.setItem("userEmail", String(user.email).toLowerCase());

      Alert.alert("สำเร็จ", "เปิดการยืนยันตัวตนสองชั้นเรียบร้อย");
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    } catch (e) {
      console.log("[Setup2FA] verify error:", e);
      Alert.alert("ยืนยันไม่สำเร็จ", e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0F172A" }}
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Ionicons name="shield-checkmark-outline" size={22} color="#22D3EE" />
        </View>
        <View style={{ marginLeft: 10 }}>
          <Text style={styles.headerTitle}>ตั้งค่า 2FA</Text>
          <Text style={styles.headerSub}>สแกน QR แล้วกรอกรหัสจากแอป Authenticator</Text>
        </View>
      </View>

      <View style={styles.card}>
        {/* QR */}
        {!!qrDataUrl && (
          <View style={styles.qrWrap}>
            <Image source={{ uri: qrDataUrl }} style={styles.qr} />
          </View>
        )}

        {/* OTP input */}
        <Text style={styles.label}>รหัสยืนยัน (OTP 6 หลัก)</Text>
        <View style={styles.inputWrap}>
          <Ionicons name="key-outline" size={18} color="#64748B" style={styles.leftIcon} />
          <TextInput
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="เช่น 123456"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          {otp.length === 6 && <Ionicons name="checkmark-circle" size={18} color="#10B981" />}
        </View>


        {/* Actions */}
        <TouchableOpacity
          style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
          onPress={onVerify}
          disabled={loading}
          activeOpacity={0.9}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>ยืนยัน</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back-outline" size={16} color="#0EA5E9" />
          <Text style={styles.linkText}>ย้อนกลับ</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 56,
    paddingBottom: 18,
    paddingHorizontal: 20,
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
  headerTitle: { color: "#E5E7EB", fontSize: 18, fontWeight: "800" },
  headerSub: { color: "#93C5FD", fontSize: 12, marginTop: 2 },

  card: {
    marginTop: -6,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    flex: 1,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },

  qrWrap: {
    alignItems: "center",
    marginBottom: 14,
  },
  qr: {
    width: 220, height: 220, borderRadius: 12,
    borderWidth: 1, borderColor: "#E5E7EB",
  },

  label: { marginTop: 6, marginBottom: 6, color: "#334155", fontWeight: "700", fontSize: 13 },

  inputWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12,
    paddingHorizontal: 12, backgroundColor: "#F8FAFC",
    height: 48,
  },
  leftIcon: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 10, color: "#111827", letterSpacing: 4, fontWeight: "700" },

  tipBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#EFF6FF", borderColor: "#DBEAFE", borderWidth: 1,
    padding: 10, borderRadius: 12, marginTop: 12,
  },
  tipText: { color: "#1D4ED8", fontSize: 12, flex: 1 },

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

  linkBtn: {
    marginTop: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  linkText: { color: "#0EA5E9", fontWeight: "800" },
});
