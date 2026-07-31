import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppButton, Pill, ProgressBar } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { Mission } from '@/domain/types';

type RunnerPhase = 'instructions' | 'running' | 'finished';
type FinishReason = 'completed' | 'elapsed' | 'stopped';

export function MissionRunner({
  mission,
  visible,
  onClose,
  onCheckIn,
}: {
  mission?: Mission;
  visible: boolean;
  onClose(): void;
  onCheckIn(): void;
}) {
  const [phase, setPhase] = useState<RunnerPhase>('instructions');
  const [startedAt, setStartedAt] = useState<number>();
  const [endAt, setEndAt] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const [stepIndex, setStepIndex] = useState(0);
  const [finishReason, setFinishReason] = useState<FinishReason>();

  const steps = useMemo(() => {
    const explicitSteps = mission?.steps?.filter((step) => step.trim().length > 0) ?? [];
    if (explicitSteps.length) return explicitSteps;
    if (mission?.description.trim()) return [mission.description];
    return ['Выполни миссию в своём темпе.'];
  }, [mission?.description, mission?.steps]);

  const timerSeconds =
    mission?.execution?.kind === 'timer'
      ? Math.max(1, Math.round(mission.execution.durationSeconds))
      : 0;
  const isTimed = timerSeconds > 0;
  const durationMs = timerSeconds * 1000;

  useEffect(() => {
    setPhase('instructions');
    setStartedAt(undefined);
    setEndAt(undefined);
    setNow(Date.now());
    setStepIndex(0);
    setFinishReason(undefined);
  }, [mission?.id]);

  useEffect(() => {
    if (!visible || phase !== 'running') return;

    const tick = () => {
      const currentTime = Date.now();
      setNow(currentTime);

      if (endAt && currentTime >= endAt) {
        setFinishReason('elapsed');
        setPhase('finished');
      }
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [endAt, phase, visible]);

  if (!mission) return null;

  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const remainingMs = endAt ? Math.max(0, endAt - now) : durationMs;
  const timerProgress = durationMs ? Math.min(1, elapsedMs / durationMs) : 0;
  const manualProgress = steps.length ? stepIndex / steps.length : 0;
  const activeStep = isTimed ? mission.title : steps[Math.min(stepIndex, steps.length - 1)];

  const start = () => {
    const startTime = Date.now();
    setStartedAt(startTime);
    setNow(startTime);
    setEndAt(isTimed ? startTime + durationMs : undefined);
    setStepIndex(0);
    setFinishReason(undefined);
    setPhase('running');
  };

  const finish = (reason: FinishReason) => {
    setNow(Date.now());
    setFinishReason(reason);
    setPhase('finished');
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
            <Pill tone={phase === 'running' ? 'success' : 'gold'}>
              {phase === 'instructions'
                ? 'подготовка'
                : phase === 'running'
                  ? 'миссия идёт'
                  : 'выполнение завершено'}
            </Pill>
            <ThemedText type="small" style={styles.muted}>
              Миссия {mission.sequence}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="Закрыть миссию"
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
                  <ThemedText style={styles.modeGlyph}>{isTimed ? '◷' : '→'}</ThemedText>
                </View>
                <View style={styles.modeCopy}>
                  <ThemedText type="smallBold">
                    {isTimed ? `Таймер на ${formatDuration(timerSeconds)}` : 'Выполнение в своём темпе'}
                  </ThemedText>
                  <ThemedText type="small" style={styles.muted}>
                    {isTimed
                      ? 'Отсчёт начнётся только после нажатия кнопки.'
                      : 'Во время миссии будет виден прошедший срок и текущий шаг.'}
                  </ThemedText>
                </View>
              </View>

              <MissionSteps steps={steps} />
              {mission.warning ? <MissionWarning warning={mission.warning} /> : null}

              <View style={styles.footerActions}>
                <AppButton
                  label={isTimed ? `Запустить ${formatDuration(timerSeconds)}` : 'Начать выполнение'}
                  icon="→"
                  onPress={start}
                />
                <ThemedText type="small" style={[styles.muted, styles.center]}>
                  Результат не запишется автоматически — после выполнения ты сам его оценишь.
                </ThemedText>
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
                  {formatClock(Math.ceil((isTimed ? remainingMs : elapsedMs) / 1000))}
                </ThemedText>
                <ThemedText style={styles.center}>
                  {isTimed ? 'осталось' : 'прошло с начала'}
                </ThemedText>
              </View>

              <View style={styles.progressBlock}>
                <View style={styles.progressLabelRow}>
                  <ThemedText type="eyebrow" style={styles.muted}>
                    прогресс
                  </ThemedText>
                  <ThemedText type="small" style={styles.muted}>
                    {isTimed
                      ? `${Math.round(timerProgress * 100)}%`
                      : `шаг ${stepIndex + 1} из ${steps.length}`}
                  </ThemedText>
                </View>
                <ProgressBar
                  value={isTimed ? timerProgress : manualProgress}
                  color={isTimed ? Palette.cyan : Palette.gold}
                  height={10}
                />
              </View>

              <View style={styles.activeStepCard}>
                <ThemedText type="eyebrow" style={styles.gold}>
                  {isTimed ? 'сейчас' : `шаг ${stepIndex + 1}`}
                </ThemedText>
                <ThemedText type="subtitle">{activeStep}</ThemedText>
              </View>

              {mission.warning ? <MissionWarning warning={mission.warning} compact /> : null}

              <View style={styles.footerActions}>
                {!isTimed ? (
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
                  label={isTimed ? 'Остановить раньше' : 'Остановить и оценить результат'}
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
                      ? 'Все шаги пройдены'
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
              </View>

              <View style={styles.footerActions}>
                <AppButton label="Перейти к check-in" icon="→" onPress={onCheckIn} />
                <AppButton label="Повторить миссию" variant="ghost" onPress={restart} />
              </View>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function MissionSteps({ steps }: { steps: string[] }) {
  return (
    <View style={styles.stepsBlock}>
      <ThemedText type="eyebrow" style={styles.muted}>
        что делать
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
  const safeSeconds = Math.max(1, Math.round(totalSeconds));
  if (safeSeconds < 60) return `${safeSeconds} сек`;
  if (safeSeconds % 60 === 0) return `${safeSeconds / 60} мин`;
  return `${Math.floor(safeSeconds / 60)} мин ${safeSeconds % 60} сек`;
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
