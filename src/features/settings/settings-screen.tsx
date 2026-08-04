import { useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, View } from 'react-native';

import { HeroSigil } from '@/components/hero-sigil';
import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { AppButton, Card, Pill, Screen, ScreenHeader } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { disableDailyReminder, enableDailyReminder } from '@/lib/notifications';
import { archetypeLabel } from '@/shared/presentation/archetypes';
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
      'Сам план, research и ответы GPT останутся. Выполненные дни, сессии, check-in и комментарии будут очищены. Профиль, уровень и XP сохранятся. OpenAI не вызывается.',
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
            Alert.alert(
              'Текущий план перезапущен',
              reminderUpdated
                ? 'День 1 назначен на сегодня. Новый запрос к GPT не выполнялся.'
                : 'День 1 назначен на сегодня без запроса к GPT. Ежедневное напоминание обновить не удалось.',
            );
          },
        },
      ],
    );
  };

  const appInfo: ContextInfoSection[] = [
    {
      heading: 'Данные',
      body: `Профиль, миссии, результаты и check-in хранятся на этом устройстве. При создании плана цель и выбранные ограничения отправляются в OpenAI через локальный AI-сервер; журнал выполнения не отправляется. Облачного аккаунта нет. Schema v${state.schemaVersion}.`,
    },
    {
      heading: 'Техническая схема MVP',
      body:
        'Expo SDK 57 · React Native · AsyncStorage · modular prompts · локальный Node AI gateway · Responses API с web research. Supabase sync и iOS Widget пока не подключены.',
    },
    {
      heading: 'Ограничения',
      body:
        'Actum показывает предупреждения, но не выбирает цель за пользователя. Это не медицинский продукт: приложение не диагностирует, не лечит и не гарантирует физический результат.',
      tone: 'warning',
    },
  ];

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Профиль и система"
        title="Настройки"
        action={
          <InfoPopover
            accessibilityLabel="О данных и устройстве Actum"
            sections={appInfo}
            title="О приложении"
          />
        }
      />

      <Card style={styles.profileCard}>
        <HeroSigil archetype={state.profile?.archetype} size={88} level={state.character.level} />
        <View style={styles.profileCopy}>
          <ThemedText type="subtitle">{state.profile?.name ?? 'Путник'}</ThemedText>
          <ThemedText type="small" style={styles.muted}>
            {state.profile ? archetypeLabel(state.profile.archetype) : 'Герой'} · Режим{' '}
            {state.profile?.strictness === 'gentle'
              ? 'бережный'
              : state.profile?.strictness === 'strict'
                ? 'строгий'
                : 'равновесие'}
          </ThemedText>
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
          title="Миссия дня"
          subtitle={`Каждый день в ${String(state.settings.reminderHour).padStart(2, '0')}:${String(
            state.settings.reminderMinute,
          ).padStart(2, '0')}`}
          control={
            <Switch
              accessibilityLabel="Ежедневное напоминание"
              disabled={notificationBusy}
              onValueChange={toggleNotifications}
              trackColor={{ false: Palette.line, true: '#7C672F' }}
              thumbColor={state.settings.notificationsEnabled ? Palette.goldBright : Palette.textMuted}
              value={state.settings.notificationsEnabled}
            />
          }
        />
      </View>

      <View style={styles.section}>
        <ThemedText type="eyebrow" style={styles.sectionTitle}>
          Проект
        </ThemedText>
        <AppButton
          label="Открыть документацию Expo"
          variant="secondary"
          onPress={() => Linking.openURL('https://docs.expo.dev/versions/v57.0.0/')}
        />
        {state.activeGoal && state.activePlan ? (
          <AppButton
            label="Начать текущий план заново · без GPT"
            variant="secondary"
            onPress={confirmRestartPlan}
          />
        ) : null}
        {state.activeGoal ? (
          <AppButton label="Начать другую цель" variant="secondary" onPress={confirmNewGoal} />
        ) : null}
        <AppButton label="Удалить локальные данные" variant="danger" onPress={confirmReset} />
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
  subtitle: string;
  control: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingIcon}>
        <ThemedText style={styles.iconText}>{icon}</ThemedText>
      </View>
      <View style={styles.profileCopy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          {subtitle}
        </ThemedText>
      </View>
      {control}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: Palette.textMuted },
  profileCard: { flexDirection: 'row', alignItems: 'center' },
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
    backgroundColor: '#211D35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { color: Palette.violetSoft, fontSize: 20 },
});
