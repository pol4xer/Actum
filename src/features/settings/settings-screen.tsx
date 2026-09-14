import { useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { HeroSigil } from '@/components/hero-sigil';
import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { AppButton, Card, Pill, Screen, ScreenHeader } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { DevToolsSection } from '@/features/dev-tools';
import { disableDailyReminder, enableDailyReminder } from '@/lib/notifications';
import type { ContextInfoSection } from '@/shared/presentation/context-info';
import { useApp } from '@/state';

export default function SettingsScreen() {
  const {
    state,
    currentMission,
    restartActivePlan,
    startNewGoal,
    setNotificationsEnabled,
    resetProgress,
  } = useApp();
  const [notificationBusy, setNotificationBusy] = useState(false);

  const toggleNotifications = async (enabled: boolean) => {
    setNotificationBusy(true);
    try {
      if (enabled) {
        const granted = await enableDailyReminder(
          state.settings.reminderHour,
          state.settings.reminderMinute,
          currentMission?.title,
        );
        if (!granted) {
          Alert.alert(
            'Notifications are off',
            'Permission was not granted, or this feature is unavailable on the web.',
          );
          setNotificationsEnabled(false);
          return;
        }
      } else {
        await disableDailyReminder();
      }
      setNotificationsEnabled(enabled);
    } catch {
      Alert.alert('Could not update the reminder', 'Try again on your device or in a development build.');
    } finally {
      setNotificationBusy(false);
    }
  };

  const confirmReset = () => {
    Alert.alert(
      'Start over?',
      'This will delete your local profile, goal, missions, and activity log from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete data',
          style: 'destructive',
          onPress: () => {
            resetProgress().catch(() => {
              Alert.alert('Could not delete data');
            });
          },
        },
      ],
    );
  };

  const confirmNewGoal = () => {
    Alert.alert(
      'Start a new goal?',
      'Your current journey and its log will be deleted. Your profile, level, and XP will be kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change goal', style: 'destructive', onPress: startNewGoal },
      ],
    );
  };

  const confirmRestartPlan = () => {
    const plan = state.activePlan;
    if (!state.activeGoal || !plan) return;
    const firstMissionTitle = plan.missions[0]?.title;
    Alert.alert(
      'Restart this month?',
      'Progress for this cycle will be cleared. Your overall goal and roadmap will be kept. No new request will be sent to GPT.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restart from Day 1',
          style: 'destructive',
          onPress: async () => {
            restartActivePlan(plan.id);
            let reminderUpdated = true;
            if (state.settings.notificationsEnabled) {
              try {
                reminderUpdated = await enableDailyReminder(
                  state.settings.reminderHour,
                  state.settings.reminderMinute,
                  firstMissionTitle,
                );
                if (!reminderUpdated) setNotificationsEnabled(false);
              } catch {
                reminderUpdated = false;
              }
            }
            Alert.alert('Plan restarted', reminderUpdated ? 'Day 1 is ready.' : 'Day 1 is ready. The reminder could not be updated.');
          },
        },
      ],
    );
  };

  const legalInfo: ContextInfoSection[] = [
    {
      heading: 'Responsibility',
      body:
        'Actum generates a plan for informational purposes. You choose your own actions and accept the associated risks. Actum is not responsible for harm or consequences resulting from carrying out the plan on your own.',
    },
    {
      heading: 'Service status',
      body:
        'Actum is not a medical service. It does not diagnose or treat conditions, and it does not guarantee that you will reach your goal.',
    },
    {
      heading: 'Data',
      body: `Your progress is stored on your device. When you create a plan, your goal text is sent to OpenAI through the local server; your activity log is not sent. Data version: ${state.schemaVersion}.`,
    },
  ];

  return (
    <Screen>
      <ScreenHeader title="Settings" />

      <Card style={styles.profileCard}>
        <HeroSigil archetype={state.profile?.archetype} size={68} level={state.character.level} />
        <View style={styles.profileCopy}>
          <ThemedText type="subtitle">{state.profile?.name ?? 'Traveler'}</ThemedText>
          <View style={styles.badges}>
            <Pill tone="gold">level {state.character.level}</Pill>
            <Pill tone="neutral">{state.character.xp} XP</Pill>
          </View>
        </View>
      </Card>

      <View style={styles.section}>
        <ThemedText type="eyebrow" style={styles.sectionTitle}>
          Routine
        </ThemedText>
        <SettingRow
          icon="◷"
          title="Reminder"
          subtitle={`${String(state.settings.reminderHour).padStart(2, '0')}:${String(
            state.settings.reminderMinute,
          ).padStart(2, '0')}`}
          control={
            <Switch
              accessibilityLabel="Daily reminder"
              disabled={notificationBusy}
              onValueChange={toggleNotifications}
              trackColor={{ false: Palette.line, true: Palette.accent }}
              thumbColor={Palette.white}
              value={state.settings.notificationsEnabled}
            />
          }
        />
      </View>

      <View style={styles.section}>
        <ThemedText type="eyebrow" style={styles.sectionTitle}>
          Plan
        </ThemedText>
        {state.activeGoal && state.activePlan ? (
          <AppButton
            label="Restart this month"
            variant="secondary"
            onPress={confirmRestartPlan}
          />
        ) : null}
        {state.activeGoal ? (
          <AppButton label="New goal" variant="secondary" onPress={confirmNewGoal} />
        ) : null}
      </View>

      <DevToolsSection />

      <View style={styles.section}>
        <ThemedText type="eyebrow" style={styles.sectionTitle}>
          Data and policies
        </ThemedText>
        <SettingRow
          icon="§"
          title="Legal & Service"
          control={
            <InfoPopover
              accessibilityLabel="Open Legal & Service"
              sections={legalInfo}
              title="Legal & Service"
            />
          }
        />
        <AppButton label="Delete all data" variant="danger" onPress={confirmReset} />
      </View>
    </Screen>
  );
}

function SettingRow({
  icon,
  title,
  subtitle,
  control,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  control: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingIcon}>
        <ThemedText style={styles.iconText}>{icon}</ThemedText>
      </View>
      <View style={styles.profileCopy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" style={styles.muted}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {control}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: Palette.textMuted },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.twoHalf },
  profileCopy: { flex: 1, gap: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  section: { gap: Spacing.two },
  sectionTitle: { color: Palette.textDim, marginLeft: Spacing.one },
  settingRow: {
    minHeight: 76,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.twoHalf,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
  },
  settingIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { color: Palette.accent, fontSize: 18 },
});
