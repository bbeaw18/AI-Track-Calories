// FrontEnd/src/services/api.js
import axios from 'axios';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// 1) หา API URL จากหลายทาง → สุดท้าย fallback ตามแพลตฟอร์ม
const API_URL =
  // ใส่ไว้ที่ app.json -> expo.extra.API_URL ก็ได้
  Constants.expoConfig?.extra?.API_URL ||
  // หรือใช้ Expo env
  process.env.EXPO_PUBLIC_API_URL ||
  // สุดท้าย fallback
  (Platform.OS === 'android' ? 'http://10.0.2.2:5000' : 'http://localhost:5000');

console.log('BASE_URL =', API_URL); // <-- ควรเห็น http://10.0.2.2:5000 บน emulator

export const api = axios.create({
  baseURL: API_URL,
  timeout: 60000, // เผื่อโหลดโมเดลนานหน่อย
});

// ใส่ token อัตโนมัติทุกครั้ง
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ให้หน้าจอเรียกใช้ได้
export function setAuthToken(token) {
  if (token) api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete api.defaults.headers.common['Authorization'];
}

// ---------- AUTH ----------
export async function register(payload) {
  const { data } = await api.post('/auth/register', {
    email: String(payload?.email ?? '').trim().toLowerCase(),
    password: String(payload?.password ?? ''),
    displayName: payload?.displayName ?? null,
  });
  if (data?.accessToken) {
    await AsyncStorage.setItem('accessToken', data.accessToken);
    setAuthToken(data.accessToken);
  }
  return data;
}

export async function login(payload) {
  const email = String(payload?.email ?? '').trim().toLowerCase();
  const password = String(payload?.password ?? '');
  const { data } = await api.post('/auth/login', { email, password });
  if (data?.accessToken) {
    await AsyncStorage.setItem('accessToken', data.accessToken);
    setAuthToken(data.accessToken);
  }
  return data;
}

export async function logout() {
  await AsyncStorage.removeItem('accessToken');
  setAuthToken(null);
}

// ---------- AI / Nutrition / Meals ----------
export async function predictFood(formData) {
  // อย่าตั้ง Content-Type เอง ให้ axios ใส่ boundary ให้
  const { data } = await api.post('/ai/predict', formData);
  return data; // {label, confidence, imagePath}
}

export async function getNutritionByName(name) {
  const { data } = await api.get('/nutrition', { params: { name } });
  return data; // {name,kcal,protein,fat,carb}
}

export async function saveMeal(formData) {
  const { data } = await api.post('/meals', formData);
  return data; // {id}
}

export async function getMeals(date) {
  const { data } = await api.get('/meals', { params: { date } });
  return data; // { items, summary, perType }
}
