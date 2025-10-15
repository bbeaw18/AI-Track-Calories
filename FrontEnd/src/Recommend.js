// FrontEnd/src/recommend.js
import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getRecommendedFoods } from "./services/api";

export default function RecommendScreen({ navigation }) {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const { items } = await getRecommendedFoods({ all: 1 }); // ★ ดึงทั้งหมด
      setRecommendations(items || []);
    } catch (e) {
      console.log("recommend error:", e?.response?.data || e.message);
      Alert.alert("ข้อผิดพลาด", e?.response?.data?.error || e.message || "ไม่สามารถดึงข้อมูลแนะนำได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const renderRecommendationItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <Text style={styles.foodName}>
          {item.name} {item.nameEng ? `(${item.nameEng})` : ""}
        </Text>

        {!!item.tags?.length && (
          <View style={styles.tagContainer}>
            {item.tags.map((tag, index) => (
              <Text key={`${item.id}-tag-${index}`} style={styles.tag}>
                {tag}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.macroText}>
          ⚡️ <Text style={{ fontWeight: "700" }}>{item.kcal} kcal</Text> | P: {item.protein} g | F: {item.fat} g | C: {item.carb} g
        </Text>
      </View>

      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => Alert.alert("เพิ่มอาหาร", `เพิ่ม ${item.name} เข้าสู่มื้ออาหารแล้ว!`)}
      >
        <Ionicons name="add" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>อาหารแนะนำสำหรับคุณ ✨</Text>
      <Text style={styles.subHeader}>รายการอาหารที่เหมาะกับเป้าหมายของคุณ</Text>

      <FlatList
        data={recommendations}
        keyExtractor={(item, idx) => String(item.id ?? idx)}
        renderItem={renderRecommendationItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchAll} />
        }
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {loading ? "กำลังโหลด..." : "ไม่พบรายการอาหารแนะนำ"}
            </Text>
          </View>
        )}
      />

      {/* Bottom Menu ที่เน้นปุ่ม Recommend */}
      <View style={styles.bottomMenu}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Home")}>
          <Ionicons name="home-outline" size={24} color="#555" />
          <Text style={styles.menuText}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Recommend")}>
          <Ionicons name="star" size={24} color="#007AFF" />
          <Text style={[styles.menuText, { color: "#007AFF", fontWeight: "bold" }]}>Recommend</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("History")}>
          <Ionicons name="list-outline" size={24} color="#555" />
          <Text style={styles.menuText}>ประวัติการกิน</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Profile")}>
          <Ionicons name="person-outline" size={24} color="#555" />
          <Text style={styles.menuText}>ผู้ใช้</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Settings")}>
          <Ionicons name="settings-outline" size={24} color="#555" />
          <Text style={styles.menuText}>ตั้งค่า</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9f9f9" },
  listContent: { padding: 20, paddingBottom: 100 },
  header: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  subHeader: {
    fontSize: 14,
    color: "#666",
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cardContent: { flex: 1, marginRight: 10 },
  foodName: { fontSize: 16, fontWeight: "600", marginBottom: 5, color: "#333" },
  macroText: { fontSize: 13, color: "#555", marginTop: 5 },
  tagContainer: { flexDirection: "row", flexWrap: "wrap" },
  tag: {
    fontSize: 11,
    color: "#007AFF",
    backgroundColor: "#E1F5FE",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    marginRight: 6,
    marginBottom: 4,
    fontWeight: "500",
  },
  addBtn: {
    backgroundColor: "#007AFF",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: { flex: 1, alignItems: "center", marginTop: 50 },
  emptyText: { fontSize: 18, color: "#888" },
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
    height: 80,
  },
  menuBtn: { alignItems: "center", flex: 1 },
  menuText: { fontSize: 12, color: "#555", marginTop: 2 },
});
