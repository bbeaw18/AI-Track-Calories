// FrontEnd/src/Login.js
import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, Alert, StyleSheet,
  TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { login as loginApi, setAuthToken } from './services/api';

export default function Login({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState({ email: '', password: '', server: '' });

  const emailValid = useMemo(() => /\S+@\S+\.\S+/.test(email.trim()), [email]);

  function normalizeToken(tok) {
    if (!tok) return null;
    return tok.startsWith('Bearer ') ? tok : `Bearer ${tok}`;
  }

  async function onLogin() {
    try {
      setErr({ email: '', password: '', server: '' });

      if (!email.trim()) return setErr((e) => ({ ...e, email: 'กรุณากรอกอีเมล' }));
      if (!emailValid)  return setErr((e) => ({ ...e, email: 'รูปแบบอีเมลไม่ถูกต้อง' }));
      if (!password.trim()) return setErr((e) => ({ ...e, password: 'กรุณากรอกรหัสผ่าน' }));

      setLoading(true);

      const res = await loginApi({
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });

      if (res?.requires2fa) {
        const userId   = res?.userId ?? res?.data?.userId ?? null;
        const tempTok  = res?.tempToken ?? res?.data?.tempToken ?? null;
        if (!userId || !tempTok) {
          throw new Error('missing userId/tempToken from login API (requires2fa)');
        }
        return navigation.navigate('TwoFA', { userId, tempToken: tempTok });
      }

      const user  = res?.user || res?.data?.user || res?.profile || null;
      const token = normalizeToken(res?.accessToken || res?.token || res?.data?.accessToken);
      if (!token) throw new Error('missing accessToken from login API');

      await AsyncStorage.setItem('accessToken', token);
      setAuthToken(token);

      const userId = user?.id ?? user?.UserID ?? null;
      if (userId) await AsyncStorage.setItem('userId', String(userId));
      await AsyncStorage.setItem('userEmail', (user?.email ?? email).trim().toLowerCase());

      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (e) {
      console.log('[Login] error:', e);
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e.message || 'เกิดข้อผิดพลาด';
      setErr((x) => ({ ...x, server: String(msg) }));
      Alert.alert('Login Error', String(msg));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', android: undefined })}
      style={{ flex: 1, backgroundColor: '#0F172A' }}
    >
      {/* Top header / brand */}
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Ionicons name="heart-outline" size={26} color="#0EA5E9" />
        </View>
        <View style={{ marginLeft: 10 }}>
          <Text style={styles.appName}>AI-Track-Cal</Text>
          <Text style={styles.appTag}>เข้าสู่ระบบเพื่อเริ่มติดตามสุขภาพของคุณ</Text>
        </View>
      </View>

      {/* Card */}
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>เข้าสู่ระบบ</Text>

          {/* Server error banner */}
          {!!err.server && (
            <View style={styles.errBanner}>
              <Ionicons name="alert-circle" size={18} color="#B91C1C" />
              <Text style={styles.errBannerText} numberOfLines={2}>{err.server}</Text>
            </View>
          )}

          {/* Email */}
          <Text style={styles.label}>อีเมล</Text>
          <View style={[styles.inputWrap, err.email && styles.inputError]}>
            <Ionicons name="mail-outline" size={18} color="#64748B" style={{ marginRight: 8 }} />
            <TextInput
              value={email}
              onChangeText={(t) => { setEmail(t); if (err.email) setErr((e)=>({...e, email:''})); }}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor="#9CA3AF"
            />
            {emailValid && !!email && (
              <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            )}
          </View>
          {!!err.email && <Text style={styles.errText}>{err.email}</Text>}

          {/* Password */}
          <Text style={[styles.label, { marginTop: 10 }]}>รหัสผ่าน</Text>
          <View style={[styles.inputWrap, err.password && styles.inputError]}>
            <Ionicons name="lock-closed-outline" size={18} color="#64748B" style={{ marginRight: 8 }} />
            <TextInput
              value={password}
              onChangeText={(t) => { setPassword(t); if (err.password) setErr((e)=>({...e, password:''})); }}
              secureTextEntry={!showPw}
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#9CA3AF"
            />
            <TouchableOpacity onPress={() => setShowPw((v) => !v)}>
              <Ionicons name={showPw ? 'eye-off' : 'eye'} size={20} color="#64748B" />
            </TouchableOpacity>
          </View>
          {!!err.password && <Text style={styles.errText}>{err.password}</Text>}

          {/* Primary button */}
          <TouchableOpacity
            style={[styles.loginBtn, loading && { opacity: 0.7 }]}
            onPress={onLogin}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : (
                <>
                  <Ionicons name="log-in-outline" size={18} color="#fff" />
                  <Text style={styles.loginBtnText}>เข้าสู่ระบบ</Text>
                </>
              )}
          </TouchableOpacity>

          {/* Links */}
          <View style={styles.linksRow}>
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.link}>สมัครสมาชิก</Text>
            </TouchableOpacity>
            <View style={styles.dot} />
            <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
              <Text style={styles.link}>ลืมรหัสผ่าน?</Text>
            </TouchableOpacity>
          </View>
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 54,
    paddingBottom: 20,
    paddingHorizontal: 22,
    backgroundColor: '#0F172A',
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoCircle: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#081426',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#0EA5E940',
  },
  appName: { color: '#E5E7EB', fontSize: 18, fontWeight: '800' },
  appTag: { color: '#93C5FD', fontSize: 12, marginTop: 2 },

  container: { flex: 1, backgroundColor: '#0F172A', paddingHorizontal: 18, paddingBottom: 28 },
  card: {
    backgroundColor: '#FFFFFF',
    marginTop: -10,
    borderRadius: 18,
    padding: 18,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },

  title: { fontSize: 22, fontWeight: '800', marginBottom: 12, color: '#111827' },

  errBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2',
    paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, marginBottom: 10,
  },
  errBannerText: { color: '#7F1D1D', flex: 1, fontSize: 12, fontWeight: '600' },

  label: { marginTop: 4, marginBottom: 6, color: '#334155', fontWeight: '700', fontSize: 13 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 12, backgroundColor: '#F8FAFC',
    height: 46,
  },
  input: { flex: 1, paddingVertical: 10, color: '#111827' },
  inputError: { borderColor: '#F43F5E', backgroundColor: '#FFF1F2' },
  errText: { color: '#e11d48', marginTop: 4, fontSize: 12 },

  loginBtn: {
    marginTop: 16,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  loginBtnText: { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 0.2 },

  linksRow: {
    marginTop: 14,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1' },
  link: { color: '#0EA5E9', fontWeight: '700' },

  footerNote: {
    color: '#93C5FD', textAlign: 'center', marginTop: 14, fontSize: 12,
  },
});
