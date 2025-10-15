// frontend/src/home.js
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getMeals, getMyNutrition } from "./services/api"; // ★ เพิ่ม getMyNutrition
import { useFocusEffect } from "@react-navigation/native";
import { PieChart } from "react-native-chart-kit";         // ★ กราฟ
import { useWindowDimensions } from "react-native";         // ★ ใช้ปรับขนาดกราฟตามหน้าจอ

export default function Home({ navigation }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { width } = useWindowDimensions();
  // ★ ย่อกราฟให้เล็กลง + เผื่อระยะขอบ
  const chartWidth = Math.min(width - 80, 260);

  const [water, setWater] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({
    date: today,
    kcal: 0,
    protein: 0,
    fat: 0,
    carb: 0,
  });
  const [meals, setMeals] = useState([
    { id: "breakfast", title: "มื้อเช้า", icon: "sunny", color: "#FFD580", kcal: 0 },
    { id: "lunch",     title: "มื้อกลางวัน", icon: "fast-food", color: "#FFB347", kcal: 0 },
    { id: "dinner",    title: "มื้อเย็น", icon: "moon", color: "#87CEFA", kcal: 0 },
    { id: "other",     title: "มื้ออื่นๆ", icon: "ice-cream", color: "#C3B1E1", kcal: 0 },
  ]);

  // ★ โภชนาการสำหรับกราฟ
  const [nutri, setNutri] = useState(null);
  const [nutriLoading, setNutriLoading] = useState(false);
  const [nutriErr, setNutriErr] = useState(null);

  const fetchMeals = useCallback(async () => {
    try {
      setLoading(true);
      const { summary: s, perType } = await getMeals(today);
      setSummary(s || { date: today, kcal: 0, protein: 0, fat: 0, carb: 0 });
      setMeals((m) => m.map((x) => ({ ...x, kcal: perType?.[x.id] ?? 0 })));
    } catch (e) {
      console.log("Fetch meals error:", e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  }, [today]);

  const fetchNutrition = useCallback(async () => {
    try {
      setNutriErr(null);
      setNutriLoading(true);
      const data = await getMyNutrition(); // ส่ง params override ได้ถ้าต้องการ
      setNutri(data);
    } catch (e) {
      setNutriErr(e?.response?.data?.error || e.message);
    } finally {
      setNutriLoading(false);
    }
  }, []);

  // โหลดทุกครั้งที่กลับมาหน้า Home
  useFocusEffect(
    useCallback(() => {
      fetchMeals();
      fetchNutrition(); // ★ โหลดโภชนาการด้วย
    }, [fetchMeals, fetchNutrition])
  );

  // ---------- เตรียมข้อมูลกราฟ ----------
  let pieData = [];
  let targetKcal = 0;
  let proteinG = 0, fatG = 0, carbsG = 0, proteinKcal = 0, fatKcal = 0, carbsKcal = 0;

  if (nutri) {
    proteinG = nutri?.macros?.protein_g ?? 0;
    fatG     = nutri?.macros?.fat_g ?? 0;
    carbsG   = nutri?.macros?.carbs_g ?? 0;

    proteinKcal = proteinG * 4;
    fatKcal     = fatG * 9;
    carbsKcal   = carbsG * 4;

    targetKcal = Math.round(
      nutri?.energy?.target_calories_kcal ?? (proteinKcal + fatKcal + carbsKcal)
    );

    pieData = [
      { name: "Protein", population: proteinKcal, color: "#4F46E5", legendFontColor: "#333", legendFontSize: 12 },
      { name: "Fat",     population: fatKcal,     color: "#F59E0B", legendFontColor: "#333", legendFontSize: 12 },
      { name: "Carbs",   population: carbsKcal,   color: "#10B981", legendFontColor: "#333", legendFontSize: 12 },
    ].filter(s => s.population > 0);
  }

  return (
    <View style={styles.container}>
      {/* ★ ทำหน้าเลื่อนขึ้นลงได้ */}
      <ScrollView
        contentContainerStyle={styles.scrollBody}
        refreshControl={
          <RefreshControl
            refreshing={loading || nutriLoading}
            onRefresh={() => { fetchMeals(); fetchNutrition(); }}
          />
        }
      >
        {/* ★ กราฟวงกลม: เป้าหมายโภชนาการต่อวัน */}
        <View style={styles.cardBox}>
          <Text style={styles.sectionTitle}>เป้าหมายโภชนาการต่อวัน</Text>

          {nutriLoading && !nutri ? (
            <View style={styles.centerRow}>
              <ActivityIndicator />
              <Text style={{ marginLeft: 8 }}>กำลังโหลด...</Text>
            </View>
          ) : nutriErr ? (
            <Text style={styles.err}>โหลดโภชนาการไม่สำเร็จ: {String(nutriErr)}</Text>
          ) : nutri ? (
            <>
              <Text style={styles.subtitle}>
                BMR ~ {Math.round(nutri.energy?.bmr_kcal ?? 0)} kcal •{" "}
                TDEE ~ {Math.round(nutri.energy?.tdee_kcal ?? 0)} kcal •{" "}
                Target ~ {targetKcal} kcal
              </Text>

              <View style={{ alignItems: "center", marginTop: 6 }}>
                <PieChart
                  data={pieData}
                  width={chartWidth}
                  height={chartWidth - 40}  // ★ ย่อความสูงลง
                  accessor="population"
                  backgroundColor="transparent"
                  paddingLeft="0"
                  center={[0, 0]}
                  absolute
                  hasLegend
                  chartConfig={{
                    backgroundGradientFrom: "#fff",
                    backgroundGradientTo: "#fff",
                    decimalPlaces: 0,
                    color: () => "#111",
                    labelColor: () => "#111",
                  }}
                />
              </View>

              <View style={{ marginTop: 6 }}>
                <Text>Protein: {Math.round(proteinG)} g ({Math.round(proteinKcal)} kcal)</Text>
                <Text>Fat: {Math.round(fatG)} g ({Math.round(fatKcal)} kcal)</Text>
                <Text>Carbs: {Math.round(carbsG)} g ({Math.round(carbsKcal)} kcal)</Text>
              </View>
            </>
          ) : (
            <Text style={{ marginTop: 6 }}>ยังไม่มีข้อมูลโภชนาการ</Text>
          )}
        </View>

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

        {/* FlatList ใช้แสดงรายการ แต่ปิดสกอร์ให้ ScrollView เลื่อนแทน */}
        <FlatList
          data={meals}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
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
      </ScrollView>

      {/* เมนูล่างคงเดิม */}
     <View style={styles.bottomMenu}>
  <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Home")}>
    <Ionicons name="home" size={24} color="#333" />
    <Text style={styles.menuText}>Home</Text>
  </TouchableOpacity>

  <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Recommend")}>
    <Ionicons name="star" size={24} color="#333" />
    <Text style={styles.menuText}>Recommend</Text>
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
  // ★ เพื่อให้เลื่อนพ้นเมนูล่าง
  scrollBody: { paddingBottom: 140 },

  // ★ การ์ดกราฟ
  cardBox: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  sectionTitle: { fontSize: 18, fontWeight: "700" },
  subtitle: { marginTop: 4, color: "#555" },
  centerRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  err: { color: "red", marginTop: 6 },

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
