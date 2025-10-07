// App.js
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppNav from './src/nav';

export default function App() {
  const [boot, setBoot] = useState(true);

  useEffect(() => {
    (async () => {
      await AsyncStorage.getItem('accessToken'); // แค่ preload token
      setBoot(false);
    })();
  }, []);

  if (boot) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <AppNav />;
}
