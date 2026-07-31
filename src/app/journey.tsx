import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Pill, ProgressBar, Screen, ScreenHeader } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { Mission, MissionOutcome } from '@/domain/types';
import { useApp } from '@/state/app-context';

const OUTCOME_META: Record<MissionOutcome, { icon: string; color: string; label: string }> = {
  pending: { icon: '', color: Palette.textDim, label: 'Впереди' },
  completed: { icon: '✓', color: Palette.success, label: 'Выполнено' },
  partial: { icon: '≈', color: Palette.warning, label: 'Частично' },
  skipped: { icon: '—', color: Palette.danger, label: 'Пропущено' },
};

export default function JourneyScreen() {
  const { state, currentMission } = useApp();

  if (!state.activeGoal || !state.activePlan) {
    return (
      <Screen>
        <ScreenHeader
          eyebrow="Маршрут"
          title="Сначала выбери цель"
          subtitle="После создания цели здесь появятся главы, миссии и история решений."
        />
        <Card>
          <ThemedText type="subtitle">Путь ещё не начат</ThemedText>
          <ThemedText style={styles.muted}>
            Вернись на вкладку «Сегодня» и сформулируй одно реальное намерение.
          </ThemedText>
        </Card>
      </Screen>
    );
  }

  const reported = state.activePlan.missions.filter((mission) => mission.outcome !== 'pending').length;
  const progress = reported / state.activePlan.missions.length;

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Карта пути"
        title="Главная миссия"
        subtitle={state.activeGoal.title}
      />

      <Card accent>
        <View style={styles.questHeader}>
          <View style={styles.questCopy}>
            <Pill tone={state.activeGoal.status === 'completed' ? 'success' : 'gold'}>
              {state.activeGoal.status === 'completed' ? 'маршрут завершён' : 'активная цель'}
            </Pill>
            <ThemedText type="subtitle">{state.activeGoal.targetMetric}</ThemedText>
          </View>
          <View style={styles.percentCircle}>
            <ThemedText type="smallBold" style={styles.gold}>
              {Math.round(progress * 100)}%
            </ThemedText>
          </View>
        </View>
        <ProgressBar value={progress} />
        <ThemedText type="small" style={styles.muted}>
          План v{state.activePlan.version} · {state.activePlan.dailyMinutes} минут в день ·{' '}
          {state.activePlan.research.confidence === 'high' ? 'высокая' : 'средняя'} уверенность шаблона
        </ThemedText>
      </Card>

      <View style={styles.timeline}>
        {state.activePlan.chapters.map((chapter, chapterIndex) => {
          const missions = state.activePlan?.missions.filter(
            (mission) => mission.chapterId === chapter.id,
          ) ?? [];
          const complete = missions.every((mission) => mission.outcome !== 'pending');
          const active = missions.some((mission) => mission.id === currentMission?.id);

          return (
            <View key={chapter.id} style={styles.chapterRow}>
              <View style={styles.rail}>
                <View
                  style={[
                    styles.chapterNode,
                    complete && styles.chapterNodeComplete,
                    active && styles.chapterNodeActive,
                  ]}>
                  <ThemedText type="smallBold" style={complete ? styles.nodeCompleteText : styles.nodeText}>
                    {complete ? '✓' : chapterIndex + 1}
                  </ThemedText>
                </View>
                {chapterIndex < state.activePlan!.chapters.length - 1 ? (
                  <View style={[styles.railLine, complete && styles.railLineComplete]} />
                ) : null}
              </View>
              <Card style={[styles.chapterCard, active && styles.chapterCardActive]}>
                <View style={styles.chapterTitle}>
                  <View style={styles.questCopy}>
                    <ThemedText type="smallBold">{chapter.title}</ThemedText>
                    <ThemedText type="small" style={styles.muted}>
                      {chapter.subtitle}
                    </ThemedText>
                  </View>
                  {active ? <Pill tone="violet">сейчас</Pill> : null}
                </View>
                <View style={styles.missionList}>
                  {missions.map((mission) => (
                    <MissionRow
                      key={mission.id}
                      mission={mission}
                      isCurrent={mission.id === currentMission?.id}
                    />
                  ))}
                </View>
              </Card>
            </View>
          );
        })}
      </View>

      <Card style={styles.methodCard}>
        <View style={styles.questHeader}>
          <View style={styles.questCopy}>
            <ThemedText type="eyebrow" style={styles.violet}>
              Research dossier
            </ThemedText>
            <ThemedText type="subtitle">Почему план выглядит так</ThemedText>
          </View>
          <Pill tone="neutral">
            {state.activePlan.research.method === 'openai-responses-v1' ? 'GPT v1' : 'local v1'}
          </Pill>
        </View>
        {state.activePlan.research.assumptions.map((assumption) => (
          <Bullet key={assumption}>{assumption}</Bullet>
        ))}
        {state.activePlan.research.safetyNotes.map((note) => (
          <Bullet key={note} tone="warning">
            {note}
          </Bullet>
        ))}
      </Card>

      {state.checkIns.length ? (
        <View style={styles.history}>
          <ThemedText type="eyebrow" style={styles.muted}>
            Журнал событий
          </ThemedText>
          {state.checkIns.slice(0, 5).map((checkIn) => {
            const mission = state.activePlan?.missions.find((item) => item.id === checkIn.missionId);
            const meta = OUTCOME_META[checkIn.outcome];
            return (
              <View key={checkIn.id} style={styles.historyRow}>
                <View style={[styles.historyDot, { backgroundColor: meta.color }]} />
                <View style={styles.questCopy}>
                  <ThemedText type="smallBold">{mission?.title ?? 'Миссия'}</ThemedText>
                  <ThemedText type="small" style={styles.muted}>
                    {meta.label} · {checkIn.xpDelta > 0 ? `+${checkIn.xpDelta} XP` : 'без XP'}
                  </ThemedText>
                  {checkIn.note ? (
                    <ThemedText type="small" style={styles.note}>
                      «{checkIn.note}»
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}

function MissionRow({ mission, isCurrent }: { mission: Mission; isCurrent: boolean }) {
  const meta = OUTCOME_META[mission.outcome];
  return (
    <View style={[styles.missionRow, isCurrent && styles.missionRowActive]}>
      <View style={[styles.outcomeIcon, { borderColor: meta.color }]}>
        <ThemedText type="smallBold" style={{ color: meta.color }}>
          {meta.icon || mission.sequence}
        </ThemedText>
      </View>
      <View style={styles.questCopy}>
        <ThemedText type="smallBold" style={mission.outcome === 'skipped' && styles.strike}>
          {mission.title}
        </ThemedText>
        <ThemedText type="small" style={styles.muted}>
          {mission.estimatedMinutes} мин · {mission.xp} XP
        </ThemedText>
      </View>
    </View>
  );
}

function Bullet({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'warning' }) {
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bullet, tone === 'warning' && styles.bulletWarning]} />
      <ThemedText type="small" style={styles.bulletText}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: Palette.textMuted },
  gold: { color: Palette.goldBright },
  violet: { color: Palette.violetSoft },
  questHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  questCopy: { flex: 1, gap: 4 },
  percentCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Palette.gold,
    backgroundColor: '#2A2419',
  },
  timeline: { gap: 0 },
  chapterRow: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.two },
  rail: { width: 34, alignItems: 'center' },
  chapterNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterNodeActive: { borderColor: Palette.violet, backgroundColor: '#292344' },
  chapterNodeComplete: { borderColor: Palette.success, backgroundColor: '#173126' },
  nodeText: { color: Palette.textMuted },
  nodeCompleteText: { color: Palette.success },
  railLine: { flex: 1, width: 1, minHeight: 24, backgroundColor: Palette.line },
  railLineComplete: { backgroundColor: '#36634E' },
  chapterCard: { flex: 1, marginBottom: Spacing.three, borderRadius: Radius.medium },
  chapterCardActive: { borderColor: '#4A4277' },
  chapterTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  missionList: { gap: Spacing.two },
  missionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 58,
    padding: Spacing.two,
    borderRadius: Radius.small,
    backgroundColor: Palette.inkRaised,
  },
  missionRowActive: { backgroundColor: '#1F1B34', borderWidth: 1, borderColor: '#463D73' },
  outcomeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strike: { color: Palette.textMuted, textDecorationLine: 'line-through' },
  methodCard: { backgroundColor: '#131525' },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: Palette.violetSoft, marginTop: 7 },
  bulletWarning: { backgroundColor: Palette.warning },
  bulletText: { flex: 1, color: Palette.textMuted },
  history: { gap: Spacing.two },
  historyRow: {
    flexDirection: 'row',
    gap: Spacing.twoHalf,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    backgroundColor: Palette.surface,
  },
  historyDot: { width: 9, height: 9, borderRadius: 5, marginTop: 7 },
  note: { color: Palette.text, fontStyle: 'italic', marginTop: 4 },
});
