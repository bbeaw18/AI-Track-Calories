import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Image, ActivityIndicator, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { auth, db } from "./firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

export default function Profile({ navigation }) {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (userDoc.exists()) {
          setUserData(userDoc.data());
        }
      }
      setLoading(false);
    };
    fetchUser();
  }, []);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#333" />
      </View>
    );
  }

  if (!userData) {
    return (
      <View style={styles.container}>
        <Text>ไม่พบข้อมูลผู้ใช้</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Image
        source={{ uri: userData.avatar || "" }}
        style={styles.avatar}
      />
      <Text style={styles.name}>{userData.name || "ไม่ระบุชื่อ"}</Text>
      <Text style={styles.email}>{userData.email || "ไม่ระบุอีเมล"}</Text>
      <View style={styles.infoRow}>
        <Ionicons name="person" size={18} color="#555" />
        <Text style={styles.infoText}>อายุ: {userData.age || "-"}</Text>
      </View>
      <View style={styles.infoRow}>
        <Ionicons name="fitness" size={18} color="#555" />
        <Text style={styles.infoText}>น้ำหนัก: {userData.weight || "-"} กก.</Text>
      </View>
      <View style={styles.infoRow}>
        <Ionicons name="body" size={18} color="#555" />
        <Text style={styles.infoText}>ส่วนสูง: {userData.height || "-"} ซม.</Text>
      </View>
      <View style={styles.infoRow}>
        <Ionicons name="walk" size={18} color="#555" />
        <Text style={styles.infoText}>
          การออกกำลังกาย: {userData.exercise === "low" ? "น้อย" : userData.exercise === "medium" ? "ปานกลาง" : userData.exercise === "high" ? "มาก" : "-"}
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Ionicons name="flag" size={18} color="#555" />
        <Text style={styles.infoText}>
          เป้าหมาย: {userData.goal === "maintain" ? "รักษาน้ำหนัก" : userData.goal === "lose" ? "ลดน้ำหนัก" : userData.goal === "gain" ? "เพิ่มกล้าม" : "-"}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.editBtn}
        onPress={() => navigation.navigate("EditProfile")}
      >
        <Ionicons name="create" size={18} color="#fff" />
        <Text style={{ color: "#fff", marginLeft: 6 }}>แก้ไขข้อมูล</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 16 },
  name: { fontSize: 22, fontWeight: "bold", marginBottom: 4 },
  email: { fontSize: 16, color: "#555", marginBottom: 16 },
  infoRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  infoText: { fontSize: 16, marginLeft: 8 },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#333",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 20,
  },
});