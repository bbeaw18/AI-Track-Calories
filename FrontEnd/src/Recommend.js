// frontend/src/recommend.js
import React, { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// สมมติว่านี่คือฟังก์ชันที่คุณใช้เพื่อดึงข้อมูลจากฐานข้อมูล SQLite
// ในการใช้งานจริง คุณต้องสร้างฟังก์ชันนี้ใน './services/api.js' เพื่อเชื่อมต่อกับ backend/SQLite
// ตัวอย่าง: const { getRecommendedFoods } = require('./services/api');

// ข้อมูลอาหารที่ดึงมาจากตาราง foods ในฐานข้อมูล
// เราจะเลือกอาหารบางส่วนที่มีในฐานข้อมูลเพื่อใช้เป็น Mock Data ที่มี Nutrients ครบถ้วน
const mockRecommendedFoods = [
  // ข้อมูลจากตาราง foods ที่มี NameTH, NameEng, EnergyKcal, ProteinG, FatG, CarbohydrateG
  { id: 1, name: 'ข้าวขาหมู', nameEng: 'Braised Pork Leg on Rice', kcal: 690, protein: 35.0, fat: 38.0, carb: 50.0, tags: ['High Fat', 'Popular'] },
  { id: 2, name: 'ส้มตำไทย', nameEng: 'Papaya Salad Thai', kcal: 65, protein: 3.0, fat: 0.5, carb: 12.0, tags: ['Low Cal', 'Clean Food'] },
  { id: 3, name: 'ข้าวผัดกุ้ง', nameEng: 'Shrimp Fried Rice', kcal: 500, protein: 25.0, fat: 15.0, carb: 65.0, tags: ['High Carb', 'Dinner'] },
  { id: 4, name: 'แกงเขียวหวานไก่', nameEng: 'Green Curry with Chicken', kcal: 370, protein: 30.0, fat: 18.0, carb: 20.0, tags: ['Spicy', 'Moderate Fat'] },
  { id: 5, name: 'ยำวุ้นเส้น', nameEng: 'Glass Noodle Salad', kcal: 180, protein: 18.0, fat: 3.0, carb: 20.0, tags: ['Healthy', 'Low Fat'] },
];

export default function RecommendScreen({ navigation }) {
  const [recommendations, setRecommendations] = useState(mockRecommendedFoods);
  const [loading, setLoading] = useState(false);

  // ฟังก์ชันสำหรับดึงข้อมูลแนะนำ (จำลองการดึง API)
  const fetchRecommendations = useCallback(async () => {
    try {
      setLoading(true);
      // ในการใช้งานจริง คุณจะเรียก API ที่ใช้ SQL Query กับตาราง foods:
      // const data = await getRecommendedFoods();
      // setRecommendations(data);

      // จำลองการโหลดและตั้งค่าข้อมูล
      await new Promise(resolve => setTimeout(resolve, 800));
      setRecommendations(mockRecommendedFoods);

    } catch (e) {
      Alert.alert("ข้อผิดพลาด", e.message || "ไม่สามารถดึงข้อมูลแนะนำได้");
    } finally {
      setLoading(false);
    }
  }, []);


  // Component สำหรับแสดงรายการอาหารแนะนำแต่ละรายการ
  const renderRecommendationItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <Text style={styles.foodName}>{item.name} ({item.nameEng})</Text>
        <View style={styles.tagContainer}>
          {item.tags.map((tag, index) => (
            <Text key={index} style={styles.tag}>{tag}</Text>
          ))}
        </View>
        <Text style={styles.macroText}>
          ⚡️ **{item.kcal} kcal** | P: {item.protein} g | F: {item.fat} g | C: {item.carb} g
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
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderRecommendationItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchRecommendations} />
        }
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>ไม่พบรายการอาหารแนะนำ</Text>
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
          <Text style={[styles.menuText, { color: '#007AFF', fontWeight: 'bold' }]}>Recommend</Text>
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
    paddingTop: 20 
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
  tagContainer: { flexDirection: 'row', flexWrap: 'wrap' },
  tag: {
    fontSize: 11,
    color: '#007AFF',
    backgroundColor: '#E1F5FE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    marginRight: 6,
    marginBottom: 4,
    fontWeight: '500'
  },
  addBtn: {
    backgroundColor: "#007AFF",
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    marginTop: 50,
  },
  emptyText: {
    fontSize: 18,
    color: '#888',
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
    height: 80, // เพิ่มความสูงเพื่อรองรับการวางตำแหน่ง
  },
  menuBtn: {
    alignItems: "center",
    flex: 1,
  },
  menuText: {
    fontSize: 12,
    color: "#555",
    marginTop: 2,
  },
});