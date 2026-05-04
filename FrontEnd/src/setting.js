// SettingsScreen.js
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  scheduleWaterRemindersSeconds,
  cancelAllWaterReminders,
  requestNotificationPermission,
  isWaterReminderEnabled,
  checkWaterGoalAndReschedule,
} from './services/notification'; // ✅ ปรับ path ให้ตรงกับไฟล์ที่ใช้อยู่
import { logout } from './services/api'; // ✅ path ภายในโปรเจกต์

function todayThailandISO() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const th = new Date(utc + 7 * 60 * 60 * 1000);
  const y = th.getFullYear();
  const m = String(th.getMonth() + 1).padStart(2, '0');
  const d = String(th.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function SettingsScreen({ navigation }) {
  const [enabled, setEnabled] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(10); // คง logic เดิม
  const [isUpdating, setIsUpdating] = useState(false);
  const today = todayThailandISO();

  const loadSettings = async () => {
    const active = await isWaterReminderEnabled();
    setEnabled(active);

    const saved = await AsyncStorage.getItem('waterReminderIntervalSeconds');
    if (saved) setIntervalSeconds(Number(saved));
  };

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      const init = async () => {
        if (!mounted) return;
        await loadSettings();
        await checkWaterGoalAndReschedule(today); // ✅ ส่งวันที่ให้ด้วย (ไม่กระทบ logic)
      };
      init();
      return () => { mounted = false; };
    }, [today])
  );

  const handleToggle = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      if (!enabled) {
        const granted = await requestNotificationPermission();
        if (!granted) {
          Alert.alert('ไม่ได้รับอนุญาต', 'กรุณาเปิดสิทธิ์การแจ้งเตือนใน Settings ของเครื่อง');
          return;
        }
        await cancelAllWaterReminders();
        await scheduleWaterRemindersSeconds(intervalSeconds);
        Alert.alert('เปิดแจ้งเตือนแล้ว', `จะเตือนทุก ${intervalSeconds} วินาที 💧`);
        setEnabled(true);
      } else {
        await cancelAllWaterReminders();
        Alert.alert('ปิดแจ้งเตือนแล้ว', 'ระบบจะไม่เตือนให้ดื่มน้ำ');
        setEnabled(false);
      }
    } catch (err) {
      console.warn('[Settings] toggle failed', err);
      Alert.alert('เกิดข้อผิดพลาด', 'ไม่สามารถตั้งค่าการแจ้งเตือนได้');
    } finally {
      setIsUpdating(false);
    }
  };

  const changeInterval = async (delta) => {
    // คง logic เดิม (แค่ตกแต่ง UI), จำกัดช่วง 1–600 วินาทีเหมือนเดิม
    const newVal = Math.max(1, Math.min(600, intervalSeconds + delta));
    setIntervalSeconds(newVal);
    await AsyncStorage.setItem('waterReminderIntervalSeconds', String(newVal));

    if (enabled) {
      await cancelAllWaterReminders();
      await scheduleWaterRemindersSeconds(newVal);
      Alert.alert('ตั้งเวลาใหม่แล้ว', `จะเตือนทุก ${newVal} วินาที 💧`);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.warn('Logout failed:', err);
    }
    navigation?.reset?.({ index: 0, routes: [{ name: 'Login' }] });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerBar}>
        <Ionicons name="settings-outline" size={20} color="#CBD5E1" />
        <Text style={styles.header}>ตั้งค่าแจ้งเตือนดื่มน้ำ</Text>
        <View style={{ width: 20 }} />
      </View>

      {/* Card */}
      <View style={styles.card}>
        {/* Toggle */}
        <View style={styles.settingItem}>
          <View style={styles.rowLeft}>
            <View style={styles.iconWrap}><Ionicons name="water-outline" size={18} color="#2563EB" /></View>
            <Text style={styles.itemText}>เปิดการแจ้งเตือน</Text>
          </View>
          <Switch value={enabled} onValueChange={handleToggle} />
        </View>

        {/* Interval controls */}
        <View style={styles.intervalSection}>
          <Text style={styles.intervalHeader}>ช่วงเวลาในการเตือน (วินาที)</Text>

          <View style={styles.controlRow}>
            <TouchableOpacity onPress={() => changeInterval(-10)} style={styles.smallBtn} disabled={isUpdating}>
              <Text style={styles.smallBtnText}>-10</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => changeInterval(-1)} style={styles.smallBtn} disabled={isUpdating}>
              <Text style={styles.smallBtnText}>-1</Text>
            </TouchableOpacity>

            <Text style={styles.valueText}>{intervalSeconds} วินาที</Text>

            <TouchableOpacity onPress={() => changeInterval(1)} style={styles.smallBtn} disabled={isUpdating}>
              <Text style={styles.smallBtnText}>+1</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => changeInterval(10)} style={styles.smallBtn} disabled={isUpdating}>
              <Text style={styles.smallBtnText}>+10</Text>
            </TouchableOpacity>
          </View>

          {/* ช็อตคัตความถี่ยอดนิยม (ไม่เปลี่ยน logic – แค่เรียก changeInterval ให้ไปถึงค่าเป้าหมาย) */}
          <View style={styles.presetRow}>
            {[10, 60, 300].map(preset => (
              <TouchableOpacity
                key={`preset-${preset}`}
                style={[
                  styles.presetBtn,
                  intervalSeconds === preset && { backgroundColor: '#2563EB' }
                ]}
                onPress={() => changeInterval(preset - intervalSeconds)}
                disabled={isUpdating}
              >
                <Text
                  style={[
                    styles.presetBtnText,
                    intervalSeconds === preset && { color: '#fff' }
                  ]}
                >
                  {preset}s
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.hintText}>
            * ใน Expo Go จะใช้การแจ้งเตือนจำลองและข้อความจะอัปเดตตามจำนวนแก้วที่ “ควรดื่ม/ดื่มแล้ว”
          </Text>
        </View>

        {/* Danger / Logout */}
        <View style={styles.divider} />
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={styles.logoutText}>ออกจากระบบ</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC', padding: 16 },
  headerBar: {
    backgroundColor: '#0F172A',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  header: { color: '#fff', fontSize: 18, fontWeight: '800', flex: 1 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingBottom: 14,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },

  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F7',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  iconWrap: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#DBEAFE',
    alignItems: 'center', justifyContent: 'center',
  },
  itemText: { fontSize: 16, color: '#111827', fontWeight: '600' },

  intervalSection: { paddingVertical: 14 },
  intervalHeader: { fontWeight: '700', marginBottom: 8, color: '#111827' },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  smallBtn: {
    backgroundColor: '#EEF2FF', paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#C7D2FE',
  },
  smallBtnText: { fontWeight: '800', color: '#1E3A8A' },
  valueText: { minWidth: 110, textAlign: 'center', fontWeight: '800', fontSize: 16, color: '#111827' },

  presetRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10 },
  presetBtn: {
    borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff',
    borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12,
  },
  presetBtnText: { color: '#111827', fontWeight: '700' },

  hintText: { marginTop: 8, fontSize: 12, color: '#6B7280', textAlign: 'center' },
  divider: { height: 1, backgroundColor: '#EEF2F7', marginTop: 6, marginBottom: 10 },

  logoutButton: {
    flexDirection: 'row', backgroundColor: '#DC2626', padding: 12,
    borderRadius: 10, justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  logoutText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
