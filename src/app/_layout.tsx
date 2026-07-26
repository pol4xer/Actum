import { DarkTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { OnboardingScreen } from '@/screens/onboarding-screen';
import { Palette } from '@/constants/theme';
import { configureNotificationHandler } from '@/lib/notifications';
import { AppProvider, useApp } from '@/state/app-context';

SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

const actumTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Palette.gold,
    background: Palette.ink,
    card: Palette.inkRaised,
    text: Palette.text,
    border: Palette.line,
    notification: Palette.danger,
  },
};

export default function RootLayout() {
  return (
    <AppProvider>
      <ThemeProvider value={actumTheme}>
        <StatusBar style="light" />
        <AppTabs />
        <AppOverlay />
      </ThemeProvider>
    </AppProvider>
  );
}

function AppOverlay() {
  const { isHydrated, state } = useApp();

  useEffect(() => {
    if (isHydrated) SplashScreen.hideAsync();
  }, [isHydrated]);

  if (!isHydrated) {
    return (
      <View style={styles.overlay}>
        <ActivityIndicator color={Palette.gold} />
      </View>
    );
  }

  if (!state.onboardingCompleted) {
    return (
      <View style={styles.overlay}>
        <OnboardingScreen />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    flex: 1,
    backgroundColor: Palette.ink,
    justifyContent: 'center',
  },
});
