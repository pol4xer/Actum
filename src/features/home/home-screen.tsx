import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CheckInModal } from '@/features/check-in';
import { GoalBuilder } from '@/features/goal-planning';
import { MissionRunner } from '@/features/mission-session';
import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import {
  AppButton,
  Card,
  Pill,
  ProgressBar,
  Screen,
  ScreenHeader,
} from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { calendarDateRelation, formatCalendarDate } from '@/lib/calendar-date';
import { missionContextSections } from '@/shared/presentation/context-info';
import { formatMissionDuration } from '@/shared/presentation/plan-formatters';
import { useApp } from '@/state';

export default function HomeScreen() {
  const {
    state,
    currentMission,
    mutateMissionRun,
    reportMission,
    startNewGoal,
  } = useApp();
  const [runnerVisible, setRunnerVisible] = useState(false);
  const [checkInVisible, setCheckInVisible] = useState(false);
  const [checkInRunId, setCheckInRunId] = useState<string>();

  if (!state.activeGoal || !state.activePlan) return <GoalBuilder />;

  const total = state.activePlan.missions.length;
  const reported = state.activePlan.missions.filter((mission) => mission.outcome !== 'pending').length;
  const planProgress = reported / total;
  const xpInLevel = state.character.xp % 100;
  const missionDate = formatCalendarDate(currentMission?.scheduledDate);
  const missionTiming = calendarDateRelation(currentMission?.scheduledDate);
  const currentRun = currentMission ? state.missionRuns[currentMission.id] : undefined;
  const today = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <>
      <Screen>
        <ScreenHeader
          eyebrow={today}
          title="Сегодня"
          action={
            <View style={styles.levelChip}>
              <ThemedText type="smallBold" style={styles.gold}>
                Ур. {state.character.level}
              </ThemedText>
            </View>
          }
        />

        <View style={styles.statusStrip}>
          <View style={styles.statusItem}>
            <ThemedText type="small" style={styles.muted}>Серия</ThemedText>
            <ThemedText type="smallBold">{state.character.streak} дн.</ThemedText>
          </View>
          <View style={styles.statusDivider} />
          <View style={styles.statusItem}>
            <ThemedText type="small" style={styles.muted}>Опыт</ThemedText>
            <ThemedText type="smallBold">{xpInLevel}/100</ThemedText>
          </View>
          <View style={styles.statusProgress}>
            <ProgressBar value={xpInLevel / 100} color={Palette.accent} height={6} />
          </View>
        </View>

        {currentMission ? (
          <Card accent style={styles.missionCard}>
            <View style={styles.sectionTop}>
              <Pill tone="gold">
                {missionTiming === 'today' ? 'сегодня · ' : ''}день{' '}
                {currentMission.dayNumber ?? currentMission.sequence} из {total}
              </Pill>
              <ThemedText type="small" style={styles.muted}>
                {missionDate ? `${missionDate} · ` : ''}
                {formatMissionDuration(currentMission, { approximateFallback: true })}
              </ThemedText>
            </View>
            <View style={styles.missionCopy}>
              <View style={styles.missionTitleRow}>
                <ThemedText type="title" style={styles.flex}>
                  {currentMission.title}
                </ThemedText>
                <InfoPopover
                  title="О сегодняшнем шаге"
                  accessibilityLabel="Показать пояснение к сегодняшнему шагу"
                  sections={missionContextSections(currentMission)}
                />
              </View>
            </View>
            <AppButton
              label={
                currentRun?.status === 'running'
                  ? 'Продолжить'
                  : currentRun?.status === 'awaiting_checkin'
                    ? 'Записать результат'
                    : 'Начать'
              }
              onPress={() => setRunnerVisible(true)}
              icon="→"
            />
          </Card>
        ) : (
          <Card accent style={styles.completedCard}>
            <View style={styles.victoryIcon}>
              <ThemedText style={styles.victoryGlyph}>✦</ThemedText>
            </View>
            <Pill tone="success">глава завершена</Pill>
            <ThemedText type="title" style={styles.center}>
              Маршрут пройден
            </ThemedText>
            <View style={styles.buttonRow}>
              <AppButton
                label="Сравнить двойников"
                variant="secondary"
                onPress={() => router.push('/twin')}
                style={styles.flex}
              />
              <AppButton label="Новая цель" onPress={startNewGoal} style={styles.flex} />
            </View>
          </Card>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/journey')}
          style={({ pressed }) => [styles.progressCard, pressed && styles.pressed]}>
          <View style={styles.progressCopy}>
            <View style={styles.sectionTop}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.goalTitle}>
                {state.activeGoal.title}
              </ThemedText>
              <ThemedText type="small" style={styles.muted}>
                {reported}/{total}
              </ThemedText>
            </View>
            <ProgressBar value={planProgress} />
          </View>
          <ThemedText style={styles.chevron}>›</ThemedText>
        </Pressable>
      </Screen>

      <MissionRunner
        mission={currentMission}
        visible={runnerVisible}
        onClose={() => setRunnerVisible(false)}
        onCheckIn={(runId) => {
          setRunnerVisible(false);
          setCheckInRunId(runId);
          setCheckInVisible(true);
        }}
      />

      <CheckInModal
        mission={currentMission}
        run={currentMission ? state.missionRuns[currentMission.id] : undefined}
        visible={checkInVisible}
        onSaveComment={(runId, value) => {
          if (currentMission) {
            mutateMissionRun(currentMission.id, runId, { kind: 'set-final-comment', value });
          }
        }}
        onClose={() => {
          setCheckInVisible(false);
          setCheckInRunId(undefined);
        }}
        onSubmit={(outcome, note) => {
          if (currentMission) reportMission(currentMission.id, outcome, note, checkInRunId);
          setCheckInVisible(false);
          setCheckInRunId(undefined);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  muted: { color: Palette.textMuted },
  gold: { color: Palette.goldBright },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  pressed: { opacity: 0.72 },
  levelChip: {
    minWidth: 58,
    height: 36,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 64,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    backgroundColor: Palette.surfaceSoft,
  },
  statusItem: { minWidth: 58, gap: 2 },
  statusDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: Palette.line },
  statusProgress: { flex: 1 },
  sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  missionCard: { paddingTop: Spacing.three },
  missionCopy: { gap: Spacing.two },
  missionTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  completedCard: { alignItems: 'center', paddingVertical: Spacing.five },
  victoryIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(36, 138, 61, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  victoryGlyph: { color: Palette.success, fontSize: 36 },
  buttonRow: { flexDirection: 'row', gap: Spacing.two, width: '100%' },
  progressCard: {
    minHeight: 96,
    borderRadius: Radius.large,
    backgroundColor: Palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  progressCopy: { flex: 1, gap: Spacing.two },
  goalTitle: { flex: 1 },
  chevron: { color: Palette.textDim, fontSize: 34 },
});
