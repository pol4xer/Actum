import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { InAppMissionRunner } from './in-app-mission-runner';
import { AppButton, Pill, ProgressBar } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import type { Mission, RoutineAction, RoutineLoadBasis } from '@/domain/types';
import { formatCalendarDate } from '@/lib/calendar-date';
import {
  missionContextSections,
  type ContextInfoSection,
} from '@/shared/presentation/context-info';
import { useApp } from '@/state';

type RunnerPhase = 'instructions' | 'countdown' | 'running' | 'finished';
type FinishReason = 'completed' | 'elapsed' | 'stopped';
type RoutineStage = 'work' | 'rest';

type MissionRunnerProps = {
  mission?: Mission;
  visible: boolean;
  readOnly?: boolean;
  onClose(): void;
  onCheckIn(runId?: string): void;
};

export function MissionRunner(props: MissionRunnerProps) {
  const {
    state,
    persistenceStatus,
    retryPersistence,
    beginMissionRun,
    saveMissionRun,
    mutateMissionRun,
    finishMissionRun,
  } = useApp();
  const { mission, readOnly = false } = props;

  if (mission?.execution?.kind === 'in_app') {
    return (
      <InAppMissionRunner
        mission={mission}
        run={state.missionRuns[mission.id]}
        visible={props.visible}
        readOnly={readOnly}
        persistenceStatus={persistenceStatus}
        onClose={props.onClose}
        onBegin={() => beginMissionRun(mission.id)}
        onSave={saveMissionRun}
        onMutate={(runId, mutation) => mutateMissionRun(mission.id, runId, mutation)}
        onFinish={finishMissionRun}
        onCheckIn={props.onCheckIn}
        onRetryPersistence={retryPersistence}
      />
    );
  }

  return <LegacyMissionRunner {...props} readOnly={readOnly} />;
}

function LegacyMissionRunner({
  mission,
  visible,
  readOnly = false,
  onClose,
  onCheckIn,
}: MissionRunnerProps) {
  const [phase, setPhase] = useState<RunnerPhase>('instructions');
  const [startedAt, setStartedAt] = useState<number>();
  const [endAt, setEndAt] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const [stepIndex, setStepIndex] = useState(0);
  const [finishReason, setFinishReason] = useState<FinishReason>();
  const [routineActionIndex, setRoutineActionIndex] = useState(0);
  const [routineSetIndex, setRoutineSetIndex] = useState(0);
  const [routineStage, setRoutineStage] = useState<RoutineStage>('work');
  const [routineCompletedSets, setRoutineCompletedSets] = useState(0);
  const [routineShortSets, setRoutineShortSets] = useState(0);
  const [stageStartedAt, setStageStartedAt] = useState<number>();
  const completedRoutineSetKey = useRef<string | undefined>(undefined);

  const explicitSteps = useMemo(
    () => mission?.steps?.filter((step) => step.trim().length > 0) ?? [],
    [mission?.steps],
  );
  const steps = useMemo(() => {
    if (explicitSteps.length) return explicitSteps;
    if (mission?.description.trim()) return [mission.description];
    return ['Complete the mission at your own pace.'];
  }, [explicitSteps, mission?.description]);

  const routineActions = useMemo(
    () =>
      mission?.execution?.kind === 'routine'
        ? mission.execution.actions.filter((action) => action.sets > 0)
        : [],
    [mission?.execution],
  );
  const isRoutine = routineActions.length > 0;
  const routineTotalSets = useMemo(
    () => routineActions.reduce((total, action) => total + Math.max(1, action.sets), 0),
    [routineActions],
  );
  const activeRoutineAction =
    routineActions[Math.min(routineActionIndex, routineActions.length - 1)];

  const timerSeconds =
    mission?.execution?.kind === 'timer'
      ? Math.max(1, Math.round(mission.execution.durationSeconds))
      : 0;
  const isLegacyTimed = timerSeconds > 0;
  const durationMs = timerSeconds * 1000;

  const finish = useCallback((reason: FinishReason) => {
    setNow(Date.now());
    setEndAt(undefined);
    setFinishReason(reason);
    setPhase('finished');
  }, []);

  const startRoutineWork = useCallback((action: RoutineAction | undefined, startTime: number) => {
    setRoutineStage('work');
    setStageStartedAt(startTime);
    const actionSeconds = getRoutineActionSeconds(action);
    setEndAt(actionSeconds ? startTime + actionSeconds * 1000 : undefined);
  }, []);

  const beginExecution = useCallback(() => {
    const startTime = Date.now();
    setStartedAt(startTime);
    setNow(startTime);
    setEndAt(isLegacyTimed ? startTime + durationMs : undefined);
    setStageStartedAt(undefined);

    if (isRoutine) startRoutineWork(routineActions[0], startTime);
    setPhase('running');
  }, [durationMs, isLegacyTimed, isRoutine, routineActions, startRoutineWork]);

  const completeRoutineSet = useCallback(
    (completedAt: number, metTarget = true) => {
      const setKey = `${routineActionIndex}:${routineSetIndex}`;
      if (completedRoutineSetKey.current === setKey) return;
      completedRoutineSetKey.current = setKey;

      const completedAction = routineActions[routineActionIndex];
      if (!completedAction) {
        finish('completed');
        return;
      }

      const hasAnotherSet = routineSetIndex + 1 < completedAction.sets;
      const nextActionIndex = hasAnotherSet ? routineActionIndex : routineActionIndex + 1;
      const nextSetIndex = hasAnotherSet ? routineSetIndex + 1 : 0;
      const nextAction = routineActions[nextActionIndex];

      setRoutineCompletedSets((current) => Math.min(routineTotalSets, current + 1));
      if (!metTarget) setRoutineShortSets((current) => current + 1);
      setEndAt(undefined);

      if (!nextAction) {
        finish('completed');
        return;
      }

      setRoutineActionIndex(nextActionIndex);
      setRoutineSetIndex(nextSetIndex);

      const restSeconds = Math.max(0, Math.round(completedAction.restSeconds));
      if (restSeconds > 0) {
        setRoutineStage('rest');
        setStageStartedAt(completedAt);
        setEndAt(completedAt + restSeconds * 1000);
        return;
      }

      startRoutineWork(nextAction, completedAt);
    },
    [
      finish,
      routineActionIndex,
      routineActions,
      routineSetIndex,
      routineTotalSets,
      startRoutineWork,
    ],
  );

  useEffect(() => {
    setPhase('instructions');
    setStartedAt(undefined);
    setEndAt(undefined);
    setNow(Date.now());
    setStepIndex(0);
    setFinishReason(undefined);
    setRoutineActionIndex(0);
    setRoutineSetIndex(0);
    setRoutineStage('work');
    setRoutineCompletedSets(0);
    setRoutineShortSets(0);
    setStageStartedAt(undefined);
    completedRoutineSetKey.current = undefined;
  }, [mission?.id]);

  useEffect(() => {
    if (!visible || phase !== 'countdown' || !endAt) return;

    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 100);
    const timeout = setTimeout(beginExecution, Math.max(0, endAt - Date.now()));
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [beginExecution, endAt, phase, visible]);

  useEffect(() => {
    if (!visible || phase !== 'running') return;

    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [phase, visible]);

  useEffect(() => {
    if (!visible || phase !== 'running' || !endAt) return;

    const timeout = setTimeout(() => {
      const completedAt = Date.now();
      setNow(completedAt);

      if (isLegacyTimed) {
        finish('elapsed');
        return;
      }

      if (!isRoutine) return;

      if (routineStage === 'rest') {
        startRoutineWork(activeRoutineAction, completedAt);
        return;
      }

      completeRoutineSet(completedAt);
    }, Math.max(0, endAt - Date.now()));

    return () => clearTimeout(timeout);
  }, [
    activeRoutineAction,
    completeRoutineSet,
    endAt,
    finish,
    isLegacyTimed,
    isRoutine,
    phase,
    routineStage,
    startRoutineWork,
    visible,
  ]);

  if (!mission) return null;

  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const remainingMs = endAt ? Math.max(0, endAt - now) : durationMs;
  const timerProgress = durationMs ? Math.min(1, elapsedMs / durationMs) : 0;
  const manualProgress = steps.length ? stepIndex / steps.length : 0;
  const stageDurationMs =
    endAt && stageStartedAt ? Math.max(1, endAt - stageStartedAt) : 0;
  const routineStageProgress = stageDurationMs
    ? Math.min(1, Math.max(0, (now - (stageStartedAt ?? now)) / stageDurationMs))
    : 0;
  const routineProgress = routineTotalSets
    ? Math.min(
        1,
        (routineCompletedSets +
          (routineStage === 'work' && getRoutineActionSeconds(activeRoutineAction)
            ? routineStageProgress
            : 0)) /
          routineTotalSets,
      )
    : 0;
  const progressValue = isRoutine
    ? routineProgress
    : isLegacyTimed
      ? timerProgress
      : manualProgress;
  const activeStep = isLegacyTimed
    ? mission.title
    : steps[Math.min(stepIndex, steps.length - 1)];
  const hasStageCountdown = Boolean(endAt) && (isLegacyTimed || isRoutine);
  const shownSeconds = Math.ceil((hasStageCountdown ? remainingMs : elapsedMs) / 1000);
  const countdownSeconds =
    phase === 'countdown' && endAt ? Math.max(1, Math.ceil((endAt - now) / 1000)) : 3;
  const modeSummary = isLegacyTimed
    ? formatDuration(timerSeconds)
    : isRoutine
      ? `${formatCount(routineActions.length, ['action', 'actions'])} · ${formatCount(routineTotalSets, ['set', 'sets'])}`
      : `${formatCount(steps.length, ['step', 'steps'])}`;
  const legacyRepeatRemaining =
    typeof mission.repeatTotal === 'number'
      ? Math.max(0, mission.repeatTotal - (mission.repeatIndex ?? 1))
      : undefined;
  const scheduledDate = formatCalendarDate(mission.scheduledDate);
  const legacyContext = legacyMissionContextSections(
    mission,
    explicitSteps.length > 0 || isRoutine,
    legacyRepeatRemaining,
  );

  const start = () => {
    if (readOnly) return;
    const countdownStartedAt = Date.now();
    setStartedAt(undefined);
    setNow(countdownStartedAt);
    setEndAt(countdownStartedAt + 3000);
    setStepIndex(0);
    setFinishReason(undefined);
    setRoutineActionIndex(0);
    setRoutineSetIndex(0);
    setRoutineCompletedSets(0);
    setRoutineShortSets(0);
    setStageStartedAt(undefined);
    completedRoutineSetKey.current = undefined;

    setPhase('countdown');
  };

  const advanceManualStep = () => {
    if (stepIndex < steps.length - 1) {
      setStepIndex((current) => current + 1);
      return;
    }
    finish('completed');
  };

  const restart = () => {
    setPhase('instructions');
    setStartedAt(undefined);
    setEndAt(undefined);
    setNow(Date.now());
    setStepIndex(0);
    setFinishReason(undefined);
    setRoutineActionIndex(0);
    setRoutineSetIndex(0);
    setRoutineStage('work');
    setRoutineCompletedSets(0);
    setRoutineShortSets(0);
    setStageStartedAt(undefined);
    completedRoutineSetKey.current = undefined;
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      visible={visible}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Pill tone={phase === 'running' ? 'success' : readOnly ? 'neutral' : 'gold'}>
              {readOnly
                ? 'preview'
                : phase === 'instructions'
                  ? 'ready to start'
                  : phase === 'countdown'
                    ? 'get ready'
                  : phase === 'running'
                    ? 'in progress'
                    : 'done'}
            </Pill>
            <ThemedText type="small" style={styles.muted}>
              Day {mission.dayNumber ?? mission.sequence}
              {scheduledDate ? ` · ${scheduledDate}` : ''}
              {typeof mission.repeatTotal === 'number' && mission.repeatTotal > 1
                ? ` · repeat ${mission.repeatIndex ?? 1}/${mission.repeatTotal}`
                : ''}
              </ThemedText>
            </View>
          <InfoPopover
            title="About this mission"
            accessibilityLabel="Show mission details"
            sections={legacyContext}
          />
          <Pressable
            accessibilityLabel={readOnly ? 'Close day preview' : 'Close mission'}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <ThemedText style={styles.closeText}>×</ThemedText>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          {phase === 'instructions' ? (
            <>
              <View style={styles.titleBlock}>
                <ThemedText type="title">{mission.title}</ThemedText>
                <ThemedText type="small" style={styles.muted}>{modeSummary}</ThemedText>
              </View>

              {isRoutine ? <RoutinePlan actions={routineActions} /> : <MissionSteps steps={steps} />}
              {isRoutine && explicitSteps.length ? (
                <MissionSteps steps={explicitSteps} title="technique and sequence" />
              ) : null}
              <View style={styles.footerActions}>
                {readOnly ? (
                  <AppButton label="Close preview" variant="secondary" onPress={onClose} />
                ) : (
                  <AppButton
                    label={
                      isLegacyTimed
                        ? `Start ${formatDuration(timerSeconds)}`
                        : isRoutine
                          ? 'Start the first set'
                          : 'Start mission'
                    }
                    icon="→"
                    onPress={start}
                  />
                )}
              </View>
            </>
          ) : null}

          {phase === 'countdown' ? (
            <View style={styles.countdownStage}>
              <ThemedText type="subtitle">Get ready</ThemedText>
              <ThemedText accessibilityLiveRegion="assertive" style={styles.countdownNumber}>
                {countdownSeconds}
              </ThemedText>
              <ThemedText type="small" style={styles.muted} numberOfLines={2}>
                {isRoutine ? routineActions[0]?.title : activeStep}
              </ThemedText>
              <AppButton label="Cancel" variant="secondary" onPress={restart} />
            </View>
          ) : null}

          {phase === 'running' ? (
            <>
              <View style={styles.runningTitle}>
                <ThemedText type="smallBold" style={styles.gold}>
                  {mission.title}
                </ThemedText>
                <ThemedText
                  accessibilityLiveRegion="polite"
                  style={styles.clock}>
                  {formatClock(shownSeconds)}
                </ThemedText>
                <ThemedText style={styles.center}>
                  {isRoutine && routineStage === 'rest'
                    ? 'rest'
                    : hasStageCountdown
                      ? isRoutine
                        ? 'remaining in this set'
                        : 'remaining'
                      : 'elapsed'}
                </ThemedText>
              </View>

              <View style={styles.progressBlock}>
                <View style={styles.progressLabelRow}>
                  <ThemedText type="eyebrow" style={styles.muted}>
                    progress
                  </ThemedText>
                  <ThemedText type="small" style={styles.muted}>
                    {isRoutine
                      ? routineStage === 'rest'
                        ? `rest · up next ${routineActionIndex + 1}/${routineActions.length}`
                        : `action ${routineActionIndex + 1}/${routineActions.length} · set ${routineSetIndex + 1}/${activeRoutineAction?.sets ?? 1}`
                      : isLegacyTimed
                        ? `${Math.round(timerProgress * 100)}%`
                        : `step ${stepIndex + 1} of ${steps.length}`}
                  </ThemedText>
                </View>
                <ProgressBar
                  value={progressValue}
                  color={isLegacyTimed || isRoutine ? Palette.cyan : Palette.gold}
                  height={10}
                />
              </View>

              {isRoutine && activeRoutineAction ? (
                <ActiveRoutineAction
                  action={activeRoutineAction}
                  actionIndex={routineActionIndex}
                  setIndex={routineSetIndex}
                  stage={routineStage}
                />
              ) : (
                <View style={styles.activeStepCard}>
                  <ThemedText type="eyebrow" style={styles.gold}>
                    {isLegacyTimed ? 'now' : `step ${stepIndex + 1}`}
                  </ThemedText>
                  <ThemedText type="subtitle">{activeStep}</ThemedText>
                </View>
              )}

              <View style={styles.footerActions}>
                {isRoutine && routineStage === 'rest' ? (
                  <AppButton
                    label="Skip rest"
                    onPress={() => startRoutineWork(activeRoutineAction, Date.now())}
                    icon="→"
                  />
                ) : null}
                {isRoutine &&
                routineStage === 'work' &&
                !getRoutineActionSeconds(activeRoutineAction) ? (
                  <AppButton
                    label="Set complete"
                    onPress={() => completeRoutineSet(Date.now())}
                    icon="→"
                  />
                ) : null}
                {isRoutine &&
                routineStage === 'work' &&
                getRoutineActionSeconds(activeRoutineAction) ? (
                  <AppButton
                    label="Finish set now"
                    onPress={() => completeRoutineSet(Date.now(), false)}
                    icon="→"
                  />
                ) : null}
                {!isRoutine && !isLegacyTimed ? (
                  <AppButton
                    label={
                      stepIndex < steps.length - 1
                        ? 'Step complete — next'
                        : 'Finish mission'
                    }
                    onPress={advanceManualStep}
                    icon="→"
                  />
                ) : null}
                <AppButton
                  label={
                    isRoutine
                      ? 'Stop the routine'
                      : isLegacyTimed
                        ? 'Stop early'
                        : 'Stop and review result'
                  }
                  variant="secondary"
                  onPress={() => finish('stopped')}
                />
              </View>
            </>
          ) : null}

          {phase === 'finished' ? (
            <>
              <View style={styles.finishedIcon}>
                <ThemedText style={styles.finishedGlyph}>
                  {finishReason === 'elapsed' ? '◷' : finishReason === 'completed' ? '✓' : '■'}
                </ThemedText>
              </View>
              <View style={styles.titleBlock}>
                <ThemedText type="title" style={styles.center}>
                  {finishReason === 'elapsed'
                    ? 'Time is up'
                    : finishReason === 'completed'
                      ? isRoutine
                        ? routineShortSets > 0
                          ? 'Routine finished with shortened sets'
                          : 'All sets completed'
                        : 'All steps completed'
                      : 'Mission stopped'}
                </ThemedText>
                <ThemedText type="small" style={[styles.muted, styles.center]}>
                  {formatDuration(Math.max(1, Math.round(elapsedMs / 1000)))}
                </ThemedText>
              </View>

              <View style={styles.footerActions}>
                {readOnly ? (
                  <AppButton label="Close preview" variant="secondary" onPress={onClose} />
                ) : (
                  <AppButton label="Continue to check-in" icon="→" onPress={onCheckIn} />
                )}
                <AppButton label="Repeat mission" variant="ghost" onPress={restart} />
              </View>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function RoutinePlan({ actions }: { actions: RoutineAction[] }) {
  return (
    <View style={styles.stepsBlock}>
      <ThemedText type="eyebrow" style={styles.muted}>
        sequence
      </ThemedText>
      <View style={styles.actionCards}>
        {actions.map((action, index) => (
          <View key={`${index}-${action.title}`} style={styles.actionCard}>
            <View style={styles.actionTitleRow}>
              <View style={styles.stepNumber}>
                <ThemedText type="smallBold" style={styles.gold}>
                  {index + 1}
                </ThemedText>
              </View>
              <View style={styles.actionTitleCopy}>
                <ThemedText type="smallBold">{action.title}</ThemedText>
                <ThemedText type="smallBold" style={styles.cyan}>
                  {formatRoutinePrescription(action)}
                </ThemedText>
              </View>
              <RoutineActionInfo action={action} />
            </View>

            <ThemedText type="small" style={styles.actionInstruction}>
              {action.instruction}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

function ActiveRoutineAction({
  action,
  actionIndex,
  setIndex,
  stage,
}: {
  action: RoutineAction;
  actionIndex: number;
  setIndex: number;
  stage: RoutineStage;
}) {
  if (stage === 'rest') {
    return (
      <View style={[styles.activeStepCard, styles.restCard]}>
        <ThemedText type="eyebrow" style={styles.cyan}>
          rest · next action {actionIndex + 1}
        </ThemedText>
        <ThemedText type="subtitle">Next: {action.title}</ThemedText>
        <ThemedText style={styles.muted}>
          Set {setIndex + 1} of {action.sets} · {formatRoutineQuantity(action)}
        </ThemedText>
        <RoutineActionInfo action={action} />
      </View>
    );
  }

  return (
    <View style={styles.activeStepCard}>
      <ThemedText type="eyebrow" style={styles.gold}>
        action {actionIndex + 1} · set {setIndex + 1} of {action.sets}
      </ThemedText>
      <View style={styles.actionTitleRow}>
        <ThemedText type="subtitle" style={styles.actionTitle}>
          {action.title}
        </ThemedText>
        <RoutineActionInfo action={action} />
      </View>
      <ThemedText>{action.instruction}</ThemedText>
      <ThemedText type="smallBold" style={styles.cyan}>
        {formatRoutinePrescription(action)}
      </ThemedText>
    </View>
  );
}

function RoutineActionInfo({ action }: { action: RoutineAction }) {
  const sections: ContextInfoSection[] = [];
  if (action.successCriterion.trim()) {
    sections.push({ heading: 'Completion criterion', body: action.successCriterion.trim() });
  }
  if (action.loadBasis) {
    sections.push({ heading: 'Load calculation', body: formatLoadBasis(action.loadBasis) });
  }
  return (
    <InfoPopover
      title={action.title}
      accessibilityLabel={`Show details for ${action.title}`}
      sections={sections}
    />
  );
}

function MissionSteps({ steps, title = 'what to do' }: { steps: string[]; title?: string }) {
  return (
    <View style={styles.stepsBlock}>
      <ThemedText type="eyebrow" style={styles.muted}>
        {title}
      </ThemedText>
      <View style={styles.steps}>
        {steps.map((step, index) => (
          <View key={`${index}-${step}`} style={styles.stepRow}>
            <View style={styles.stepNumber}>
              <ThemedText type="smallBold" style={styles.gold}>
                {index + 1}
              </ThemedText>
            </View>
            <ThemedText style={styles.stepText}>{step}</ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

function legacyMissionContextSections(
  mission: Mission,
  descriptionIsContext: boolean,
  legacyRepeatRemaining?: number,
): ContextInfoSection[] {
  const sections: ContextInfoSection[] = [];
  if (descriptionIsContext && mission.description.trim()) {
    sections.push({ heading: 'About this mission', body: mission.description.trim() });
  }
  sections.push(...missionContextSections(mission));
  if (mission.completionCriterion?.trim()) {
    sections.push({ heading: 'Daily completion criterion', body: mission.completionCriterion.trim() });
  }
  if (legacyRepeatRemaining && legacyRepeatRemaining > 0) {
    sections.push({
      heading: 'Repeating the load',
      body: `After check-in, ${formatCount(legacyRepeatRemaining, ['identical session', 'identical sessions'])} will remain. The prescribed quantities will stay the same.`,
    });
  } else if (mission.progressionRule?.trim()) {
    sections.push({
      heading: 'Next load rule',
      body: mission.progressionRule.trim(),
    });
  }
  return sections;
}

function formatClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0.01, totalSeconds);
  if (safeSeconds < 60) return `${formatNumber(safeSeconds)} sec`;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds - minutes * 60;
  if (Math.abs(seconds) < 0.001) return `${minutes} min`;
  return `${minutes} min ${formatNumber(seconds)} sec`;
}

function getRoutineActionSeconds(action?: RoutineAction) {
  if (!action) return 0;
  if (action.unit === 'seconds') return Math.max(0.01, action.quantity);
  if (action.unit === 'minutes') return Math.max(0.01, action.quantity * 60);
  return 0;
}

function formatRoutineQuantity(action: RoutineAction) {
  if (action.unit === 'seconds' || action.unit === 'minutes') {
    return formatDuration(getRoutineActionSeconds(action));
  }

  const quantity = formatNumber(action.quantity);
  const units: Record<RoutineAction['unit'], string> = {
    reps: action.quantity === 1 ? 'rep' : 'reps',
    seconds: 'sec',
    minutes: 'min',
    pages: action.quantity === 1 ? 'page' : 'pages',
    items: action.quantity === 1 ? 'item' : 'items',
    words: action.quantity === 1 ? 'word' : 'words',
    meters: 'm',
    attempts: action.quantity === 1 ? 'attempt' : 'attempts',
    custom: action.unitLabel?.trim() || (action.quantity === 1 ? 'unit' : 'units'),
  };
  return `${quantity} ${units[action.unit]}`;
}

function formatRoutinePrescription(action: RoutineAction) {
  return [
    `${action.sets} × ${formatRoutineQuantity(action)}`,
    action.restSeconds > 0 ? `rest ${formatDuration(action.restSeconds)}` : undefined,
    action.tempo?.trim() || undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
}

function formatLoadBasis(value: RoutineLoadBasis | string) {
  if (typeof value === 'string') return value;
  const percentage = formatNumber(value.percentage);
  const baseValue = formatNumber(value.baseValue);
  const result = formatNumber(value.result);
  return `${percentage}% × ${baseValue} ${value.baseUnit} = ${result} ${value.baseUnit}`;
}

function formatNumber(value: number) {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(4)));
}

function formatCount(value: number, forms: [string, string]) {
  const safeValue = Math.max(0, Math.round(value));
  return `${safeValue} ${safeValue === 1 ? forms[0] : forms[1]}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Palette.inkRaised },
  handle: {
    alignSelf: 'center',
    width: 46,
    height: 5,
    borderRadius: 3,
    backgroundColor: Palette.line,
    marginTop: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.three,
  },
  headerCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  close: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: Palette.surface,
  },
  closeText: { color: Palette.textMuted, fontSize: 27, lineHeight: 29 },
  pressed: { opacity: 0.72 },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  titleBlock: { gap: Spacing.two },
  muted: { color: Palette.textMuted },
  gold: { color: Palette.goldBright },
  cyan: { color: Palette.cyan },
  center: { textAlign: 'center' },
  stepsBlock: { gap: Spacing.two },
  steps: { gap: Spacing.two },
  actionCards: { gap: Spacing.two },
  actionCard: {
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.twoHalf,
    gap: Spacing.two,
  },
  actionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.twoHalf },
  actionTitle: { flex: 1 },
  actionTitleCopy: { flex: 1, gap: 2 },
  actionInstruction: { color: Palette.text, lineHeight: 21 },
  stepRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
    paddingVertical: Spacing.two,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 122, 255, 0.2)',
  },
  stepText: { flex: 1 },
  footerActions: { gap: Spacing.two },
  countdownStage: {
    flex: 1,
    minHeight: 420,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  countdownNumber: {
    color: Palette.accent,
    fontSize: 112,
    lineHeight: 126,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  runningTitle: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.four },
  clock: {
    color: Palette.text,
    fontSize: 68,
    lineHeight: 76,
    fontWeight: '800',
    letterSpacing: -3,
    fontVariant: ['tabular-nums'],
  },
  progressBlock: { gap: Spacing.two },
  progressLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activeStepCard: {
    minHeight: 132,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.two,
  },
  restCard: {
    borderColor: 'rgba(0, 122, 255, 0.2)',
    backgroundColor: 'rgba(0, 122, 255, 0.06)',
  },
  finishedIcon: {
    alignSelf: 'center',
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(36, 138, 61, 0.22)',
    marginTop: Spacing.four,
  },
  finishedGlyph: { color: Palette.success, fontSize: 36 },
});
