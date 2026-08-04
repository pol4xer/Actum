import { useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, View } from 'react-native';

import { HeroSigil } from '@/components/hero-sigil';
import { ThemedText } from '@/components/themed-text';
import { AppButton, Card, Pill, Screen, ScreenHeader } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { disableDailyReminder, enableDailyReminder } from '@/lib/notifications';
import { archetypeLabel } from '@/shared/presentation/archetypes';
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

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Профиль и система"
        title="Настройки"
        subtitle="Данные живут локально; GPT подключён через маленький dev-сервер."
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
          Архитектура MVP
        </ThemedText>
        <Card style={styles.statusCard}>
          <StatusRow label="Клиент" value="Expo SDK 57 · React Native" status="ready" />
          <StatusRow label="Данные" value="AsyncStorage · on-device" status="ready" />
          <StatusRow label="Планировщик" value="GPT + modular prompts" status="ready" />
          <StatusRow label="AI gateway" value="Local Node proxy" status="ready" />
          <StatusRow label="Web research" value="Responses API · citations" status="ready" />
          <StatusRow label="Supabase sync" value="Optional backend" status="later" />
          <StatusRow label="iOS Widget" value="Native extension" status="later" />
        </Card>
      </View>

      <View style={styles.section}>
        <ThemedText type="eyebrow" style={styles.sectionTitle}>
          Приватность и безопасность
        </ThemedText>
        <Card>
          <ThemedText type="smallBold">Прогресс остаётся на устройстве</ThemedText>
          <ThemedText type="small" style={styles.muted}>
            Профиль, миссии и check-in сохраняются локально. При создании плана формулировка цели и выбранные ограничения отправляются в OpenAI через локальный AI-сервер; журнал выполнения не отправляется.
          </ThemedText>
          <View style={styles.divider} />
          <ThemedText type="smallBold">Не медицинский продукт</ThemedText>
          <ThemedText type="small" style={styles.muted}>
            Actum не решает за пользователя, какую цель ему выбирать: риск показывается как заметное предупреждение, а не локальная блокировка. Приложение не диагностирует, не лечит и не гарантирует физический результат; ограничения самого API сохраняются.
          </ThemedText>
        </Card>
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

      <ThemedText type="small" style={[styles.muted, styles.footerText]}>
        Actum MVP · schema v{state.schemaVersion} · без облачного аккаунта
      </ThemedText>
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

function StatusRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: 'ready' | 'later';
}) {
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, status === 'ready' ? styles.ready : styles.later]} />
      <View style={styles.profileCopy}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          {value}
        </ThemedText>
      </View>
      <Pill tone={status === 'ready' ? 'success' : 'neutral'}>
        {status === 'ready' ? 'готово' : 'позже'}
      </Pill>
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
  statusCard: { gap: 0, paddingVertical: Spacing.two },
  statusRow: {
    minHeight: 62,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Palette.line,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  ready: { backgroundColor: Palette.success },
  later: { backgroundColor: Palette.textDim },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Palette.line },
  footerText: { textAlign: 'center', marginTop: Spacing.three },
});
