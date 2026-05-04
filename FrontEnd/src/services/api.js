// FrontEnd/src/services/api.js
import axios from 'axios';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';



const BASE_URL =
  Constants?.expoConfig?.extra?.API_URL ||
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'android' ? 'http://192.168.1.37:5000' : 'http://localhost:5000');

console.log('BASE_URL =', BASE_URL);
export { BASE_URL };


export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 60000, 
});


const normBearer = (t) => (t && !String(t).startsWith('Bearer ') ? `Bearer ${t}` : t || null);


(async () => {
  try {
    const saved = await AsyncStorage.getItem('accessToken');
    const token = normBearer(saved);
    if (token) api.defaults.headers.common.Authorization = token;
  } catch {}
})();


api.interceptors.request.use(async (cfg) => {
  try {
    const saved = await AsyncStorage.getItem('accessToken');
    const token = normBearer(saved);
    if (token) cfg.headers.Authorization = token;
  } catch {}
  
  if (!(cfg.data instanceof FormData) && !cfg.headers['Content-Type']) {
    cfg.headers['Content-Type'] = 'application/json';
  }
  return cfg;
});


api.interceptors.response.use(
  (r) => r,
  async (err) => {
    if (err?.response?.status === 401) {
      const saved = await AsyncStorage.getItem('accessToken');
      if (!saved || !saved.startsWith('Bearer ')) {
        await AsyncStorage.removeItem('accessToken');
        delete api.defaults.headers.common.Authorization;
      }
    }
    return Promise.reject(err);
  }
);


export async function setAuthToken(rawToken) {
  const token = normBearer(rawToken);
  if (token) {
    api.defaults.headers.common.Authorization = token;
    await AsyncStorage.setItem('accessToken', token);
  } else {
    delete api.defaults.headers.common.Authorization;
    await AsyncStorage.removeItem('accessToken');
  }
}


export async function register(payload) {
  const body = {
    email: String(payload?.email ?? '').trim().toLowerCase(),
    password: String(payload?.password ?? ''),
    displayName: payload?.displayName ?? null,
    
    weight: payload?.weight ?? null,
    height: payload?.height ?? null,
    age: payload?.age ?? null,
    exercise: payload?.exercise ?? null, 
    goal: payload?.goal ?? null,         
    sex: payload?.sex ?? null,
    exercise_minutes_per_day: Number(payload.exercise_minutes_per_day || 0),
  };
  const { data } = await api.post('/auth/register', body);
  if (data?.accessToken) await setAuthToken(data.accessToken);
  return data;
}


export async function verifyRegister2FA({ userId, token, tempToken }) {
  const { data } = await api.post('/auth/register/verify-2fa', { userId, token, tempToken });
  if (data?.accessToken) await setAuthToken(data.accessToken);
  return data;
}


export async function checkLogin2FA({ userId, token, tempToken }) {
  const { data } = await api.post('/auth/2fa/check', { userId, token, tempToken });
  if (data?.accessToken) await setAuthToken(data.accessToken);
  return data;
}

export async function login({ email, password }) {
  const { data } = await api.post('/auth/login', {
    email: String(email || '').trim().toLowerCase(),
    password: String(password || ''),
  });
  if (data?.accessToken) await setAuthToken(data.accessToken);
  return data;
}

export async function logout() {
  try {
    await AsyncStorage.removeItem('accessToken');
    await AsyncStorage.removeItem('userId');
    await AsyncStorage.removeItem('userEmail');
  } catch {}
  await setAuthToken(null);
}

export async function getMyProfile() {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function updateMyProfile(patch) {
  const { data } = await api.put('/auth/me', patch);
  return data;
}


export async function predictFood(formData) {
  
  const { data } = await api.post('/ai/predict', formData);
  return data; 
}

export async function getNutritionByName(name) {
  const { data } = await api.get('/nutrition', { params: { name } });
  return data; 
}

export async function getMeals(date) {
  const { data } = await api.get('/meals', { params: { date } });
  return data; 
}

export async function addMeal(payloadOrForm) {
  const { data } = await api.post('/meals', payloadOrForm);
  return data;
}

export async function deleteMeal(id) {
  const { data } = await api.delete(`/meals/${id}`);
  return data;
}

export async function saveMeal(formData) {
  
  return addMeal(formData);
}


export async function getRecommendedFoods(params = {}) {
  const { data } = await api.get('/recommend', { params });
  return data;
}


export async function getWater(date) {
  const { data } = await api.get('/water', { params: { date } });
  return data; 
}

export async function putWater({ date, glasses, mlPerGlass = 250 }) {
  const { data } = await api.put('/water', { date, glasses, mlPerGlass });
  return data; 
}


export async function getMyNutrition(params = {}) {
  const { data } = await api.get('/auth/me/nutrition', { params });
  return data; 
}
export async function enableTwoFASetup({ userId, accountName, issuer }) {
  const { data } = await api.post('/2fa/setup', { userId, accountName, issuer });
  return data;
}

export async function verifyTwoFASetup({ userId, token }) {
  const { data } = await api.post('/2fa/verify-setup', { userId, token });
  return data;
}

export async function checkTwoFA({ userId, token, tempToken }) {
  const { data } = await api.post('/2fa/check', { userId, token, tempToken });
  
  if (data?.accessToken) await setAuthToken(data.accessToken);
  else if (data?.token)   await setAuthToken(data.token);
  return data;
}

export async function resetRequest(email) {
  const { data } = await api.post('/auth/reset/request', { email: String(email||'').trim().toLowerCase() });
  return data; 
}

export async function resetVerifyOtp({ userId, token, tempToken }) {
  const { data } = await api.post('/auth/reset/verify-otp', { userId, token, tempToken });
  return data; 
}

export async function resetConfirm({ resetToken, newPassword }) {
  const { data } = await api.post('/auth/reset/confirm', { resetToken, newPassword });
  return data; 
}
export async function getNutritionByNameLegacy(name) {
  const { data } = await api.get('/foods/by-name-legacy', { params: { q: name } });
  
  return data;
}
export async function upsertNfsFood({ name, qtyG, kcal, protein, fat, carb }) {
  const { data } = await api.post('/nfs/foods/upsert', {
    name,
    qtyG,
    kcal,
    p: protein,
    f: fat,
    c: carb,
  });
  return data; // { ok:true, foodId, action: 'inserted'|'updated' }
}
export async function getMyWaterAdvice() {
  const res = await api.get('/auth/me/water');
  return res.data;
}