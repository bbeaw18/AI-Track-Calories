// FrontEnd/src/History.js
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  DeviceEventEmitter,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { Calendar } from "react-native-calendars";
import * as SQLite from "expo-sqlite";
import { getMeals, deleteMeal, getWater, api } from "./services/api";
/* ---------- Helper ---------- */
function todayThailandISO() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const th = new Date(utc + 7 * 60 * 60 * 1000);
  const y = th.getFullYear();
  const m = String(th.getMonth() + 1).padStart(2, "0");
  const d = String(th.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function deleteLocalMealIfExists(id) {
  try {
    const db = await SQLite.openDatabaseAsync("MealRecord.sqlite");
    await db.execAsync(`DELETE FROM meal_record WHERE MealRecordID = ? OR FoodID = ?`, [id, id]);
  } catch (e) {
    console.log("[History] deleteLocalMealIfExists error:", e?.message);
  }
}

/* ---------- Main ---------- */
export default function History({ navigation }) {
  const [items, setItems] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayThailandISO());
const [water, setWater] = useState(null);      // ⬅️ เพิ่มบรรทัดนี้
  const [waterMax, setWaterMax] = useState(8);
  const [loading, setLoading] = useState(false);  const isFocused = useIsFocused();

  async function loadByDate(dateStr) {
    try {
      setLoading(true);

      const mealRes = await getMeals(dateStr);
      const list = Array.isArray(mealRes?.items) ? mealRes.items : [];

      const rows = list
        .slice()
        .sort((a, b) => String(b.id).localeCompare(String(a.id)))
        .map((it) => ({
          id: it.id,
          date: it.date,
          mealType: it.mealType,
          name: it.name,
          quantity: it.quantity,
          kcal: it.kcal,
          protein: it.protein,
          fat: it.fat,
          carb: it.carb,
          image_uri: it.imagePath || null,
        }));

      setItems(rows);

      try {
        const w = await getWater(dateStr);
        setWater(Number(w?.glasses ?? 0));
      } catch {
        setWater(null);
      }
      try {
    const { data } = await api.get('/auth/me/water');
    // max แก้ว = ลิตรสูงสุด / 0.25 (ปัดใกล้สุด และอย่างน้อย 1)
    const maxGlasses = Math.max(
      1,
      Math.round(Number(data?.max_l_per_day ?? 2) / 0.25)
    );
    setWaterMax(maxGlasses);
  } catch (e) {
    // ถ้าดึงไม่สำเร็จ ใช้ค่าเดิม (เช่น 8)
  }
    } catch (e) {
      console.log("[History] loadByDate error:", e?.response?.data || e.message);
      setItems([]);
      setWater(null);
      Alert.alert("เกิดข้อผิดพลาด", "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isFocused && selectedDate) loadByDate(selectedDate);
  }, [isFocused]);

  /* ---------- Delete ---------- */
  function onDeletePress(id) {
    Alert.alert("ยืนยันการลบ", "คุณต้องการลบรายการนี้หรือไม่?", [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ลบ",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMeal(id);
            setItems((prev) => prev.filter((x) => x.id !== id));
            await deleteLocalMealIfExists(id);
            await loadByDate(selectedDate);
            Alert.alert("✅ ลบสำเร็จ", "ลบรายการอาหารเรียบร้อยแล้ว");
          } catch (e) {
            console.log("[History] delete error:", e?.response?.data || e.message);
            Alert.alert("เกิดข้อผิดพลาด", "ไม่สามารถลบรายการได้");
          }
        },
      },
    ]);
  }

  /* ---------- Render ---------- */
  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>ประวัติการกิน 🍱</Text>

      <Calendar
        markedDates={
          selectedDate
            ? { [selectedDate]: { selected: true, marked: true, selectedColor: "#2563EB" } }
            : {}
        }
        theme={{
          backgroundColor: "#fff",
          calendarBackground: "#fff",
          selectedDayBackgroundColor: "#2563EB",
          todayTextColor: "#EF4444",
          arrowColor: "#2563EB",
          monthTextColor: "#111827",
          textMonthFontWeight: "bold",
        }}
        onDayPress={(day) => {
          setSelectedDate(day.dateString);
          loadByDate(day.dateString);
        }}
        style={styles.calendar}
      />

      <View style={styles.section}>
  <Text style={styles.sectionTitle} numberOfLines={1} ellipsizeMode="tail">
    📅 สรุปรายสัปดาห์
  </Text>
  <TouchableOpacity
    onPress={() => navigation?.navigate?.("WeeklySummary")}
    style={styles.weeklyButton}
    activeOpacity={0.85}
  >
    <Ionicons name="stats-chart-outline" size={18} color="#fff" />
    <Text style={styles.weeklyButtonText}>ดูสรุปทั้งหมด</Text>
  </TouchableOpacity>
</View>



      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8, color: "#64748B" }}>กำลังโหลดข้อมูล...</Text>
        </View>
      ) : (
        <>
          <Text style={styles.dateTitle}>รายการวันที่ {selectedDate}</Text>

          {water != null && (
  <View style={styles.waterBox}>
    <Ionicons name="water-outline" size={18} color="#2563EB" />
    <Text style={styles.waterText}>
      ดื่มน้ำวันนี้: {water} / {waterMax} แก้ว
    </Text>
  </View>
)}


          <FlatList
            data={items}
            keyExtractor={(it) => String(it.id)}
            contentContainerStyle={{ paddingBottom: 100 }}
            renderItem={({ item }) => (
              <View style={styles.mealCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mealName}>
                    🍽 {item.mealType || "มื้ออื่นๆ"} - {item.name}
                  </Text>
                  <Text style={styles.macroText}>
                    kcal {item.kcal ?? 0} | P {item.protein ?? 0}g | F {item.fat ?? 0}g | C{" "}
                    {item.carb ?? 0}g
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => onDeletePress(item.id)}
                  style={styles.deleteBtn}
                  activeOpacity={0.85}
                >
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>ไม่มีข้อมูลในวันนี้ 💤</Text>
            }
          />
        </>
      )}
    </View>
  );
}

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", paddingTop: 40 },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    color: "#111827",
    marginBottom: 10,
  },
  calendar: {
    marginHorizontal: 12,
    borderRadius: 12,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 10,
  },
sectionTitle: {
   fontSize: 16,
   fontWeight: "700",
   color: "#111827",
   flex: 1,            // กินพื้นที่ซ้ายให้มากสุด
   marginRight: 12,    // กันชนกับปุ่ม
 },
   weeklyButton: {
    flexDirection: "row",
    backgroundColor: "#2563EB",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    gap: 6,
  },
  weeklyButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  dateTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 8,
  },
  waterBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
    padding: 10,
    marginHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
  },
  waterText: { color: "#1E40AF", fontWeight: "700", fontSize: 14 },
  mealCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginVertical: 5,
    padding: 14,
    borderRadius: 12,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  mealName: { fontWeight: "700", fontSize: 15, color: "#111827" },
  macroText: { color: "#6B7280", fontSize: 13, marginTop: 4 },
  deleteBtn: {
    backgroundColor: "#DC2626",
    padding: 8,
    borderRadius: 8,
  },
  center: { marginTop: 30, alignItems: "center" },
  emptyText: { textAlign: "center", color: "#9CA3AF", marginTop: 40, fontSize: 15 },
});
