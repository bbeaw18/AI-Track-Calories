import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import AppNav from './src/nav';
import {
  setupAndroidChannel,
  requestNotificationPermission,
  checkWaterGoalAndReschedule,
} from './src/services/notification';

export default function App() {
  const [boot, setBoot] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const granted = await requestNotificationPermission();
        if (!granted) {
          console.warn('⚠️ ผู้ใช้ไม่อนุญาตให้แจ้งเตือน');
        }

        if (Platform.OS === 'android') {
          await setupAndroidChannel();
        }

        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });

        await AsyncStorage.getItem('accessToken');

        await checkWaterGoalAndReschedule();

        const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          console.log('📩 Notification tapped:', response);
          Alert.alert('📩 แจ้งเตือนถูกแตะ', 'คุณกดที่แจ้งเตือน!');
        });

        setBoot(false);

        return () => subscription.remove();
      } catch (err) {
        console.warn('[App] init failed', err);
        setBoot(false);
      }
    })();
  }, []);

  if (boot) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <AppNav />;
}
