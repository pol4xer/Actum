import { DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { ThemedText } from '@/components/themed-text';
import { AppButton, Pill } from '@/components/ui/primitives';
import { OnboardingScreen } from '@/features/onboarding';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { configureNotificationHandler } from '@/lib/notifications';
import { AppProvider, useApp } from '@/state';

SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

const actumTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
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
        <StatusBar style="dark" />
        <AppTabs />
        <AppOverlay />
      </ThemeProvider>
    </AppProvider>
  );
}

function AppOverlay() {
  const {
    hydrationIssue,
    isHydrated,
    resetProgress,
    retryPersistence,
    state,
  } = useApp();

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

  if (hydrationIssue) {
    const canRetry = hydrationIssue.reason === 'storage-error';
    return (
      <View style={styles.overlay}>
        <View style={styles.storageCard}>
          <Pill tone="danger">local journal not saved</Pill>
          <ThemedText type="title">
            {canRetry ? 'Actum cannot save your data' : 'Local journal is corrupted'}
          </ThemedText>
          <ThemedText style={styles.storageCopy}>
            {canRetry
              ? 'Actum has paused to protect your timers, results, and comments from being lost.'
              : 'Actum has preserved the original data without overwriting it. Reset the damaged local journal to continue.'}
          </ThemedText>
          <AppButton
            label={canRetry ? 'Retry saving locally' : 'Reset damaged journal'}
            variant={canRetry ? 'secondary' : 'danger'}
            onPress={async () => {
              if (canRetry) await retryPersistence();
              else await resetProgress();
            }}
          />
        </View>
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
    padding: Spacing.three,
  },
  storageCard: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.large,
    borderWidth: 1,
    borderColor: 'rgba(215, 0, 21, 0.24)',
    backgroundColor: Palette.surface,
  },
  storageCopy: { color: Palette.textMuted },
});
