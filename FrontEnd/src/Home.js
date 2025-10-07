// frontend/src/home.js
import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getMeals } from "./services/api"; // ← ต้องมีฟังก์ชันนี้ตามที่ตั้งไว้
import { useFocusEffect } from "@react-navigation/native";

export default function Home({ navigation }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [water, setWater] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ date: today, kcal: 0, protein: 0, fat: 0, carb: 0 });
  const [meals, setMeals] = useState([
    { id: "breakfast", title: "มื้อเช้า", icon: "sunny", color: "#FFD580", kcal: 0 },
    { id: "lunch",     title: "มื้อกลางวัน", icon: "fast-food", color: "#FFB347", kcal: 0 },
    { id: "dinner",    title: "มื้อเย็น", icon: "moon", color: "#87CEFA", kcal: 0 },
    { id: "other",     title: "มื้ออื่นๆ", icon: "ice-cream", color: "#C3B1E1", kcal: 0 },
  ]);

  const fetchMeals = useCallback(async () => {
    try {
      setLoading(true);
      const { summary: s, perType } = await getMeals(today);
      setSummary(s || { date: today, kcal: 0, protein: 0, fat: 0, carb: 0 });
      setMeals((m) => m.map((x) => ({ ...x, kcal: perType?.[x.id] ?? 0 })));
    } catch (e) {
      console.log("Fetch meals error:", e?.response?.data || e.message);
      // ถ้าดึงไม่ได้ ให้คงค่าเดิมไว้
    } finally {
      setLoading(false);
    }
  }, [today]);

  // โหลดทุกครั้งที่กลับมาหน้า Home
  useFocusEffect(
    useCallback(() => {
      fetchMeals();
    }, [fetchMeals])
  );

  return (
    <View style={styles.container}>
      {/* สรุปข้อมูลวันนี้ */}
      <View style={styles.summaryBox}>
        <Text style={styles.summaryDate}>วันที่ {summary.date}</Text>
        <Text style={styles.summaryText}>พลังงาน {summary.kcal} kcal</Text>
        <Text style={styles.summaryText}>
          โปรตีน {summary.protein} g | ไขมัน {summary.fat} g | คาร์บ {summary.carb} g
        </Text>
      </View>

      <Text style={styles.greet}>สวัสดี 👋</Text>
      <Text style={styles.subText}>วันนี้คุณกินไปแล้ว {summary.kcal} kcal</Text>

      <FlatList
        data={meals}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchMeals} />
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: item.color }]}>
            <Ionicons name={item.icon} size={28} color="#333" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text>รวม: {item.kcal} kcal</Text>
            </View>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => navigation.navigate("UploadFood", { mealType: item.id })}
            >
              <Text style={{ color: "#fff" }}>+ เพิ่ม</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <View style={styles.waterBox}>
        <Text style={styles.waterTitle}>การดื่มน้ำ 💧</Text>
        <Text style={styles.waterText}>{water} / 8 แก้ว</Text>
        <View style={styles.waterRow}>
          {[...Array(8)].map((_, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => setWater(i + 1)}
              style={[
                styles.glass,
                { backgroundColor: i < water ? "#00BFFF" : "#E0E0E0" },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.bottomMenu}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Home")}>
          <Ionicons name="home" size={24} color="#333" />
          <Text style={styles.menuText}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("History")}>
          <Ionicons name="list" size={24} color="#333" />
          <Text style={styles.menuText}>ประวัติการกิน</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Profile")}>
          <Ionicons name="person" size={24} color="#333" />
          <Text style={styles.menuText}>ผู้ใช้</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Settings")}>
          <Ionicons name="settings" size={24} color="#333" />
          <Text style={styles.menuText}>ตั้งค่า</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff", paddingBottom: 80 },
  summaryBox: {
    backgroundColor: "#e3f2fd",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  summaryDate: { fontSize: 16, fontWeight: "bold", marginBottom: 4 },
  summaryText: { fontSize: 15, marginBottom: 2 },
  greet: { fontSize: 22, fontWeight: "bold" },
  subText: { color: "#555", marginBottom: 15 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  cardTitle: { fontSize: 18, fontWeight: "600" },
  addBtn: {
    backgroundColor: "#333",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  waterBox: {
    marginTop: 20,
    marginBottom: 10,
    padding: 20,
    backgroundColor: "#f2f2f2",
    borderRadius: 12,
  },
  waterTitle: { fontSize: 18, fontWeight: "bold" },
  waterText: { marginVertical: 8, fontSize: 16 },
  waterRow: { flexDirection: "row", flexWrap: "wrap" },
  glass: {
    width: 30,
    height: 50,
    borderRadius: 5,
    margin: 4,
  },
  bottomMenu: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: "#eee",
    backgroundColor: "#fafafa",
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  menuBtn: {
    alignItems: "center",
    flex: 1,
  },
  menuText: {
    fontSize: 12,
    color: "#333",
    marginTop: 2,
  },
});
