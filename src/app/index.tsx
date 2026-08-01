import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CheckInModal } from '@/components/check-in-modal';
import { GoalBuilder } from '@/components/goal-builder';
import { HeroSigil, archetypeLabel } from '@/components/hero-sigil';
import { MissionRunner } from '@/components/mission-runner';
import { ThemedText } from '@/components/themed-text';
import {
  AppButton,
  Card,
  Pill,
  ProgressBar,
  Screen,
  ScreenHeader,
  Stat,
} from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { Mission } from '@/domain/types';
import { calendarDateRelation, formatCalendarDate } from '@/lib/calendar-date';
import { useApp } from '@/state/app-context';

export default function HomeScreen() {
  const {
    state,
    currentMission,
    completedCount,
    reportMission,
    completeRecovery,
    startNewGoal,
  } = useApp();
  const [runnerVisible, setRunnerVisible] = useState(false);
  const [checkInVisible, setCheckInVisible] = useState(false);

  if (!state.activeGoal || !state.activePlan) return <GoalBuilder />;

  const total = state.activePlan.missions.length;
  const reported = state.activePlan.missions.filter((mission) => mission.outcome !== 'pending').length;
  const planProgress = reported / total;
  const xpInLevel = state.character.xp % 100;
  const firstName = state.profile?.name.split(' ')[0] ?? 'Путник';
  const missionDate = formatCalendarDate(currentMission?.scheduledDate);
  const missionTiming = calendarDateRelation(currentMission?.scheduledDate);
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
          title={`С возвращением, ${firstName}`}
          subtitle={
            currentMission
              ? missionTiming === 'future' && missionDate
                ? `Следующий шаг запланирован на ${missionDate}. При желании его можно открыть заранее.`
                : missionTiming === 'past' && missionDate
                  ? `В календаре остался незавершённый шаг на ${missionDate}.`
                  : 'Сегодня нужен один честный шаг.'
              : 'Маршрут пройден. Время посмотреть на путь.'
          }
          action={
            <View style={styles.levelChip}>
              <ThemedText type="eyebrow" style={styles.levelChipLabel}>
                ур.
              </ThemedText>
              <ThemedText type="smallBold" style={styles.gold}>
                {state.character.level}
              </ThemedText>
            </View>
          }
        />

        <LinearGradient colors={['#201D39', '#131827', '#181716']} style={styles.heroCard}>
          <View style={styles.heroSky}>
            <View style={styles.heroCopy}>
              <Pill tone={state.character.debuffs.length ? 'warning' : 'violet'}>
                {state.character.debuffs[0] ?? archetypeLabel(state.profile?.archetype ?? 'pathfinder')}
              </Pill>
              <ThemedText type="subtitle">Реальный герой</ThemedText>
              <ThemedText type="small" style={styles.muted}>
                Мир освещён на {state.character.worldLight}%
              </ThemedText>
            </View>
            <HeroSigil
              archetype={state.profile?.archetype}
              level={state.character.level}
              size={124}
            />
          </View>
          <View style={styles.statsRow}>
            <Stat label="энергия" value={`${state.character.energy}%`} />
            <Stat label="серия" value={`${state.character.streak} дн.`} />
            <Stat label="опыт" value={`${xpInLevel}/100`} valueStyle={styles.gold} />
          </View>
          <ProgressBar value={xpInLevel / 100} color={Palette.violetSoft} />
        </LinearGradient>

        {state.recovery ? (
          <Card style={styles.recoveryCard}>
            <View style={styles.sectionTop}>
              <Pill tone="warning">путь возвращения</Pill>
              <ThemedText type="smallBold" style={styles.warning}>
                +{state.recovery.xp} XP
              </ThemedText>
            </View>
            <ThemedText type="subtitle">{state.recovery.title}</ThemedText>
            <ThemedText style={styles.muted}>{state.recovery.description}</ThemedText>
            <AppButton label="Я сделал микро-шаг" variant="secondary" onPress={completeRecovery} />
          </Card>
        ) : null}

        {currentMission ? (
          <Card accent style={styles.missionCard}>
            <View style={styles.sectionTop}>
              <Pill tone="gold">
                {missionTiming === 'future'
                  ? 'следующий день'
                  : missionTiming === 'past'
                    ? 'незавершённый день'
                    : missionTiming === 'today'
                      ? 'сегодня'
                      : 'день'}{' '}
                · {currentMission.dayNumber ?? currentMission.sequence}/{total}
                {missionDate ? ` · ${missionDate}` : ''}
              </Pill>
              <ThemedText type="small" style={styles.muted}>
                {missionDurationLabel(currentMission)}
              </ThemedText>
            </View>
            <View style={styles.questMark}>
              <ThemedText style={styles.questGlyph}>✦</ThemedText>
            </View>
            <View style={styles.missionCopy}>
              <ThemedText type="title">{currentMission.title}</ThemedText>
              <ThemedText style={styles.missionDescription}>{currentMission.description}</ThemedText>
            </View>
            <View style={styles.rewardRow}>
              <View>
                <ThemedText type="eyebrow" style={styles.muted}>
                  награда
                </ThemedText>
                <ThemedText type="smallBold" style={styles.gold}>
                  +{currentMission.xp} XP · Свет мира
                </ThemedText>
              </View>
              <View style={styles.typeBadge}>
                <ThemedText type="small">{currentMission.type}</ThemedText>
              </View>
            </View>
            <AppButton
              label={
                currentMission.execution?.kind === 'timer'
                  ? 'Открыть таймер'
                  : currentMission.execution?.kind === 'routine'
                    ? 'Открыть комплекс'
                    : 'Начать миссию'
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
            <ThemedText style={[styles.muted, styles.center]}>
              Ты отчитался по всем миссиям. Посмотри разницу траекторий или начни новую главную цель.
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
            <ThemedText type="small" style={styles.muted}>
              {completedCount} полных побед · Нажми, чтобы открыть маршрут
            </ThemedText>
          </View>
          <ThemedText style={styles.chevron}>›</ThemedText>
        </Pressable>
      </Screen>

      <MissionRunner
        mission={currentMission}
        visible={runnerVisible}
        onClose={() => setRunnerVisible(false)}
        onCheckIn={() => {
          setRunnerVisible(false);
          setCheckInVisible(true);
        }}
      />

      <CheckInModal
        mission={currentMission}
        visible={checkInVisible}
        onClose={() => setCheckInVisible(false)}
        onSubmit={(outcome, note) => {
          if (currentMission) reportMission(currentMission.id, outcome, note);
          setCheckInVisible(false);
        }}
      />
    </>
  );
}

function missionDurationLabel(mission: Mission) {
  if (mission.execution?.kind === 'routine') {
    const sets = mission.execution.actions.reduce((total, action) => total + action.sets, 0);
    return `${mission.execution.actions.length} действий · ${sets} подходов · ≈ ${mission.estimatedMinutes} мин`;
  }
  if (mission.execution?.kind === 'timer') {
    const seconds = mission.execution.durationSeconds;
    const timer = seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} мин` : `${seconds} сек`;
    return `${timer} таймер · ≈ ${mission.estimatedMinutes} мин всего`;
  }
  return `≈ ${mission.estimatedMinutes} мин`;
}

const styles = StyleSheet.create({
  muted: { color: Palette.textMuted },
  gold: { color: Palette.goldBright },
  warning: { color: Palette.warning },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  pressed: { opacity: 0.72 },
  levelChip: {
    minWidth: 54,
    height: 46,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: '#5A492B',
    backgroundColor: '#2A2418',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelChipLabel: { color: Palette.textMuted, lineHeight: 12 },
  heroCard: {
    borderRadius: Radius.large,
    padding: Spacing.three,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: '#343550',
    overflow: 'hidden',
  },
  heroSky: { minHeight: 128, flexDirection: 'row', alignItems: 'center' },
  heroCopy: { flex: 1, gap: Spacing.two },
  statsRow: {
    flexDirection: 'row',
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#FFFFFF18',
  },
  recoveryCard: { borderColor: '#5B4228', backgroundColor: '#201B18' },
  sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  missionCard: { paddingTop: Spacing.four },
  questMark: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#2B251A',
    borderWidth: 1,
    borderColor: '#5A492B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questGlyph: { fontSize: 25, color: Palette.goldBright },
  missionCopy: { gap: Spacing.two },
  missionDescription: { color: Palette.textMuted, fontSize: 17, lineHeight: 26 },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radius.small,
    backgroundColor: Palette.surfaceSoft,
  },
  completedCard: { alignItems: 'center', paddingVertical: Spacing.five },
  victoryIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: '#1B3027',
    borderWidth: 1,
    borderColor: '#36634E',
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
