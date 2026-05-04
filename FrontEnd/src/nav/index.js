// FrontEnd/src/navigation/AppNav.js  (
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import Login from '../Login';
import Register from '../Register';
import Home from '../Home';
import UploadFood from '../UploadFood';
import History from '../History';
import RecommendScreen from '../Recommend';
import ProfileScreen from '../Profile';
import EditProfileScreen from '../EditProfileScreen';
import WeeklySummary from '../WeeklySummary';
import SettingsScreen from '../Setting';
import Setup2FA from '../Setup2FA';
import TwoFA from '../TwoFAScreen';
import ForgotPassword from '../ForgotPassword';
import VerifyResetOTP from '../VerifyResetOTP';
import ResetPassword from '../ResetPassword';
const Stack = createNativeStackNavigator();

export default function AppNav() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" component={Login} />
        <Stack.Screen name="Register" component={Register} />
      
        <Stack.Screen name="Setup2FA" component={Setup2FA} options={{ title: "Setup 2FA" }} />
        <Stack.Screen name="TwoFA" component={TwoFA} options={{ title: "Two-Factor" }} />

        <Stack.Screen name="Home" component={Home} />
        <Stack.Screen name="UploadFood" component={UploadFood} />
        <Stack.Screen name="History" component={History} />
        <Stack.Screen name="Recommend" component={RecommendScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        <Stack.Screen name="WeeklySummary" component={WeeklySummary} />
        <Stack.Screen name="Setting" component={SettingsScreen} />
        <Stack.Screen name="ForgotPassword" component={ForgotPassword} options={{ title: "Forgot Password" }} />
<Stack.Screen name="VerifyResetOTP" component={VerifyResetOTP} options={{ title: "Verify OTP" }} />
<Stack.Screen name="ResetPassword" component={ResetPassword} options={{ title: "Reset Password" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
