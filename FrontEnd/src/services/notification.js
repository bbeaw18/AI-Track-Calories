// notifications/waterReminder.js
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/* ---------------------------- env / dynamic imports ---------------------------- */
const isExpoGo = Constants.appOwnership === 'expo';

// พยายาม require ให้ได้ทั้งสองกรณี (ขึ้นกับโครงสร้างโปรเจกต์)
let _getWater = null;
let _api = null;
try {
  const mod = require('../services/api');
  _getWater = mod.getWater;
  _api = mod.api;
} catch (_) {
  try {
    const mod = require('./services/api');
    _getWater = mod.getWater;
    _api = mod.api;
  } catch (_) {}
}

/* --------------------------------- handlers ---------------------------------- */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/* --------------------------------- helpers ----------------------------------- */
const KEY_ENABLED = 'waterReminderEnabled';
const KEY_INTERVAL = 'waterReminderIntervalSeconds';
const KEY_MOCK_GLASSES = 'mockWaterGlasses';
const KEY_MOCK_GOAL = 'mockWaterGoalGlasses';

let mockIntervalId = null;

const mlPerGlass = 250;

/** ปิงน้ำปัจจุบันจาก API ถ้าไม่ได้ก็ใช้ mock */
async function getWaterSafe(dateStr) {
  if (_getWater) {
    try {
      const res = await _getWater(dateStr);
      if (res && typeof res.glasses === 'number') return { glasses: res.glasses };
    } catch (_) {}
  }
  const saved = await AsyncStorage.getItem(KEY_MOCK_GLASSES);
  return { glasses: saved ? Number(saved) : 0 };
}

/** ดึง “เป้าเป็นจำนวนแก้ว/วัน” จาก /auth/me/water; ถ้าไม่ได้ให้ใช้ mock หรือ 8 แก้ว */
async function getGoalGlassesSafe() {
  // 1) ลอง API จริง
  if (_api) {
    try {
      const { data } = await _api.get('/auth/me/water');
      const maxL = Number(data?.max_l_per_day ?? NaN);
      if (Number.isFinite(maxL) && maxL > 0) {
        const goal = Math.max(1, Math.round(maxL / (mlPerGlass / 1000)));
        return goal;
      }
    } catch (_) {}
  }
  // 2) fallback mock (สำหรับ Expo Go)
  const saved = await AsyncStorage.getItem(KEY_MOCK_GOAL);
  if (saved) return Math.max(1, Number(saved));
  // 3) default
  return 8;
}

/** แจ้งเตือนทันที */
async function safeImmediateNotification(content) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        ...content,
      },
      trigger: null,
    });
  } catch (err) {
    console.warn('Immediate notification failed:', err);
  }
}

/* ------------------------------ public helpers ------------------------------- */
export async function __setMockWaterGlasses(n) {
  await AsyncStorage.setItem(KEY_MOCK_GLASSES, String(n));
}
export async function __setMockWaterGoal(n) {
  await AsyncStorage.setItem(KEY_MOCK_GOAL, String(n));
}

/* ------------------------------ channels/perm ------------------------------- */
export async function setupAndroidChannel() {
  if (Platform.OS === 'android' && !isExpoGo) {
    await Notifications.setNotificationChannelAsync('water-reminder', {
      name: 'Water Reminder',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2196F3',
    });
  }
}

export async function requestNotificationPermission() {
  if (isExpoGo) return true;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    console.warn('❌ ไม่ได้รับสิทธิ์แจ้งเตือน');
    return false;
  }
  await setupAndroidChannel();
  return true;
}

/* -------------------------------- scheduling -------------------------------- */
export async function scheduleWaterRemindersSeconds(intervalSeconds = 10) {
  await cancelAllWaterReminders();
  await AsyncStorage.setItem(KEY_ENABLED, 'true');
  await AsyncStorage.setItem(KEY_INTERVAL, String(intervalSeconds));

  if (isExpoGo) {
    startMockNotification(intervalSeconds);
    console.log(`🧪 Expo Go → แจ้งเตือนทุก ${intervalSeconds}s (dynamic goal)`);
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '💧 ถึงเวลาดื่มน้ำแล้ว!',
      body: 'อย่าลืมดื่มน้ำให้ครบตามเป้าหมายวันนี้นะ 💦',
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      channelId: 'water-reminder',
    },
    trigger: {
      seconds: Math.max(1, intervalSeconds),
      repeats: true,
    },
  });

  console.log(`✅ ตั้งแจ้งเตือนทุก ${intervalSeconds}s`);
}

export async function cancelAllWaterReminders() {
  if (mockIntervalId) {
    clearInterval(mockIntervalId);
    mockIntervalId = null;
    console.log('🚫 ยกเลิก mock interval แล้ว');
  }
  await Notifications.cancelAllScheduledNotificationsAsync();
  await AsyncStorage.setItem(KEY_ENABLED, 'false');
  console.log('🚫 ยกเลิกแจ้งเตือนทั้งหมดแล้ว');
}

export async function isWaterReminderEnabled() {
  const val = await AsyncStorage.getItem(KEY_ENABLED);
  return val === 'true';
}

/** ตรวจปริมาณที่ดื่มและเป้า (แบบไดนามิก) แล้วตั้ง/ยกเลิกใหม่ให้ถูกต้อง */
export async function checkWaterGoalAndReschedule(dateStr) {
  try {
    const enabled = await isWaterReminderEnabled();
    if (!enabled) return;

    const raw = await AsyncStorage.getItem(KEY_INTERVAL);
    const interval = raw ? Number(raw) : 10;

    const [{ glasses }, goalGlasses] = await Promise.all([
      getWaterSafe(dateStr),
      getGoalGlassesSafe(),
    ]);

    if (glasses >= goalGlasses) {
      await cancelAllWaterReminders();
      console.log(`🎉 ดื่มครบแล้ว → ยกเลิกแจ้งเตือน (เป้า ${goalGlasses} แก้ว)`);
    } else {
      await scheduleWaterRemindersSeconds(interval);
      console.log(`🔁 ตั้งแจ้งเตือนใหม่ทุก ${interval}s (ดื่ม ${glasses}/${goalGlasses} แก้ว)`);
    }
  } catch (err) {
    console.warn('[Notification] checkWaterGoalAndReschedule failed', err);
  }
}

/* ---------------------------------- mock ------------------------------------ */
function startMockNotification(intervalSeconds = 10) {
  if (mockIntervalId) clearInterval(mockIntervalId);

  mockIntervalId = setInterval(async () => {
    try {
      const [{ glasses }, goalGlasses] = await Promise.all([
        getWaterSafe(),
        getGoalGlassesSafe(),
      ]);

      if (glasses >= goalGlasses) {
        await cancelAllWaterReminders();
        await safeImmediateNotification({
          title: '🎉 เยี่ยมมาก!',
          body: `คุณดื่มน้ำครบ ${goalGlasses} แก้วแล้ว 💧`,
        });
        return;
      }

      await safeImmediateNotification({
        title: '💧 ถึงเวลาดื่มน้ำแล้ว!',
        body: `วันนี้ดื่มไปแล้ว ${glasses}/${goalGlasses} แก้ว`,
      });

      console.log(`🔔 Mock แจ้งเตือน → ${glasses}/${goalGlasses} แก้ว`);
    } catch (e) {
      console.warn('[MockNotify] error', e);
    }
  }, Math.max(1, intervalSeconds) * 1000);
}
