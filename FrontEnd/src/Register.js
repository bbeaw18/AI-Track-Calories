// src/Register.js
import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet, Alert } from "react-native";
import { Picker } from "@react-native-picker/picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { register, setAuthToken } from "./services/api";

export default function Register({ navigation }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [exercise, setExercise] = useState("low");
  const [goal, setGoal] = useState("maintain");

  const handleRegister = async () => {
    if (!email || !password) return Alert.alert("Error", "ใส่อีเมลและรหัสผ่าน");

    try {
      // เรียก API backend
      const { user, accessToken } = await register({
        email: email.trim(),
        password,
        displayName: name,           // เก็บชื่อใน displayName
        weight: weight ? parseFloat(weight) : null,
        height: height ? parseFloat(height) : null,
        age:    age ? parseInt(age, 10) : null,
        exercise,
        goal,
      });

      // ✅ เก็บ token + ตั้ง Authorization header ให้ axios
      await AsyncStorage.setItem("accessToken", accessToken);
      setAuthToken(accessToken);
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });


      Alert.alert("สำเร็จ", "สมัครเรียบร้อย");
      // ไป Home โดยรีเซ็ต stack (กันย้อนกลับไปหน้า Login/Register)
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    } catch (err) {
      console.error(err);
      Alert.alert("Register Error", err?.response?.data?.error ?? err.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Register</Text>
      <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />
      <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <TextInput style={styles.input} placeholder="Weight (kg)" value={weight} onChangeText={setWeight} keyboardType="numeric" />
      <TextInput style={styles.input} placeholder="Height (cm)" value={height} onChangeText={setHeight} keyboardType="numeric" />
      <TextInput style={styles.input} placeholder="Age" value={age} onChangeText={setAge} keyboardType="numeric" />

      <Text>Exercise</Text>
      <Picker selectedValue={exercise} onValueChange={setExercise}>
        <Picker.Item label="น้อย" value="low" />
        <Picker.Item label="ปานกลาง" value="medium" />
        <Picker.Item label="มาก" value="high" />
      </Picker>

      <Text>Goal</Text>
      <Picker selectedValue={goal} onValueChange={setGoal}>
        <Picker.Item label="รักษาน้ำหนัก" value="maintain" />
        <Picker.Item label="ลดน้ำหนัก" value="lose" />
        <Picker.Item label="เพิ่มกล้าม" value="gain" />
      </Picker>

      <Button title="Register" onPress={handleRegister} />
      <Button title="Go to Login" onPress={() => navigation.navigate("Login")} />
    </View>
  );
}

const styles = StyleSheet.create({
  container:{flex:1, padding:20, justifyContent:"center"},
  title:{fontSize:20, textAlign:"center", marginBottom:10},
  input:{borderWidth:1, borderColor:"#ccc", padding:8, marginBottom:8, borderRadius:6}
});
