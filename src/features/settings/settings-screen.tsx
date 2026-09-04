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
            'Уведомления не включены',
            'Разрешение не выдано или эта функция недоступна в web-версии.',
          );
          setNotificationsEnabled(false);
          return;
        }
      } else {
        await disableDailyReminder();
      }
      setNotificationsEnabled(enabled);
    } catch {
      Alert.alert('Не удалось изменить напоминание', 'Попробуй снова на устройстве или в development build.');
    } finally {
      setNotificationBusy(false);
    }
  };

  const confirmReset = () => {
    Alert.alert(
      'Начать всё заново?',
      'Будут удалены локальный профиль, цель, миссии и журнал событий на этом устройстве.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить данные',
          style: 'destructive',
          onPress: () => {
            resetProgress().catch(() => {
              Alert.alert('Не удалось удалить данные');
            });
          },
        },
      ],
    );
  };

  const confirmNewGoal = () => {
    Alert.alert(
      'Начать другую цель?',
      'Текущий маршрут и его журнал будут удалены. Профиль, уровень и XP останутся.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Сменить цель', style: 'destructive', onPress: startNewGoal },
      ],
    );
  };

  const confirmRestartPlan = () => {
    const plan = state.activePlan;
    if (!state.activeGoal || !plan) return;
    const firstMissionTitle = plan.missions[0]?.title;
    Alert.alert(
      'Начать текущий план заново?',
      'Прогресс очистится, а план останется. Новый запрос к GPT не отправится.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Начать с Дня 1',
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
            Alert.alert('План перезапущен', reminderUpdated ? 'Открыт День 1.' : 'Открыт День 1. Напоминание не обновилось.');
          },
        },
      ],
    );
  };

  const legalInfo: ContextInfoSection[] = [
    {
      heading: 'Ответственность',
      body:
        'Actum автоматически предлагает справочный план. Пользователь сам выбирает действия и принимает на себя риски. Actum не несёт ответственности за вред или последствия самостоятельного выполнения.',
    },
    {
      heading: 'Статус сервиса',
      body:
        'Actum не является медицинской услугой, не ставит диагнозы, не лечит и не гарантирует достижение цели.',
    },
    {
      heading: 'Данные',
      body: `Прогресс хранится на устройстве. При создании плана текст цели отправляется в OpenAI через локальный сервер; журнал выполнения не отправляется. Версия данных: ${state.schemaVersion}.`,
    },
  ];

  return (
    <Screen>
      <ScreenHeader title="Настройки" />

      <Card style={styles.profileCard}>
        <HeroSigil archetype={state.profile?.archetype} size={68} level={state.character.level} />
        <View style={styles.profileCopy}>
          <ThemedText type="subtitle">{state.profile?.name ?? 'Путник'}</ThemedText>
          <View style={styles.badges}>
            <Pill tone="gold">уровень {state.character.level}</Pill>
            <Pill tone="neutral">{state.character.xp} XP</Pill>
          </View>
        </View>
      </Card>

      <View style={styles.section}>
        <ThemedText type="eyebrow" style={styles.sectionTitle}>
          Ритм
        </ThemedText>
        <SettingRow
          icon="◷"
          title="Напоминание"
          subtitle={`${String(state.settings.reminderHour).padStart(2, '0')}:${String(
            state.settings.reminderMinute,
          ).padStart(2, '0')}`}
          control={
            <Switch
              accessibilityLabel="Ежедневное напоминание"
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
          План
        </ThemedText>
        {state.activeGoal && state.activePlan ? (
          <AppButton
            label="Начать план заново"
            variant="secondary"
            onPress={confirmRestartPlan}
          />
        ) : null}
        {state.activeGoal ? (
          <AppButton label="Новая цель" variant="secondary" onPress={confirmNewGoal} />
        ) : null}
      </View>

      <DevToolsSection />

      <View style={styles.section}>
        <ThemedText type="eyebrow" style={styles.sectionTitle}>
          Данные и правила
        </ThemedText>
        <SettingRow
          icon="§"
          title="Legal & Service"
          control={
            <InfoPopover
              accessibilityLabel="Открыть Legal & Service"
              sections={legalInfo}
              title="Legal & Service"
            />
          }
        />
        <AppButton label="Удалить все данные" variant="danger" onPress={confirmReset} />
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
