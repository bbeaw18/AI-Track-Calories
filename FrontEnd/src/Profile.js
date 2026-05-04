// screens/ProfileScreen.js
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "./services/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem("token");
      const { data } = await api.get("/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(data);
    } catch (e) {
      console.error(e);
      Alert.alert("เกิดข้อผิดพลาด", "ไม่สามารถโหลดข้อมูลผู้ใช้ได้");
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  };

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );

  if (!user)
    return (
      <View style={styles.center}>
        <Text>ไม่พบข้อมูลผู้ใช้</Text>
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={36} color="#1F2937" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {user.displayName || user.email?.split("@")[0] || "User"}
          </Text>
          <View style={styles.emailRow}>
            <Ionicons name="mail-outline" size={14} color="#CBD5E1" />
            <Text style={styles.email} numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.editIconBtn}
          onPress={() => navigation.navigate("EditProfile", { user })}
          activeOpacity={0.8}
        >
          <Ionicons name="create-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Quick stats */}
        <View style={styles.gridRow}>
          <StatCard icon="scale-outline" label="น้ำหนัก" value={fmt(user.weight, "kg")} />
          <StatCard icon="body-outline" label="ส่วนสูง" value={fmt(user.height, "cm")} />
          <StatCard icon="hourglass-outline" label="อายุ" value={fmt(user.age, "ปี")} />
        </View>

        {/* Info cards */}
        <View style={styles.card}>
          <InfoItem icon="male-female-outline" label="เพศ" value={user.sex || "-"} />
          <Separator />
          <InfoItem
          icon="barbell-outline"
          label="ระดับการออกกำลังกาย"
          value={exerciseLabel(user.exercise)}
          />

          <Separator />
          <InfoItem
            icon="timer-outline"
            label="เวลาออกกำลังกาย/วัน"
            value={`${Number(user.exercise_minutes_per_day ?? 0)} นาที`}
          />
          <Separator />
          <InfoItem icon="flag-outline" label="เป้าหมาย" value={goalLabel(user.goal)} />
        </View>

        
        

        {/* Big edit button */}
        <TouchableOpacity
          style={styles.button}
          onPress={() => navigation.navigate("EditProfile", { user })}
          activeOpacity={0.9}
        >
          <Ionicons name="create-outline" size={20} color="#fff" />
          <Text style={styles.buttonText}>แก้ไขข้อมูล</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/* ---------- Small UI helpers ---------- */
/* ---------- Small UI helpers ---------- */
const fmt = (v, unit) => (v === null || v === undefined || v === "" ? "-" : `${v} ${unit}`);
const goalLabel = (g) =>
  g === "lose" ? "ลดน้ำหนัก" : g === "gain" ? "เพิ่มกล้าม" : "รักษาน้ำหนัก";

const exerciseLabel = (v) => {
  if (v === null || v === undefined || v === "") return "-";
  const s = String(v).trim();
  switch (s) {
    case "1.2":   return "ไม่ค่อยออกกำลังกาย";
    case "1.375": return "ออกกำลังกายเล็กน้อย";
    case "1.55":  return "ออกกำลังกายปานกลาง";
    case "1.725": return "ออกกำลังกายสม่ำเสมอ";
    case "1.9":   return "ออกกำลังกายหนัก / นักกีฬา";
    default:      return s;
  }
};




/* ---------- Reusable components ---------- */
function StatCard({ icon, label, value }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIconWrap}>
        <Ionicons name={icon} size={18} color="#1E40AF" />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InfoItem({ icon, label, value }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLeft}>
        <View style={styles.infoIcon}>
          <Ionicons name={icon} size={18} color="#334155" />
        </View>
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const Separator = () => <View style={styles.separator} />;

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  header: {
    paddingTop: 26,
    paddingBottom: 18,
    paddingHorizontal: 20,
    backgroundColor: "#111827",
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  name: { color: "#fff", fontSize: 20, fontWeight: "800" },
  emailRow: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 6 },
  email: { color: "#CBD5E1", fontSize: 12, maxWidth: 200 },
  editIconBtn: {
    marginLeft: 10,
    backgroundColor: "#2563EB",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },

  container: { padding: 16, paddingBottom: 40 },

  gridRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  statIconWrap: {
    alignSelf: "flex-start",
    backgroundColor: "#DBEAFE",
    borderRadius: 8,
    padding: 6,
    marginBottom: 6,
  },
  statValue: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  statLabel: { fontSize: 12, color: "#64748B", marginTop: 2 },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
  },
  infoLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  infoIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  infoLabel: { fontSize: 14, color: "#475569", fontWeight: "600" },
  infoValue: { fontSize: 14, color: "#0F172A", fontWeight: "700", maxWidth: "55%" },

  separator: { height: 1, backgroundColor: "#F1F5F9", marginVertical: 4 },

  tipCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderColor: "#DBEAFE",
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  tipText: { color: "#1D4ED8", fontSize: 13, flex: 1 },

  button: {
    flexDirection: "row",
    backgroundColor: "#2563EB",
    padding: 14,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
});
