// FrontEnd/src/Login.js
import React, { useState } from 'react';
import { View, Text, TextInput, Button, Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { login as loginApi } from './services/api';   // ใช้ alias กันชนชื่อ

export default function Login({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    try {
      if (!email || !password) return Alert.alert('กรุณากรอกอีเมลและรหัสผ่าน');
      setLoading(true);
      await loginApi({ email: email.trim().toLowerCase(), password: password.trim() });
      navigation.navigate('Home');
      
    } catch (e) {
      Alert.alert('Login Error', e?.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>

      <Text style={styles.label}>Email</Text>
      <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} />

      <Text style={styles.label}>Password</Text>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />

      <View style={{ height: 12 }} />
      <Button title={loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'} onPress={onLogin} disabled={loading} />

      <View style={{ height: 16 }} />
      <TouchableOpacity onPress={() => navigation.navigate('Register')}>
        <Text style={styles.link}>ยังไม่มีบัญชี? สมัครสมาชิก</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  label: { marginTop: 8, marginBottom: 4, color: '#333' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  link: { color: '#0a84ff', textAlign: 'center' },
});
