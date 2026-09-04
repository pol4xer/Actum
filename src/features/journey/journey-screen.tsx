import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { CheckInModal } from '@/features/check-in';
import {
  ProgramRoadmap,
  estimatedTargetCycleLabel,
} from '@/features/goal-planning';
import { MissionRunner, RunSummary } from '@/features/mission-session';
import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { AppButton, Card, Pill, ProgressBar, Screen, ScreenHeader } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { goalMetricProgress, latestProgramActual } from '@/domain/goal-program';
import type { GeneratedGoal, Mission, MissionOutcome } from '@/domain/types';
import { formatCalendarDate } from '@/lib/calendar-date';
import {
  executionBlockContextSections,
  missionContextSections,
  planContextSections,
  type ContextInfoSection,
} from '@/shared/presentation/context-info';
import {
  actionableExecutionBlocks,
  presentExecutionSection,
} from '@/shared/presentation/execution-visibility';
import {
  presentMissionDay,
  type MissionActionPresentation,
} from '@/shared/presentation/mission-actions';
import {
  formatMetricValue,
  formatMissionDuration,
} from '@/shared/presentation/plan-formatters';
import { useApp } from '@/state';

const OUTCOME_META: Record<MissionOutcome, { icon: string; color: string; label: string }> = {
  pending: { icon: '', color: Palette.textDim, label: 'Впереди' },
  completed: { icon: '✓', color: Palette.success, label: 'Выполнено' },
  partial: { icon: '≈', color: Palette.warning, label: 'Частично' },
  skipped: { icon: '—', color: Palette.danger, label: 'Не выполнено' },
};

export default function JourneyScreen() {
  const { state, currentMission, mutateMissionRun, reportMission } = useApp();
  const [expandedMissionId, setExpandedMissionId] = useState<string>();
  const [runnerMissionId, setRunnerMissionId] = useState<string>();
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [checkInMissionId, setCheckInMissionId] = useState<string>();
  const [checkInRunId, setCheckInRunId] = useState<string>();

  if (!state.activeGoal || !state.activePlan) {
    return (
      <Screen>
        <ScreenHeader eyebrow="План" title="Сначала выбери цель" />
        <AppButton label="Новая цель" onPress={() => router.push('/')} />
      </Screen>
    );
  }

  const reported = state.activePlan.missions.filter((mission) => mission.outcome !== 'pending').length;
  const progress = reported / state.activePlan.missions.length;
  const runnerMission = state.activePlan.missions.find(
    (mission) => mission.id === runnerMissionId,
  );
  const checkInMission = state.activePlan.missions.find(
    (mission) => mission.id === checkInMissionId,
  );
  const checkInRun = checkInMission ? state.missionRuns[checkInMission.id] : undefined;
  const runnerIsCurrent = runnerMission?.id === currentMission?.id;
  const planPreview: GeneratedGoal = {
    goal: state.activeGoal,
    plan: state.activePlan,
  };
  const program = state.activeGoal.program;
  const currentActual = latestProgramActual(program, state.activeGoal.baseline);
  const currentValue = currentActual.measuredValue;
  const currentUnit = currentActual.unit;
  const targetValue = program.target.value;
  const targetUnit = program.target.unit;
  const estimatedTargetCycle = estimatedTargetCycleLabel(
    state.activePlan.targetCycleNumber,
  );
  const achievedCycle = program.achievement?.cycleNumber;
  const usesCurrentPlanContract = state.activePlan.version >= 7;
  const metricProgress = goalMetricProgress(
    {
      value: state.activeGoal.baseline?.value,
      unit: state.activeGoal.baseline?.unit,
    },
    { value: currentValue, unit: currentUnit },
    { value: targetValue, unit: targetUnit },
  );

  return (
    <>
      <Screen>
        <ScreenHeader
          eyebrow="План"
          title="По дням"
          subtitle={state.activeGoal.rawPrompt}
        />

        <Card style={styles.summaryCard}>
          <View style={styles.row}>
            <View style={styles.summaryTitle}>
              <ThemedText type="smallBold" numberOfLines={2} style={styles.flex}>
                {state.activePlan.cycleGoal}
              </ThemedText>
              {!usesCurrentPlanContract ? <Pill tone="warning">старый план</Pill> : null}
            </View>
            <InfoPopover
              title="О плане"
              accessibilityLabel="Показать методику и источники плана"
              sections={[
                ...(!usesCurrentPlanContract
                  ? [{ body: 'Этот сохранённый план создан по старым правилам. Ежедневная целевая практика и самый ранний месяц достижения применяются только к новому plan-v7.' }]
                  : []),
                ...planInfoWithoutSafety(planPreview),
              ]}
            />
          </View>
          <ProgressBar value={progress} />
          <View style={styles.row}>
            <ThemedText type="small" style={styles.muted}>
              Цикл {state.activePlan.cycleNumber}/{state.activePlan.totalCycles}
              {achievedCycle
                ? ` · достигнута: месяц ${achievedCycle}`
                : estimatedTargetCycle
                ? ` · цель: ${estimatedTargetCycle.toLocaleLowerCase('ru-RU')}`
                : ''}
            </ThemedText>
            <ThemedText type="small" style={styles.muted}>
              {reported}/{state.activePlan.missions.length} дней
            </ThemedText>
          </View>
          {metricProgress !== undefined ? (
            <View style={styles.metricProgress}>
              <View style={styles.row}>
                <ThemedText type="small" style={styles.muted}>
                  Сейчас {formatMetricValue(currentValue, currentUnit)}
                </ThemedText>
                <ThemedText type="smallBold">
                  Цель {formatMetricValue(targetValue, targetUnit)}
                </ThemedText>
              </View>
              <ProgressBar value={metricProgress} color={Palette.accent} />
            </View>
          ) : null}
        </Card>

        <ProgramRoadmap
          program={program}
          targetCycleNumber={state.activePlan.targetCycleNumber}
        />

        <View style={styles.daySections}>
          {state.activePlan.chapters.map((chapter) => {
            const missions = state.activePlan!.missions.filter(
              (mission) => mission.chapterId === chapter.id,
            );
            if (!missions.length) return null;
            const chapterPresentation = presentExecutionSection(
              chapter.title,
              chapter.subtitle,
            );

            return (
              <View key={chapter.id} style={styles.chapterSection}>
                <View style={styles.chapterHeader}>
                  <ThemedText type="eyebrow" style={styles.muted}>
                    {chapterPresentation.title}
                  </ThemedText>
                  {chapterPresentation.showContext ? (
                    <InfoPopover
                      title={chapterPresentation.title}
                      accessibilityLabel={`Показать пояснение к этапу ${chapterPresentation.title}`}
                      sections={[{ body: chapter.subtitle }]}
                    />
                  ) : null}
                </View>
                {missions.map((mission) => {
                  const expanded = expandedMissionId === mission.id;
                  return (
                    <MissionRow
                      key={mission.id}
                      mission={mission}
                      isCurrent={mission.id === currentMission?.id}
                      expanded={expanded}
                      onToggle={() => setExpandedMissionId(expanded ? undefined : mission.id)}
                      onOpen={() => setRunnerMissionId(mission.id)}
                    />
                  );
                })}
              </View>
            );
          })}
        </View>

        {state.checkIns.length ? (
          <View style={styles.history}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: historyExpanded }}
              onPress={() => setHistoryExpanded((value) => !value)}
              style={({ pressed }) => [styles.historyToggle, pressed && styles.pressed]}>
              <ThemedText type="smallBold">История</ThemedText>
              <ThemedText type="small" style={styles.muted}>
                {state.checkIns.length} {historyExpanded ? '⌃' : '⌄'}
              </ThemedText>
            </Pressable>

            {historyExpanded
              ? state.checkIns.map((checkIn) => {
                  const mission = state.activePlan?.missions.find(
                    (item) => item.id === checkIn.missionId,
                  );
                  const run = state.missionRuns[checkIn.missionId];
                  const recordedRun = run?.id === checkIn.runId ? run : undefined;
                  const meta = OUTCOME_META[checkIn.outcome];
                  return (
                    <View key={checkIn.id} style={styles.historyEntry}>
                      <View style={styles.historyRow}>
                        <View style={[styles.historyDot, { backgroundColor: meta.color }]} />
                        <View style={styles.flex}>
                          <ThemedText type="smallBold">{mission?.title ?? 'День'}</ThemedText>
                          <ThemedText type="small" style={styles.muted}>
                            {meta.label} · {formatCheckInDate(checkIn.createdAt)}
                          </ThemedText>
                        </View>
                      </View>
                      {mission && recordedRun ? (
                        <RunSummary mission={mission} run={recordedRun} />
                      ) : null}
                      {checkIn.note ? (
                        <ThemedText type="small" style={styles.note}>
                          {checkIn.note}
                        </ThemedText>
                      ) : null}
                    </View>
                  );
                })
              : null}
          </View>
        ) : null}
      </Screen>

      <MissionRunner
        mission={runnerMission}
        visible={Boolean(runnerMission)}
        readOnly={!runnerIsCurrent}
        onClose={() => setRunnerMissionId(undefined)}
        onCheckIn={(runId) => {
          if (!runnerMission || !runnerIsCurrent) return;
          setRunnerMissionId(undefined);
          setCheckInMissionId(runnerMission.id);
          setCheckInRunId(runId);
        }}
      />

      <CheckInModal
        mission={checkInMission}
        run={checkInRun}
        visible={Boolean(checkInMission)}
        onSaveComment={(runId, value) => {
          if (checkInMission) {
            mutateMissionRun(checkInMission.id, runId, { kind: 'set-final-comment', value });
          }
        }}
        onClose={() => {
          setCheckInMissionId(undefined);
          setCheckInRunId(undefined);
        }}
        onSubmit={(outcome, note) => {
          if (checkInMission && checkInMission.id === currentMission?.id) {
            reportMission(checkInMission.id, outcome, note, checkInRunId);
          }
          setCheckInMissionId(undefined);
          setCheckInRunId(undefined);
        }}
      />
    </>
  );
}

function MissionRow({
  mission,
  isCurrent,
  expanded,
  onToggle,
  onOpen,
}: {
  mission: Mission;
  isCurrent: boolean;
  expanded: boolean;
  onToggle(): void;
  onOpen(): void;
}) {
  const meta = OUTCOME_META[mission.outcome];
  const scheduledDate = formatCalendarDate(mission.scheduledDate);
  const context = missionInfoWithoutSafety(mission);

  return (
    <Card style={[styles.dayCard, isCurrent && styles.currentDayCard]}>
      <View style={styles.dayHeaderRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Свернуть' : 'Раскрыть'} день ${mission.dayNumber ?? mission.sequence}: ${mission.title}`}
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={({ pressed }) => [styles.dayHeaderButton, pressed && styles.pressed]}>
          <View style={[styles.dayNumber, { borderColor: meta.color }]}>
            <ThemedText type="smallBold" style={{ color: meta.color }}>
              {meta.icon || mission.dayNumber || mission.sequence}
            </ThemedText>
          </View>
          <View style={styles.flex}>
            <View style={styles.titleRow}>
              <ThemedText type="eyebrow" style={styles.dayLabel}>
                День {mission.dayNumber ?? mission.sequence}
                {scheduledDate ? ` · ${scheduledDate}` : ''}
              </ThemedText>
              {isCurrent ? <Pill tone="violet">сейчас</Pill> : null}
            </View>
            <ThemedText type="smallBold" style={mission.outcome === 'skipped' && styles.strike}>
              {mission.title}
            </ThemedText>
            <ThemedText type="small" style={styles.muted}>
              {formatMissionDuration(mission)}
            </ThemedText>
          </View>
          <ThemedText style={styles.chevron}>{expanded ? '⌃' : '⌄'}</ThemedText>
        </Pressable>
        {expanded ? (
          <InfoPopover
            title={`О дне ${mission.dayNumber ?? mission.sequence}`}
            accessibilityLabel={`Показать пояснение к дню ${mission.dayNumber ?? mission.sequence}`}
            sections={context}
          />
        ) : null}
      </View>

      {expanded ? (
        <View style={styles.expandedDay}>
          <MissionActionDetails mission={mission} />
          <AppButton
            label={isCurrent ? 'Начать день' : 'Открыть день'}
            variant={isCurrent ? 'primary' : 'secondary'}
            onPress={onOpen}
          />
        </View>
      ) : null}
    </Card>
  );
}

function MissionActionDetails({ mission }: { mission: Mission }) {
  const presentation = presentMissionDay(mission);
  return (
    <View style={styles.actionList}>
      {presentation.actions.map((action, index) => (
        <ActionBlock key={action.id} action={action} index={index} />
      ))}
      <Criterion text={presentation.dayCriterion} day />
    </View>
  );
}

function ActionBlock({
  action,
  index,
}: {
  action: MissionActionPresentation;
  index: number;
}) {
  return (
    <View style={styles.actionBlock}>
      <ThemedText type="smallBold">
        {index + 1}. {action.title}
      </ThemedText>
      {action.dose ? (
        <ThemedText type="smallBold" style={styles.actionDose}>
          {action.dose}
        </ThemedText>
      ) : null}
      {action.items?.map((item, itemIndex) => (
        <ThemedText key={`${item}-${itemIndex}`} type="small">
          {itemIndex + 1}. {item}
        </ThemedText>
      ))}
      {action.instruction ? <ThemedText type="small">{action.instruction}</ThemedText> : null}
      <Criterion text={action.criterion} />
    </View>
  );
}

function Criterion({ text, day = false }: { text?: string; day?: boolean }) {
  if (!text?.trim()) return null;
  return (
    <View style={day ? styles.dayCriterion : styles.criterion}>
      <ThemedText type="eyebrow" style={styles.muted}>
        {day ? 'День выполнен' : 'Готово, если'}
      </ThemedText>
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

function missionInfoWithoutSafety(mission: Mission): ContextInfoSection[] {
  const sections = missionContextSections(mission).filter(
    (section) => section.heading !== 'Предупреждение' && section.heading !== 'Критерий дня',
  );
  if (mission.execution?.kind !== 'in_app') return sections;

  return [
    ...sections,
    ...actionableExecutionBlocks(mission.execution.blocks).flatMap((block) =>
      executionBlockContextSections(block).map((section) => ({
        ...section,
        heading: `${block.title} · ${section.heading ?? 'расчёт'}`,
      })),
    ),
  ];
}

function planInfoWithoutSafety(preview: GeneratedGoal): ContextInfoSection[] {
  return planContextSections(preview.plan, {
    baseline: preview.goal.baseline,
    targetTimeline: preview.goal.targetTimeline,
  }).filter((section) => section.heading !== 'Безопасность' && section.tone !== 'warning');
}

function formatCheckInDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'в Actum';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  muted: { color: Palette.textMuted },
  dayLabel: { color: Palette.goldBright },
  pressed: { opacity: 0.7 },
  summaryCard: { gap: Spacing.two },
  summaryTitle: { flex: 1, alignItems: 'flex-start', gap: Spacing.one },
  metricProgress: { gap: Spacing.one },
  daySections: { gap: Spacing.three },
  chapterSection: { gap: Spacing.two },
  chapterHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
  },
  dayCard: { gap: 0, padding: Spacing.twoHalf },
  currentDayCard: { borderColor: Palette.cyan },
  dayHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dayHeaderButton: {
    flex: 1,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
  },
  dayNumber: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chevron: { color: Palette.textMuted, fontSize: 20 },
  strike: { color: Palette.textMuted, textDecorationLine: 'line-through' },
  expandedDay: {
    gap: Spacing.two,
    paddingTop: Spacing.twoHalf,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
  },
  actionList: { gap: Spacing.two },
  actionBlock: {
    gap: Spacing.one,
    padding: Spacing.twoHalf,
    borderRadius: Radius.small,
    backgroundColor: Palette.surfaceSoft,
  },
  actionDose: { color: Palette.cyan },
  criterion: {
    gap: 2,
    paddingTop: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
  },
  dayCriterion: {
    gap: 2,
    padding: Spacing.twoHalf,
    borderRadius: Radius.small,
    backgroundColor: Palette.surfaceSoft,
  },
  history: { gap: Spacing.two },
  historyToggle: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    paddingHorizontal: Spacing.three,
  },
  historyEntry: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    backgroundColor: Palette.surface,
  },
  historyRow: { flexDirection: 'row', gap: Spacing.twoHalf },
  historyDot: { width: 9, height: 9, borderRadius: 5, marginTop: 7 },
  note: { color: Palette.text, fontStyle: 'italic' },
});
