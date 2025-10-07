// src/firebaseConfig.js
import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  getReactNativePersistence,
} from "firebase/auth";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// 👇 ใส่ค่าของคุณเองจาก Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyClEZjINccXx1llpyRQwpI_fGcPb89NxOU",
  authDomain: "calapp-6851f.firebaseapp.com",
  projectId: "calapp-6851f",
  storageBucket: "calapp-6851f.firebasestorage.app",
  messagingSenderId: "836889409305",
  appId: "1:836889409305:web:eb6d36e4dbe4c49e34b788",
  measurementId: "G-YRK71F1ZZG"
};

// init
const app = initializeApp(firebaseConfig);

// ✅ ใช้ initializeAuth + AsyncStorage persistence
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage),
});

export const db = getFirestore(app);
export const storage = getStorage(app);
