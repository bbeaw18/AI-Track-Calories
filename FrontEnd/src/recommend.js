import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  RefreshControl, TouchableOpacity, Alert, Modal, TextInput
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getRecommendedFoods, addMeal, getMeals, getNutritionByName } from "./services/api";

function todayThailandISO() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const th = new Date(utc + 7 * 60 * 60 * 1000);
  const y = th.getFullYear();
  const m = String(th.getMonth() + 1).padStart(2, "0");
  const d = String(th.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function RecommendScreen({ navigation }) {
  const today = todayThailandISO();
  const [loading, setLoading] = useState(false);
  const [recommended, setRecommended] = useState([]);
  const [localFoods, setLocalFoods] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedFood, setSelectedFood] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const fetchRecommended = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getRecommendedFoods({ all: 1 });
      setRecommended(res?.items ?? []);
    } catch (e) {
      console.log("load recommend error:", e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLocalFoods = useCallback(async () => {
    try {
      const data = await getMeals(today);
      const items = Array.isArray(data?.items) ? data.items : [];
      const byName = new Map();
      for (const it of items) {
        const key = it.name || "(ไม่มีชื่อ)";
        const prev = byName.get(key) || { name: key, kcal: 0 };
        prev.kcal += Number(it.kcal) || 0;
        byName.set(key, prev);
      }
      const top = Array.from(byName.values())
        .sort((a,b) => b.kcal - a.kcal)
        .slice(0, 5)
        .map((x, i) => ({ FoodID: i+1, FoodName: x.name, kcal: x.kcal }));
      setLocalFoods(top);
    } catch (e) {
      console.log("[Recommend] fetchLocalFoods error:", e?.response?.data || e.message);
    }
  }, [today]);

  const addFoodToMeal = useCallback(async (food, mealType) => {
    try {
      let qty = Number(food?.serving) > 0 ? Number(food.serving) : null;

      if (!qty) {
        try {
          const nut = await getNutritionByName(food?.name);
          const s = nut?.ServingSizeGram ?? nut?.serving ?? null;
          if (Number(s) > 0) qty = Number(s);
        } catch (e) {
          console.log("[Recommend] getNutritionByName error:", e?.response?.data || e.message);
        }
      }

      if (!qty || !Number.isFinite(qty) || qty <= 0) qty = 100;

      await addMeal({
        date: today,
        mealType,
        name: food?.name || null,
        quantity: qty,
        unit: "g",
        kcal: Number(food?.kcal) || 0,
        protein: Number(food?.protein) || 0,
        fat: Number(food?.fat) || 0,
        carb: Number(food?.carb) || 0,
      });

      Alert.alert("✅ เพิ่มสำเร็จ", `บันทึก "${food?.name}" ในมื้อ${mealType} แล้ว`);
      setShowModal(false);
      setSelectedFood(null);
      fetchLocalFoods();
    } catch (e) {
      console.log("[Recommend] addMeal error:", e?.response?.data || e.message);
      Alert.alert("❌ บันทึกไม่สำเร็จ", String(e?.response?.data?.error || e.message));
    }
  }, [today, fetchLocalFoods]);

  useEffect(() => {
    fetchRecommended();
    fetchLocalFoods();
  }, [fetchRecommended, fetchLocalFoods]);

  const filteredRecommended = search.trim()
    ? recommended.filter(
        (item) =>
          (item.name || "").toLowerCase().includes(search.trim().toLowerCase())
      )
    : recommended;

  const Header = (
    <>
      {/* Top header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIconWrap}>
            <Ionicons name="sparkles-outline" size={18} color="#1E40AF" />
          </View>
          <View>
            <Text style={styles.headerTitle}>เมนูแนะนำสำหรับคุณ</Text>
            <Text style={styles.headerSub}>อัปเดตตามโภชนาการและพฤติกรรมล่าสุด</Text>
          </View>
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.refreshBtn}
          onPress={fetchRecommended}
        >
          <Ionicons name="refresh" size={18} color="#1E40AF" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color="#64748B" />
        <TextInput
          style={styles.searchInput}
          placeholder="ค้นหาชื่ออาหาร เช่น ข้าวผัด ไข่ต้ม สลัด..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {search?.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.title}>🍽️ อาหารที่ระบบแนะนำ</Text>
        {loading && <ActivityIndicator />}
      </View>
    </>
  );

  const Footer = (
    <>
      <Text style={[styles.title, { marginTop: 18 }]}>🕒 อาหารยอดนิยมของคุณ</Text>
      {localFoods.length === 0 ? (
        <Text style={styles.noData}>ยังไม่มีข้อมูลอาหารที่บันทึกไว้</Text>
      ) : (
        localFoods.map((f, i) => (
          <View key={`${String(f.FoodID ?? 'food')}-${i}`} style={styles.localRow}>
            <Text style={styles.localLeft}>{i + 1}. {f.FoodName}</Text>
            <Text style={styles.localRight}>{Math.round(f.kcal)} kcal</Text>
          </View>
        ))
      )}
      <View style={{ height: 20 }} />
    </>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredRecommended}
        keyExtractor={(item, idx) => String(item.id ?? idx)}
        ListHeaderComponent={Header}
        ListFooterComponent={Footer}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchRecommended} />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Ionicons name="restaurant" size={20} color="#F59E0B" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.foodName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.foodSub} numberOfLines={2}>
                {item.kcal ?? "?"} kcal · โปรตีน {item.protein ?? 0} g · ไขมัน {item.fat ?? 0} g · คาร์บ {item.carb ?? 0} g
              </Text>

              <View style={styles.badgesRow}>
                
                {!!item?.kcal && item.kcal < 300 && (
                  <View style={[styles.badge, { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" }]}>
                    <Ionicons name="leaf-outline" size={12} color="#4F46E5" />
                    <Text style={[styles.badgeText, { color: "#3730A3" }]}>พลังงานต่ำ</Text>
                  </View>
                )}
              </View>
            </View>

            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => { setSelectedFood(item); setShowModal(true); }}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>เพิ่ม</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyBox}>
              <Ionicons name="nutrition-outline" size={26} color="#94A3B8" />
              <Text style={styles.emptyText}>ยังไม่มีคำแนะนำ ลองรีเฟรชอีกครั้ง</Text>
            </View>
          ) : null
        }
      />

      {/* Modal: เลือกมื้ออาหาร */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>เลือกมื้ออาหารสำหรับ</Text>
            <Text style={styles.modalFood}>{selectedFood?.name}</Text>
            {["breakfast", "lunch", "dinner", "other"].map((m) => (
              <TouchableOpacity
                key={`meal-${m}`}
                style={styles.mealBtn}
                onPress={() => addFoodToMeal(selectedFood, m)}
                activeOpacity={0.9}
              >
                <Text style={styles.mealText}>
                  {m === "breakfast" ? "☀️ มื้อเช้า" :
                   m === "lunch" ? "🍛 มื้อกลางวัน" :
                   m === "dinner" ? "🌙 มื้อเย็น" : "🍩 มื้ออื่นๆ"}
                </Text>
                <Ionicons name="chevron-forward" size={18} color="#fff" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.cancelBtn]} onPress={() => setShowModal(false)}>
              <Ionicons name="close" size={16} color="#111827" />
              <Text style={styles.cancelText}>ยกเลิก</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---------------- Styles ---------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", paddingHorizontal: 14, paddingTop: 10 },

  /* Header */
  header: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  headerIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "#E0EAFF", borderWidth: 1, borderColor: "#BFDBFE",
    alignItems: "center", justifyContent: "center"
  },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  headerSub: { color: "#CBD5E1", fontSize: 12, marginTop: 2 },
  refreshBtn: {
    backgroundColor: "#E5E7EB", paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: "#CBD5E1"
  },

  /* Search */
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12
  },
  searchInput: { flex: 1, color: "#111827", fontSize: 15 },

  /* Section title row */
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  title: { fontSize: 18, fontWeight: "800", color: "#111827" },

  /* Card */
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: "#EEF2F7",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  cardIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "#FFF7ED", borderColor: "#FFE4D3", borderWidth: 1,
    alignItems: "center", justifyContent: "center"
  },
  foodName: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
  foodSub: { fontSize: 12.5, color: "#6B7280", marginTop: 2 },

  badgesRow: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1
  },
  badgeText: { fontSize: 11.5, fontWeight: "700" },

  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6
  },
  addBtnText: { color: "#fff", fontWeight: "700" },

  /* Local foods */
  localRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#EEF2F7",
    marginBottom: 8
  },
  localLeft: { color: "#111827", fontWeight: "600" },
  localRight: { color: "#6B7280", fontWeight: "700" },
  noData: { color: "#9CA3AF", fontStyle: "italic", marginTop: 6 },

  /* Empty */
  emptyBox: { alignItems: "center", paddingVertical: 30 },
  emptyText: { color: "#94A3B8", marginTop: 6 },

  /* Modal */
  modalOverlay: {
    flex: 1, justifyContent: "center", alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)"
  },
  modalBox: {
    backgroundColor: "#fff", borderRadius: 16, padding: 18, width: "86%",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 6
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  modalFood: { fontSize: 14, color: "#374151", marginBottom: 12, marginTop: 2 },

  mealBtn: {
    backgroundColor: "#2563EB",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginVertical: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12
  },
  mealText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  cancelBtn: {
    backgroundColor: "#F3F4F6",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6
  },
  cancelText: { color: "#111827", fontWeight: "700" }
});
