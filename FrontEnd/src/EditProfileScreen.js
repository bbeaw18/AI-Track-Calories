// screens/EditProfileScreen.js
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { api } from "./services/api";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function EditProfileScreen({ route, navigation }) {
  const { user } = route.params || {};

  const [form, setForm] = useState({
    displayName: user?.displayName || "",
    sex: user?.sex || "male",
    age: String(user?.age || ""),
    weight: String(user?.weight || ""),
    height: String(user?.height || ""),
    exercise: String(user?.exercise || "1.2"),
    goal: user?.goal || "maintain",
    exercise_minutes_per_day: String(user?.exercise_minutes_per_day ?? "0"),
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (key, value) => setForm({ ...form, [key]: value });

  const handleSave = async () => {
    try {
      setSaving(true);
      const token = await AsyncStorage.getItem("accessToken");
      const { data } = await api.put(
        "/auth/me",
        {
          displayName: form.displayName,
          sex: form.sex,
          age: form.age ? Number(form.age) : null,
          weight: form.weight ? Number(form.weight) : null,
          height: form.height ? Number(form.height) : null,
          exercise: form.exercise ? Number(form.exercise) : null,
          goal: form.goal,
          exercise_minutes_per_day:
            form.exercise_minutes_per_day !== "" &&
            form.exercise_minutes_per_day !== null
              ? Number(form.exercise_minutes_per_day)
              : null,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (data?.ok) {
        Alert.alert("✅ สำเร็จ", "อัปเดตข้อมูลเรียบร้อยแล้ว", [
          { text: "ตกลง", onPress: () => navigation.goBack() },
        ]);
      } else {
        throw new Error("ไม่สามารถอัปเดตข้อมูลได้");
      }
    } catch (err) {
      console.log("Update error:", err?.response?.data || err.message);
      Alert.alert("เกิดข้อผิดพลาด", err?.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>แก้ไขข้อมูลส่วนตัว</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* ชื่อ */}
        <Field label="ชื่อที่แสดง" icon="person-outline">
          <TextInput
            style={styles.input}
            value={form.displayName}
            onChangeText={(t) => handleChange("displayName", t)}
            placeholder="เช่น Alex"
            placeholderTextColor="#9CA3AF"
          />
        </Field>

        {/* เพศ */}
        <Field label="เพศ" icon="male-female-outline">
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={form.sex}
              onValueChange={(v) => handleChange("sex", v)}
            >
              <Picker.Item label="ชาย (Male)" value="male" />
              <Picker.Item label="หญิง (Female)" value="female" />
            </Picker>
          </View>
        </Field>

        {/* อายุ/น้ำหนัก/ส่วนสูง */}
        <View style={styles.row}>
          <SmallField label="อายุ" icon="hourglass-outline">
            <TextInput
              style={styles.input}
              value={form.age}
              onChangeText={(t) => handleChange("age", t)}
              keyboardType="numeric"
              placeholder="ปี"
              placeholderTextColor="#9CA3AF"
            />
          </SmallField>
          <SmallField label="น้ำหนัก (kg)" icon="scale-outline">
            <TextInput
              style={styles.input}
              value={form.weight}
              onChangeText={(t) => handleChange("weight", t)}
              keyboardType="numeric"
              placeholder="เช่น 70"
              placeholderTextColor="#9CA3AF"
            />
          </SmallField>
        </View>
        <SmallField label="ส่วนสูง (cm)" icon="body-outline">
          <TextInput
            style={styles.input}
            value={form.height}
            onChangeText={(t) => handleChange("height", t)}
            keyboardType="numeric"
            placeholder="เช่น 175"
            placeholderTextColor="#9CA3AF"
          />
        </SmallField>

        {/* เวลาออกกำลังกาย */}
        <Field label="เวลาการออกกำลังกาย (นาที/วัน)" icon="timer-outline">
          <TextInput
            style={styles.input}
            value={form.exercise_minutes_per_day}
            onChangeText={(t) => handleChange("exercise_minutes_per_day", t)}
            keyboardType="numeric"
            placeholder="เช่น 30, 60, 90"
            placeholderTextColor="#9CA3AF"
          />
        </Field>

        {/* ระดับการออกกำลังกาย */}
        <Field label="ระดับการออกกำลังกาย" icon="barbell-outline">
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={form.exercise}
              onValueChange={(v) => handleChange("exercise", v)}
            >
              <Picker.Item label="แทบไม่ออกกำลังกาย (Sedentary)" value="1.2" />
              <Picker.Item
                label="ออกกำลังกายเล็กน้อย (1-3 วัน/สัปดาห์)"
                value="1.375"
              />
              <Picker.Item
                label="ออกกำลังกายปานกลาง (3-5 วัน/สัปดาห์)"
                value="1.55"
              />
              <Picker.Item
                label="ออกกำลังกายสม่ำเสมอ (6-7 วัน/สัปดาห์)"
                value="1.725"
              />
              <Picker.Item label="ออกกำลังกายหนัก / นักกีฬา" value="1.9" />
            </Picker>
          </View>
        </Field>

        {/* เป้าหมาย */}
        <Field label="เป้าหมาย" icon="flag-outline">
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={form.goal}
              onValueChange={(v) => handleChange("goal", v)}
            >
              <Picker.Item label="รักษาน้ำหนัก" value="maintain" />
              <Picker.Item label="ลดน้ำหนัก" value="lose" />
              <Picker.Item label="เพิ่มกล้าม" value="gain" />
            </Picker>
          </View>
        </Field>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { backgroundColor: "#9CA3AF" }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.9}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="save-outline" size={20} color="#fff" />
              <Text style={styles.saveText}>บันทึก</Text>
            </>
          )}
        </TouchableOpacity>

    
      </ScrollView>
    </View>
  );
}

/* ---------- Reusable UI wrappers ---------- */
const Field = ({ label, icon, children }) => (
  <View style={styles.fieldCard}>
    <View style={styles.fieldHeader}>
      <View style={styles.fieldIcon}>
        <Ionicons name={icon} size={16} color="#334155" />
      </View>
      <Text style={styles.fieldLabel}>{label}</Text>
    </View>
    {children}
  </View>
);

const SmallField = ({ label, icon, children }) => (
  <View style={[styles.fieldCard, { flex: 1 }]}>
    <View style={styles.fieldHeader}>
      <View style={styles.fieldIcon}>
        <Ionicons name={icon} size={16} color="#334155" />
      </View>
      <Text style={styles.fieldLabel}>{label}</Text>
    </View>
    {children}
  </View>
);

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
  header: {
    backgroundColor: "#111827",
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },

  container: { padding: 16, paddingBottom: 40 },

  row: { flexDirection: "row", gap: 10 },

  fieldCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fieldHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  fieldIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#475569" },

  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: "#fff",
    color: "#0F172A",
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 10,
    backgroundColor: "#fff",
    overflow: "hidden",
  },

  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2563EB",
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 6,
  },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  tipCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderColor: "#DBEAFE",
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
  },
  tipText: { color: "#1D4ED8", fontSize: 13, flex: 1 },
});
