import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { InAppMissionRunner } from './in-app-mission-runner';
import { AppButton, Pill, ProgressBar } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import type { Mission, RoutineAction, RoutineLoadBasis } from '@/domain/types';
import { formatCalendarDate } from '@/lib/calendar-date';
import { useApp } from '@/state';

type RunnerPhase = 'instructions' | 'running' | 'finished';
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
    return ['Выполни миссию в своём темпе.'];
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
  const legacyRepeatRemaining =
    typeof mission.repeatTotal === 'number'
      ? Math.max(0, mission.repeatTotal - (mission.repeatIndex ?? 1))
      : undefined;
  const scheduledDate = formatCalendarDate(mission.scheduledDate);

  const start = () => {
    if (readOnly) return;
    const startTime = Date.now();
    setStartedAt(startTime);
    setNow(startTime);
    setEndAt(isLegacyTimed ? startTime + durationMs : undefined);
    setStepIndex(0);
    setFinishReason(undefined);
    setRoutineActionIndex(0);
    setRoutineSetIndex(0);
    setRoutineCompletedSets(0);
    setRoutineShortSets(0);
    setStageStartedAt(undefined);
    completedRoutineSetKey.current = undefined;

    if (isRoutine) {
      startRoutineWork(routineActions[0], startTime);
    }

    setPhase('running');
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
            <Pill tone={phase === 'running' ? 'success' : readOnly ? 'violet' : 'gold'}>
              {readOnly
                ? 'просмотр плана'
                : phase === 'instructions'
                  ? 'подготовка'
                  : phase === 'running'
                    ? 'миссия идёт'
                    : 'выполнение завершено'}
            </Pill>
            <ThemedText type="small" style={styles.muted}>
              День {mission.dayNumber ?? mission.sequence}
              {scheduledDate ? ` · ${scheduledDate}` : ''}
              {typeof mission.repeatTotal === 'number' && mission.repeatTotal > 1
                ? ` · повтор ${mission.repeatIndex ?? 1}/${mission.repeatTotal}`
                : ''}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel={readOnly ? 'Закрыть просмотр дня' : 'Закрыть миссию'}
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
                <ThemedText style={styles.description}>{mission.description}</ThemedText>
              </View>

              <View style={styles.modeCard}>
                <View style={styles.modeIcon}>
                  <ThemedText style={styles.modeGlyph}>
                    {isLegacyTimed ? '◷' : isRoutine ? '≡' : '→'}
                  </ThemedText>
                </View>
                <View style={styles.modeCopy}>
                  <ThemedText type="smallBold">
                    {isLegacyTimed
                      ? `Таймер на ${formatDuration(timerSeconds)}`
                      : isRoutine
                        ? `${formatCount(routineActions.length, ['действие', 'действия', 'действий'])} · ${formatCount(routineTotalSets, ['подход', 'подхода', 'подходов'])}`
                        : 'Выполнение в своём темпе'}
                  </ThemedText>
                  <ThemedText type="small" style={styles.muted}>
                    {readOnly
                      ? 'Ниже показана полная схема дня. Запуск и check-in остаются у текущего дня.'
                      : isLegacyTimed
                        ? 'Отсчёт начнётся только после нажатия кнопки.'
                        : isRoutine
                          ? 'Приложение проведёт по каждому подходу, включит рабочие таймеры и отдых.'
                          : 'Во время миссии будет виден прошедший срок и текущий шаг.'}
                  </ThemedText>
                </View>
              </View>

              {isRoutine ? <RoutinePlan actions={routineActions} /> : <MissionSteps steps={steps} />}
              {isRoutine && explicitSteps.length ? (
                <MissionSteps steps={explicitSteps} title="техника и порядок" />
              ) : null}
              <MissionOutcomeDetails
                completionCriterion={mission.completionCriterion}
                progressionRule={mission.progressionRule}
                legacyRepeatRemaining={legacyRepeatRemaining}
              />
              {mission.warning ? <MissionWarning warning={mission.warning} /> : null}

              <View style={styles.footerActions}>
                {readOnly ? (
                  <>
                    <AppButton label="Закрыть просмотр" variant="secondary" onPress={onClose} />
                    <ThemedText type="small" style={[styles.muted, styles.center]}>
                      Это другой день календаря. Здесь можно проверить точную нагрузку, но check-in
                      остаётся у текущего дня.
                    </ThemedText>
                  </>
                ) : (
                  <>
                    <AppButton
                      label={
                        isLegacyTimed
                          ? `Запустить ${formatDuration(timerSeconds)}`
                          : isRoutine
                            ? 'Начать первый подход'
                            : 'Начать выполнение'
                      }
                      icon="→"
                      onPress={start}
                    />
                    <ThemedText type="small" style={[styles.muted, styles.center]}>
                      Результат не запишется автоматически — после выполнения ты сам его оценишь.
                    </ThemedText>
                  </>
                )}
              </View>
            </>
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
                    ? 'отдых'
                    : hasStageCountdown
                      ? isRoutine
                        ? 'осталось в подходе'
                        : 'осталось'
                      : 'прошло с начала'}
                </ThemedText>
              </View>

              <View style={styles.progressBlock}>
                <View style={styles.progressLabelRow}>
                  <ThemedText type="eyebrow" style={styles.muted}>
                    прогресс
                  </ThemedText>
                  <ThemedText type="small" style={styles.muted}>
                    {isRoutine
                      ? routineStage === 'rest'
                        ? `отдых · дальше ${routineActionIndex + 1}/${routineActions.length}`
                        : `действие ${routineActionIndex + 1}/${routineActions.length} · подход ${routineSetIndex + 1}/${activeRoutineAction?.sets ?? 1}`
                      : isLegacyTimed
                        ? `${Math.round(timerProgress * 100)}%`
                        : `шаг ${stepIndex + 1} из ${steps.length}`}
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
                    {isLegacyTimed ? 'сейчас' : `шаг ${stepIndex + 1}`}
                  </ThemedText>
                  <ThemedText type="subtitle">{activeStep}</ThemedText>
                </View>
              )}

              {mission.warning ? <MissionWarning warning={mission.warning} compact /> : null}

              <View style={styles.footerActions}>
                {isRoutine && routineStage === 'rest' ? (
                  <AppButton
                    label="Пропустить отдых"
                    onPress={() => startRoutineWork(activeRoutineAction, Date.now())}
                    icon="→"
                  />
                ) : null}
                {isRoutine &&
                routineStage === 'work' &&
                !getRoutineActionSeconds(activeRoutineAction) ? (
                  <AppButton
                    label="Подход выполнен"
                    onPress={() => completeRoutineSet(Date.now())}
                    icon="→"
                  />
                ) : null}
                {isRoutine &&
                routineStage === 'work' &&
                getRoutineActionSeconds(activeRoutineAction) ? (
                  <AppButton
                    label="Завершить подход сейчас"
                    onPress={() => completeRoutineSet(Date.now(), false)}
                    icon="→"
                  />
                ) : null}
                {!isRoutine && !isLegacyTimed ? (
                  <AppButton
                    label={
                      stepIndex < steps.length - 1
                        ? 'Этот шаг выполнен — дальше'
                        : 'Закончить выполнение'
                    }
                    onPress={advanceManualStep}
                    icon="→"
                  />
                ) : null}
                <AppButton
                  label={
                    isRoutine
                      ? 'Остановить весь комплекс'
                      : isLegacyTimed
                        ? 'Остановить раньше'
                        : 'Остановить и оценить результат'
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
                    ? 'Время вышло'
                    : finishReason === 'completed'
                      ? isRoutine
                        ? routineShortSets > 0
                          ? 'Комплекс пройден с сокращениями'
                          : 'Все подходы выполнены'
                        : 'Все шаги пройдены'
                      : 'Выполнение остановлено'}
                </ThemedText>
                <ThemedText style={[styles.description, styles.center]}>
                  В миссии прошло {formatDuration(Math.max(1, Math.round(elapsedMs / 1000)))}. Это ещё
                  не отчёт — отметь честный результат следующим шагом.
                </ThemedText>
              </View>

              <View style={styles.resultCard}>
                <View style={styles.resultRow}>
                  <ThemedText type="small" style={styles.muted}>
                    Результат
                  </ThemedText>
                  <ThemedText type="smallBold">ещё не выбран</ThemedText>
                </View>
                <View style={styles.resultRow}>
                  <ThemedText type="small" style={styles.muted}>
                    Награда
                  </ThemedText>
                  <ThemedText type="smallBold" style={styles.gold}>
                    до +{mission.xp} XP
                  </ThemedText>
                </View>
                {isRoutine && routineShortSets > 0 ? (
                  <View style={styles.resultRow}>
                    <ThemedText type="small" style={styles.muted}>
                      Завершено раньше цели
                    </ThemedText>
                    <ThemedText type="smallBold" style={styles.warningText}>
                      {routineShortSets} из {routineTotalSets}
                    </ThemedText>
                  </View>
                ) : null}
              </View>

              <MissionOutcomeDetails
                completionCriterion={mission.completionCriterion}
                progressionRule={mission.progressionRule}
                legacyRepeatRemaining={legacyRepeatRemaining}
              />

              <View style={styles.footerActions}>
                {readOnly ? (
                  <AppButton label="Закрыть просмотр" variant="secondary" onPress={onClose} />
                ) : (
                  <AppButton label="Перейти к check-in" icon="→" onPress={onCheckIn} />
                )}
                <AppButton label="Повторить миссию" variant="ghost" onPress={restart} />
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
        точный порядок
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
              <ThemedText type="subtitle" style={styles.actionTitle}>
                {action.title}
              </ThemedText>
            </View>

            <ThemedText style={styles.actionInstruction}>{action.instruction}</ThemedText>

            <View style={styles.prescriptionGrid}>
              <PrescriptionValue
                label="объём"
                value={`${formatCount(action.sets, ['подход', 'подхода', 'подходов'])} × ${formatRoutineQuantity(action)}`}
              />
              {action.workSecondsPerSet ? (
                <PrescriptionValue
                  label="время подхода"
                  value={`≈ ${formatDuration(action.workSecondsPerSet)}`}
                />
              ) : null}
              <PrescriptionValue
                label="отдых"
                value={
                  action.restSeconds > 0
                    ? formatDuration(action.restSeconds)
                    : 'без отдельного отдыха'
                }
              />
              {action.tempo ? <PrescriptionValue label="темп" value={action.tempo} /> : null}
              {action.loadBasis ? (
                <PrescriptionValue
                  label="расчёт нагрузки"
                  value={formatLoadBasis(action.loadBasis)}
                />
              ) : null}
            </View>

            <View style={styles.actionCriterion}>
              <ThemedText type="eyebrow" style={styles.successLabel}>
                подход засчитан, если
              </ThemedText>
              <ThemedText type="small">{action.successCriterion}</ThemedText>
            </View>
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
          отдых · затем действие {actionIndex + 1}
        </ThemedText>
        <ThemedText type="subtitle">Дальше: {action.title}</ThemedText>
        <ThemedText style={styles.muted}>
          Подход {setIndex + 1} из {action.sets} · {formatRoutineQuantity(action)}
        </ThemedText>
        {action.loadBasis ? <LoadBasis value={action.loadBasis} /> : null}
      </View>
    );
  }

  return (
    <View style={styles.activeStepCard}>
      <ThemedText type="eyebrow" style={styles.gold}>
        действие {actionIndex + 1} · подход {setIndex + 1} из {action.sets}
      </ThemedText>
      <ThemedText type="subtitle">{action.title}</ThemedText>
      <ThemedText>{action.instruction}</ThemedText>
      <View style={styles.activePrescription}>
        <ThemedText type="smallBold" style={styles.cyan}>
          {formatRoutineQuantity(action)}
        </ThemedText>
        {action.tempo ? (
          <ThemedText type="small" style={styles.muted}>
            Темп: {action.tempo}
          </ThemedText>
        ) : null}
        {action.workSecondsPerSet && !getRoutineActionSeconds(action) ? (
          <ThemedText type="small" style={styles.muted}>
            Расчётное время подхода: ≈ {formatDuration(action.workSecondsPerSet)}
          </ThemedText>
        ) : null}
        {action.loadBasis ? <LoadBasis value={action.loadBasis} /> : null}
      </View>
      <View style={styles.actionCriterion}>
        <ThemedText type="eyebrow" style={styles.successLabel}>
          результат подхода
        </ThemedText>
        <ThemedText type="small">{action.successCriterion}</ThemedText>
      </View>
    </View>
  );
}

function PrescriptionValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.prescriptionValue}>
      <ThemedText type="eyebrow" style={styles.muted}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

function LoadBasis({ value }: { value: RoutineLoadBasis | string }) {
  return (
    <View style={styles.loadBasis}>
      <ThemedText type="eyebrow" style={styles.muted}>
        расчёт нагрузки
      </ThemedText>
      <ThemedText type="small">{formatLoadBasis(value)}</ThemedText>
    </View>
  );
}

function MissionOutcomeDetails({
  completionCriterion,
  progressionRule,
  legacyRepeatRemaining,
}: {
  completionCriterion?: string;
  progressionRule?: string;
  legacyRepeatRemaining?: number;
}) {
  if (!completionCriterion && !progressionRule && !legacyRepeatRemaining) return null;

  return (
    <View style={styles.outcomeCard}>
      {completionCriterion ? (
        <View style={styles.outcomeSection}>
          <ThemedText type="eyebrow" style={styles.successLabel}>
            миссия выполнена, если
          </ThemedText>
          <ThemedText>{completionCriterion}</ThemedText>
        </View>
      ) : null}
      {legacyRepeatRemaining !== undefined && legacyRepeatRemaining > 0 ? (
        <View style={styles.outcomeSection}>
          <ThemedText type="eyebrow" style={styles.cyan}>
            сначала закрепи эту дозировку
          </ThemedText>
          <ThemedText>
            После check-in впереди ещё{' '}
            {formatCount(legacyRepeatRemaining, ['такая же сессия', 'такие же сессии', 'таких же сессий'])}.
            Числа останутся прежними.
          </ThemedText>
        </View>
      ) : progressionRule ? (
        <View style={styles.outcomeSection}>
          <ThemedText type="eyebrow" style={styles.cyan}>
            правило корректировки календарной нагрузки
          </ThemedText>
          <ThemedText>{progressionRule}</ThemedText>
          <ThemedText type="small" style={styles.muted}>
            Используй это правило как ориентир при пересмотре нагрузки следующих дней после
            check-in.
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function MissionSteps({ steps, title = 'что делать' }: { steps: string[]; title?: string }) {
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

function MissionWarning({ warning, compact = false }: { warning: string; compact?: boolean }) {
  return (
    <View style={[styles.warningCard, compact && styles.warningCardCompact]}>
      <ThemedText type="eyebrow" style={styles.warningText}>
        важно знать
      </ThemedText>
      <ThemedText type={compact ? 'small' : 'default'}>{warning}</ThemedText>
      {!compact ? (
        <ThemedText type="small" style={styles.muted}>
          Это подсказка, а не блокировка: ты сам решаешь, как выполнять миссию.
        </ThemedText>
      ) : null}
    </View>
  );
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
  if (safeSeconds < 60) return `${formatNumber(safeSeconds)} сек`;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds - minutes * 60;
  if (Math.abs(seconds) < 0.001) return `${minutes} мин`;
  return `${minutes} мин ${formatNumber(seconds)} сек`;
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
    reps: 'повт.',
    seconds: 'сек',
    minutes: 'мин',
    pages: 'стр.',
    items: 'элементов',
    words: 'слов',
    meters: 'м',
    attempts: 'попыток',
    custom: action.unitLabel?.trim() || 'ед.',
  };
  return `${quantity} ${units[action.unit]}`;
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
  return String(Number(value.toFixed(4))).replace('.', ',');
}

function formatCount(value: number, forms: [string, string, string]) {
  const safeValue = Math.max(0, Math.round(value));
  const lastTwo = safeValue % 100;
  const last = safeValue % 10;
  const form =
    lastTwo >= 11 && lastTwo <= 14
      ? forms[2]
      : last === 1
        ? forms[0]
        : last >= 2 && last <= 4
          ? forms[1]
          : forms[2];
  return `${safeValue} ${form}`;
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
    gap: Spacing.four,
  },
  titleBlock: { gap: Spacing.two },
  description: { color: Palette.textMuted, fontSize: 17, lineHeight: 26 },
  muted: { color: Palette.textMuted },
  gold: { color: Palette.goldBright },
  cyan: { color: Palette.cyan },
  successLabel: { color: Palette.success },
  warningText: { color: Palette.warning },
  center: { textAlign: 'center' },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.three,
  },
  modeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#20273A',
    borderWidth: 1,
    borderColor: '#38435F',
  },
  modeGlyph: { color: Palette.cyan, fontSize: 24 },
  modeCopy: { flex: 1, gap: Spacing.one },
  stepsBlock: { gap: Spacing.two },
  steps: { gap: Spacing.two },
  actionCards: { gap: Spacing.three },
  actionCard: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.three,
    gap: Spacing.twoHalf,
  },
  actionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.twoHalf },
  actionTitle: { flex: 1 },
  actionInstruction: { color: Palette.text, lineHeight: 23 },
  prescriptionGrid: { gap: Spacing.two },
  prescriptionValue: {
    borderRadius: Radius.small,
    backgroundColor: '#20273A',
    paddingHorizontal: Spacing.twoHalf,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  actionCriterion: {
    borderTopWidth: 1,
    borderTopColor: Palette.line,
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
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
    backgroundColor: '#2B2418',
    borderWidth: 1,
    borderColor: '#5C4929',
  },
  stepText: { flex: 1 },
  warningCard: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: '#59402B',
    backgroundColor: '#2D2319',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  warningCardCompact: { padding: Spacing.twoHalf },
  footerActions: { gap: Spacing.two },
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
    borderWidth: 1,
    borderColor: '#52462F',
    backgroundColor: Palette.surface,
    padding: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.two,
  },
  restCard: { borderColor: '#31556A', backgroundColor: '#142631' },
  activePrescription: {
    borderRadius: Radius.small,
    backgroundColor: '#20273A',
    padding: Spacing.twoHalf,
    gap: Spacing.one,
  },
  loadBasis: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  outcomeCard: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: '#31556A',
    backgroundColor: '#14222D',
    padding: Spacing.three,
    gap: Spacing.three,
  },
  outcomeSection: { gap: Spacing.one },
  finishedIcon: {
    alignSelf: 'center',
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1B3027',
    borderWidth: 1,
    borderColor: '#36634E',
    marginTop: Spacing.four,
  },
  finishedGlyph: { color: Palette.success, fontSize: 36 },
  resultCard: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
