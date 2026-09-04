import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { AppButton, Pill, ProgressBar } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import {
  isMissionRunSuccessful,
  missionRunSummary,
} from '@/domain/mission-run';
import {
  MISSION_RUN_PREPARATION_SECONDS,
  advanceMissionRunTimedStage,
  checkpointMissionRunWork,
  completeCounterMissionRunSet,
  completeSimpleMissionRunBlock,
  completeTimerMissionRunSet,
  continueMissionRunAfterReview,
  skipMissionRunBlock,
  startMissionRunWork,
} from '@/domain/mission-run-machine';
import type {
  CounterExecutionBlock,
  Mission,
  MissionExecutionBlock,
  MissionRun,
  MissionRunBlockResult,
  MissionRunFinishReason,
  MissionRunMutation,
} from '@/domain/types';
import { formatCalendarDate } from '@/lib/calendar-date';
import {
  executionBlockContextSections,
  missionContextSections,
  type ContextInfoSection,
} from '@/shared/presentation/context-info';
import {
  actionableExecutionBlocks,
  isSafetyOnlyExecutionBlock,
  withoutExecutionSafetyCopy,
} from '@/shared/presentation/execution-visibility';

type Props = {
  mission: Mission;
  run?: MissionRun;
  visible: boolean;
  readOnly: boolean;
  persistenceStatus: 'loading' | 'saving' | 'saved' | 'error';
  onClose(): void;
  onBegin(): void;
  onSave(run: MissionRun): void;
  onMutate(runId: string, mutation: MissionRunMutation): void;
  onFinish(run: MissionRun, reason: MissionRunFinishReason): void;
  onCheckIn(runId: string): void;
  onRetryPersistence(): Promise<boolean>;
};

export function InAppMissionRunner({
  mission,
  run,
  visible,
  readOnly,
  persistenceStatus,
  onClose,
  onBegin,
  onSave,
  onMutate,
  onFinish,
  onCheckIn,
  onRetryPersistence,
}: Props) {
  const [now, setNow] = useState(Date.now());
  const skippedBlockRef = useRef<string | undefined>(undefined);
  const execution = mission.execution?.kind === 'in_app' ? mission.execution : undefined;
  const activeBlock = execution?.blocks[run?.cursor.blockIndex ?? 0];
  const activeResult = run?.blockResults[run.cursor.blockIndex];
  const visibleBlocks = execution ? actionableExecutionBlocks(execution.blocks) : [];
  const activeBlockIsHidden = activeBlock ? isSafetyOnlyExecutionBlock(activeBlock) : false;
  const scheduledDate = formatCalendarDate(mission.scheduledDate);

  useEffect(() => {
    if (!visible || run?.status !== 'running') return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [run?.status, visible]);

  useEffect(() => {
    if (
      !visible ||
      !run ||
      run.status !== 'running' ||
      !execution ||
      !activeBlockIsHidden
    ) {
      return;
    }

    const skipKey = `${run.id}:${run.cursor.blockIndex}`;
    if (skippedBlockRef.current === skipKey) return;
    skippedBlockRef.current = skipKey;
    const transition = skipMissionRunBlock(run, execution.blocks, new Date());
    if (!transition) return;
    if (transition.kind === 'finish') {
      onFinish(transition.run, transition.reason);
    } else {
      onSave(transition.run);
    }
  }, [activeBlockIsHidden, execution, onFinish, onSave, run, visible]);

  useEffect(() => {
    if (
      !visible ||
      !run ||
      run.status !== 'running' ||
      !run.stageEndsAt ||
      !['preparing', 'work', 'rest'].includes(run.cursor.stage)
    ) {
      return;
    }

    const deadlineMilliseconds = Date.parse(run.stageEndsAt);
    const timeout = setTimeout(() => {
      const checkpoint = advanceMissionRunTimedStage(run, execution?.blocks);
      if (checkpoint) onSave(checkpoint);
    }, Math.max(0, deadlineMilliseconds - Date.now()));
    return () => clearTimeout(timeout);
  }, [execution?.blocks, onSave, run, visible]);

  if (!execution) return null;

  const summary = run
    ? missionRunSummary(run)
    : { completedBlocks: 0, totalBlocks: 0, targetMetSets: 0, totalSets: 0 };
  const completedVisibleBlocks = run
    ? visibleBlocks.filter((block) => {
        const originalIndex = execution.blocks.indexOf(block);
        return run.blockResults[originalIndex]?.completed;
      }).length
    : 0;
  const progress = visibleBlocks.length
    ? completedVisibleBlocks / visibleBlocks.length
    : 0;
  const remainingSeconds = run?.stageEndsAt
    ? Math.max(0, Math.ceil((Date.parse(run.stageEndsAt) - now) / 1000))
    : 0;
  const elapsedSeconds = run?.stageStartedAt
    ? Math.max(0, Math.floor((now - Date.parse(run.stageStartedAt)) / 1000))
    : 0;
  const isAwaitingCheckIn = run?.status === 'awaiting_checkin';

  const requestClose = () => onClose();

  return (
    <Modal
      animationType="slide"
      onRequestClose={requestClose}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Pill tone={isAwaitingCheckIn ? 'success' : run ? 'gold' : 'violet'}>
                {readOnly
                  ? 'просмотр'
                  : isAwaitingCheckIn
                    ? 'готово'
                    : run
                      ? 'сессия'
                      : 'план'}
              </Pill>
              <ThemedText type="small" style={styles.muted}>
                День {mission.dayNumber ?? mission.sequence}
                {scheduledDate ? ` · ${scheduledDate}` : ''}
              </ThemedText>
            </View>
            <Pressable
              accessibilityLabel={run?.status === 'running' ? 'Свернуть сессию' : 'Закрыть'}
              accessibilityRole="button"
              onPress={requestClose}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
              <ThemedText style={styles.closeText}>×</ThemedText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.titleBlock}>
              <View style={styles.titleRow}>
                <ThemedText type="title" style={styles.flex}>
                  {mission.title}
                </ThemedText>
                <InfoPopover
                  title="О миссии"
                  accessibilityLabel="Показать пояснение к миссии"
                  sections={missionContextSections(mission)}
                />
              </View>
            </View>

            {persistenceStatus === 'error' ? (
              <View style={[styles.persistenceCard, styles.persistenceCardError]}>
                <View style={styles.rowBetween}>
                  <Pill tone="danger">ошибка сохранения</Pill>
                  <InfoPopover
                    title="Что сохранено?"
                    sections={[
                      {
                        body: 'Текущие данные остаются в памяти. Повтори локальную запись перед закрытием Actum.',
                        tone: 'warning',
                      },
                    ]}
                  />
                </View>
                <AppButton
                  label="Повторить сохранение"
                  variant="secondary"
                  onPress={async () => {
                    await onRetryPersistence();
                  }}
                />
              </View>
            ) : null}

            {!run ? (
              <>
                <ExecutionPlan blocks={visibleBlocks} />
                <View style={styles.footerActions}>
                  {readOnly ? (
                    <AppButton label="Закрыть просмотр" variant="secondary" onPress={onClose} />
                  ) : (
                    <AppButton label="Начать и включить журнал" icon="→" onPress={onBegin} />
                  )}
                </View>
              </>
            ) : null}

            {readOnly && run ? (
              <>
                <RunSummary mission={mission} run={run} />
                <View style={styles.footerActions}>
                  <AppButton label="Закрыть журнал" variant="secondary" onPress={onClose} />
                </View>
              </>
            ) : null}

            {!readOnly && run?.status === 'running' && activeBlock && activeResult && !activeBlockIsHidden ? (
              <>
                <View style={styles.progressCard}>
                  <View style={styles.rowBetween}>
                    <ThemedText type="eyebrow" style={styles.muted}>
                      {Math.max(1, visibleBlocks.indexOf(activeBlock) + 1)}/{visibleBlocks.length}
                    </ThemedText>
                    <ThemedText type="small" style={styles.muted}>
                      {completedVisibleBlocks}/{visibleBlocks.length}
                    </ThemedText>
                  </View>
                  <ProgressBar value={progress} color={Palette.cyan} height={10} />
                </View>

                {run.cursor.stage === 'ready' ? (
                  <ReadyBlock
                    block={activeBlock}
                    onStart={() => {
                      const checkpoint = startMissionRunWork(run, execution.blocks, new Date());
                      if (checkpoint) onSave(checkpoint);
                    }}
                  />
                ) : null}

                {run.cursor.stage === 'preparing' ? (
                  <PreparationCountdown
                    block={activeBlock}
                    remainingSeconds={remainingSeconds}
                    setIndex={run.cursor.setIndex}
                  />
                ) : null}

                {run.cursor.stage === 'work' ? (
                  <ActiveBlock
                    block={activeBlock}
                    result={activeResult}
                    run={run}
                    remainingSeconds={remainingSeconds}
                    elapsedSeconds={elapsedSeconds}
                    onSave={onSave}
                    onMutate={onMutate}
                  />
                ) : null}

                {run.cursor.stage === 'rest' ? (
                  <View style={[styles.activeCard, styles.restCard]}>
                    <ThemedText type="eyebrow" style={styles.cyan}>
                      отдых
                    </ThemedText>
                    <ThemedText style={styles.clock}>{formatClock(remainingSeconds)}</ThemedText>
                    <AppButton
                      label="Пропустить отдых"
                      variant="secondary"
                      onPress={() => {
                        const checkpoint = startMissionRunWork(run, execution.blocks, new Date());
                        if (checkpoint) onSave(checkpoint);
                      }}
                    />
                  </View>
                ) : null}

                {run.cursor.stage === 'review' ? (
                  <BlockReview
                    block={activeBlock}
                    result={activeResult}
                    run={run}
                    blocks={execution.blocks}
                    onSave={onSave}
                    onMutate={onMutate}
                    onFinish={onFinish}
                  />
                ) : null}

                <View style={styles.footerActions}>
                  <AppButton
                    label="Остановить и сохранить"
                    variant="secondary"
                    onPress={() =>
                      onFinish(checkpointMissionRunWork(run, activeBlock, new Date()), 'stopped')
                    }
                  />
                </View>
              </>
            ) : null}

            {!readOnly && isAwaitingCheckIn ? (
              <>
                <RunSummary mission={mission} run={run} />
                <View style={styles.footerActions}>
                  <AppButton label="Добавить итог и сохранить" icon="→" onPress={() => onCheckIn(run.id)} />
                </View>
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ReadyBlock({ block, onStart }: { block: MissionExecutionBlock; onStart(): void }) {
  return (
    <View style={styles.activeCard}>
      <View style={styles.titleRow}>
        <ThemedText type="subtitle" style={styles.flex}>
          {block.title}
        </ThemedText>
        <BlockInfoPopover block={block} />
      </View>
      {'instruction' in block ? (
        <ThemedText>{primaryInstruction(block.instruction)}</ThemedText>
      ) : null}
      <ThemedText type="smallBold" style={styles.cyan}>
        {blockPrescription(block)}
      </ThemedText>
      <AppButton label={startLabel(block)} icon="→" onPress={onStart} />
    </View>
  );
}

function PreparationCountdown({
  block,
  remainingSeconds,
  setIndex,
}: {
  block: MissionExecutionBlock;
  remainingSeconds: number;
  setIndex: number;
}) {
  const countdown = Math.min(
    MISSION_RUN_PREPARATION_SECONDS,
    Math.max(1, remainingSeconds),
  );
  return (
    <View style={[styles.activeCard, styles.preparationCard]}>
      <ThemedText type="eyebrow" style={styles.muted}>
        приготовься · подход {setIndex + 1}
      </ThemedText>
      <ThemedText type="subtitle">{block.title}</ThemedText>
      <ThemedText
        accessibilityLabel={`Старт через ${countdown}`}
        accessibilityLiveRegion="assertive"
        style={styles.countdownNumber}>
        {countdown}
      </ThemedText>
    </View>
  );
}

function ActiveBlock({
  block,
  result,
  run,
  remainingSeconds,
  elapsedSeconds,
  onSave,
  onMutate,
}: {
  block: MissionExecutionBlock;
  result: MissionRunBlockResult;
  run: MissionRun;
  remainingSeconds: number;
  elapsedSeconds: number;
  onSave(run: MissionRun): void;
  onMutate(runId: string, mutation: MissionRunMutation): void;
}) {
  if (block.kind === 'timer' && result.kind === 'timer') {
    return (
      <View style={styles.activeCard}>
        <ThemedText type="eyebrow" style={styles.gold}>
          подход {run.cursor.setIndex + 1} из {block.sets}
        </ThemedText>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle" style={styles.flex}>
            {block.title}
          </ThemedText>
          <BlockInfoPopover block={block} />
        </View>
        <ThemedText>{primaryInstruction(block.instruction)}</ThemedText>
        <ThemedText accessibilityLiveRegion="polite" style={styles.clock}>
          {formatClock(remainingSeconds)}
        </ThemedText>
        <AppButton
          label="Остановить и записать"
          variant="secondary"
          onPress={() => {
            const checkpoint = completeTimerMissionRunSet(run, block, false, new Date());
            if (checkpoint) onSave(checkpoint);
          }}
        />
      </View>
    );
  }

  if (block.kind === 'counter' && result.kind === 'counter') {
    const set = result.sets[run.cursor.setIndex];
    const plannedTimeElapsed =
      remainingSeconds === 0 && elapsedSeconds >= block.workSecondsPerSet;
    return (
      <View style={styles.activeCard}>
        <ThemedText type="eyebrow" style={styles.gold}>
          подход {run.cursor.setIndex + 1} из {block.sets}
        </ThemedText>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle" style={styles.flex}>
            {block.title}
          </ThemedText>
          <BlockInfoPopover block={block} />
        </View>
        <ThemedText>{primaryInstruction(block.instruction)}</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          Цель: {formatQuantity(block.targetPerSet)} {counterUnitLabel(block)} ·{' '}
          {run.stageEndsAt && remainingSeconds > 0
            ? `осталось ${formatClock(remainingSeconds)}`
            : plannedTimeElapsed
              ? `плановое время вышло · прошло ${formatClock(elapsedSeconds)}`
              : `прошло ${formatClock(elapsedSeconds)}`}
        </ThemedText>
        <Counter
          allowDecimal={block.unit === 'meters' || block.unit === 'custom'}
          target={block.targetPerSet}
          value={set.actualQuantity}
          onChange={(value) => {
            onMutate(run.id, {
              kind: 'set-counter',
              blockIndex: run.cursor.blockIndex,
              setIndex: run.cursor.setIndex,
              value,
            });
          }}
        />
        <AppButton
          label="Записать подход"
          onPress={() => {
            const checkpoint = completeCounterMissionRunSet(run, block, new Date());
            if (checkpoint) onSave(checkpoint);
          }}
        />
      </View>
    );
  }

  if (block.kind === 'checklist' && result.kind === 'checklist') {
    const allChecked = result.checkedIndexes.length === block.items.length;
    return (
      <View style={styles.activeCard}>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle" style={styles.flex}>{block.title}</ThemedText>
          <BlockInfoPopover block={block} />
        </View>
        <View style={styles.checklist}>
          {block.items.map((item, index) => {
            const checked = result.checkedIndexes.includes(index);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                key={`${index}-${item}`}
                onPress={() => {
                  onMutate(run.id, {
                    kind: 'toggle-checklist',
                    blockIndex: run.cursor.blockIndex,
                    itemIndex: index,
                  });
                }}
                style={({ pressed }) => [styles.checkRow, checked && styles.checkRowDone, pressed && styles.pressed]}>
                <View style={[styles.checkbox, checked && styles.checkboxDone]}>
                  <ThemedText type="smallBold">{checked ? '✓' : ''}</ThemedText>
                </View>
                <ThemedText style={styles.checkText}>{item}</ThemedText>
              </Pressable>
            );
          })}
        </View>
        <AppButton
          disabled={!allChecked}
          label="Чек-лист выполнен — записать"
          onPress={() => {
            const checkpoint = completeSimpleMissionRunBlock(run, result.blockIndex, new Date());
            if (checkpoint) onSave(checkpoint);
          }}
        />
      </View>
    );
  }

  if (block.kind === 'text_log' && result.kind === 'text_log') {
    const enough = Array.from(result.value.trim()).length >= block.minCharacters;
    const prompt = withoutExecutionSafetyCopy(block.prompt) ?? block.title;
    return (
      <View style={styles.activeCard}>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle" style={styles.flex}>{block.title}</ThemedText>
          <BlockInfoPopover block={block} />
        </View>
        <ThemedText>{prompt}</ThemedText>
        <TextInput
          accessibilityLabel={prompt}
          maxLength={block.maxCharacters}
          multiline
          onChangeText={(value) => {
            onMutate(run.id, {
              kind: 'set-text-log',
              blockIndex: run.cursor.blockIndex,
              value,
            });
          }}
          placeholder="Введите ответ…"
          placeholderTextColor={Palette.textDim}
          style={styles.textLog}
          value={result.value}
        />
        <ThemedText type="small" style={styles.muted}>
          {Array.from(result.value.trim()).length}/{block.minCharacters} минимум · максимум{' '}
          {block.maxCharacters}
        </ThemedText>
        <AppButton
          disabled={!enough}
          label="Сохранить ответ в Actum"
          onPress={() => {
            const checkpoint = completeSimpleMissionRunBlock(run, result.blockIndex, new Date());
            if (checkpoint) onSave(checkpoint);
          }}
        />
      </View>
    );
  }

  return null;
}

function BlockReview({
  block,
  result,
  run,
  blocks,
  onSave,
  onMutate,
  onFinish,
}: {
  block: MissionExecutionBlock;
  result: MissionRunBlockResult;
  run: MissionRun;
  blocks: MissionExecutionBlock[];
  onSave(run: MissionRun): void;
  onMutate(runId: string, mutation: MissionRunMutation): void;
  onFinish(run: MissionRun, reason: MissionRunFinishReason): void;
}) {
  const missedTargets =
    result.kind === 'timer' || result.kind === 'counter'
      ? result.sets.filter((set) => !set.targetMet).length
      : 0;
  const criterionAnswered = result.criterionMet !== undefined;
  const blockSuccessful = result.criterionMet === true && missedTargets === 0;
  return (
    <View style={styles.activeCard}>
      <Pill tone={blockSuccessful ? 'success' : 'warning'}>
        {blockSuccessful ? 'критерий выполнен' : criterionAnswered ? 'есть недочёты' : 'нужна проверка'}
      </Pill>
      <ThemedText type="subtitle">{block.title}</ThemedText>
      {missedTargets ? (
        <ThemedText type="small" style={styles.warningText}>
          Ниже цели: {missedTargets}
        </ThemedText>
      ) : null}
      <View style={styles.criterionCheck}>
        <ThemedText type="smallBold">Критерий выполнен?</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          {withoutExecutionSafetyCopy(block.successCriterion) ?? 'Действие выполнено.'}
        </ThemedText>
        <View style={styles.criterionOptions}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: result.criterionMet === true }}
            onPress={() =>
              onMutate(run.id, {
                kind: 'set-block-criterion',
                blockIndex: run.cursor.blockIndex,
                value: true,
              })
            }
            style={({ pressed }) => [
              styles.criterionOption,
              result.criterionMet === true && styles.criterionOptionSuccess,
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold">✓ Да</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: result.criterionMet === false }}
            onPress={() =>
              onMutate(run.id, {
                kind: 'set-block-criterion',
                blockIndex: run.cursor.blockIndex,
                value: false,
              })
            }
            style={({ pressed }) => [
              styles.criterionOption,
              result.criterionMet === false && styles.criterionOptionWarning,
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold">— Нет</ThemedText>
          </Pressable>
        </View>
      </View>
      <View style={styles.commentBlock}>
        <ThemedText type="smallBold">Комментарий или недочёт по блоку</ThemedText>
        <TextInput
          accessibilityLabel={`Комментарий к блоку ${block.title}`}
          maxLength={500}
          multiline
          onChangeText={(comment) => {
            onMutate(run.id, {
              kind: 'set-block-comment',
              blockIndex: run.cursor.blockIndex,
              value: comment,
            });
          }}
          placeholder="Что получилось, где сбился, что помешало…"
          placeholderTextColor={Palette.textDim}
          style={styles.commentInput}
          value={result.comment ?? ''}
        />
      </View>
      <AppButton
        disabled={!criterionAnswered}
        label={run.cursor.blockIndex + 1 < blocks.length ? 'Сохранить и перейти дальше' : 'Завершить сессию'}
        icon="→"
        onPress={() => {
          const transition = continueMissionRunAfterReview(run, blocks, new Date());
          if (transition.kind === 'finish') {
            onFinish(transition.run, transition.reason);
          } else {
            onSave(transition.run);
          }
        }}
      />
    </View>
  );
}

function ExecutionPlan({ blocks }: { blocks: MissionExecutionBlock[] }) {
  return (
    <View style={styles.plan}>
      {blocks.map((block, index) => (
        <View key={`${index}-${block.title}`} style={styles.planBlock}>
          <View style={styles.planIndex}>
            <ThemedText type="smallBold" style={styles.gold}>
              {index + 1}
            </ThemedText>
          </View>
          <View style={styles.planCopy}>
            <View style={styles.titleRow}>
              <ThemedText type="smallBold" style={styles.flex}>
                {block.title}
              </ThemedText>
              <BlockInfoPopover block={block} />
            </View>
            <ThemedText type="smallBold" style={styles.cyan}>{blockPrescription(block)}</ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

export function RunSummary({ mission, run }: { mission: Mission; run: MissionRun }) {
  const summary = missionRunSummary(run);
  const blocks = mission.execution?.kind === 'in_app' ? mission.execution.blocks : [];
  const visibleBlockIndexes = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => !isSafetyOnlyExecutionBlock(block))
    .map(({ index }) => index);
  const completedBlocks = visibleBlockIndexes.filter(
    (index) => run.blockResults[index]?.completed,
  ).length;
  const successful = isMissionRunSuccessful(run);
  const elapsed = Math.max(
    0,
    Math.round(((run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) - Date.parse(run.startedAt)) / 1000),
  );
  return (
    <View style={styles.summaryCard}>
      <View style={styles.rowBetween}>
        <Pill tone={successful ? 'success' : 'warning'}>
          {successful ? 'выполнено' : 'есть недочёты'}
        </Pill>
        <InfoPopover
          title="Детали журнала"
          accessibilityLabel="Показать подробности сохранённой сессии"
          sections={runDetailSections(mission, run)}
        />
      </View>
      <ThemedText type="subtitle">Журнал: {mission.title}</ThemedText>
      <ThemedText type="small" style={styles.muted}>
        {completedBlocks}/{visibleBlockIndexes.length} блоков
        {summary.totalSets
          ? ` · ${summary.targetMetSets}/${summary.totalSets} подходов по цели`
          : ''}{' '}
        · {formatDuration(elapsed)}
      </ThemedText>
    </View>
  );
}

function runDetailSections(mission: Mission, run: MissionRun): ContextInfoSection[] {
  return run.blockResults.flatMap((result) => {
    const block =
      mission.execution?.kind === 'in_app'
        ? mission.execution.blocks[result.blockIndex]
        : undefined;
    if (block && isSafetyOnlyExecutionBlock(block)) return [];
    const details = [
      blockResultLabel(result),
      `Критерий: ${result.criterionMet === true ? 'да' : result.criterionMet === false ? 'нет' : 'не отмечен'}`,
    ];

    if (block?.kind === 'checklist' && result.kind === 'checklist') {
      details.push(
        ...block.items.map(
          (item, index) => `${result.checkedIndexes.includes(index) ? '✓' : '○'} ${item}`,
        ),
      );
    }
    if (block?.kind === 'text_log' && result.kind === 'text_log' && result.value.trim()) {
      details.push(`Ответ: ${result.value.trim()}`);
    }
    if (result.comment?.trim()) details.push(`Комментарий: ${result.comment.trim()}`);

    return [
      {
        heading: `${blockResultSuccessful(result) ? '✓' : result.completed ? '≈' : '—'} ${result.title}`,
        body: details.filter(Boolean).join('\n'),
        ...(result.criterionMet === false ? { tone: 'warning' as const } : {}),
      },
    ];
  });
}

function Counter({
  value,
  target,
  allowDecimal,
  onChange,
}: {
  value: number;
  target: number;
  allowDecimal: boolean;
  onChange(value: number): void;
}) {
  const [draft, setDraft] = useState(() => formatQuantity(value));

  useEffect(() => {
    setDraft(formatQuantity(value));
  }, [value]);

  const normalizedValue = (input: string) => {
    const normalized = input.trim().replace(',', '.');
    if (!normalized || normalized.endsWith('.') || !/^\d+(?:\.\d+)?$/.test(normalized)) {
      return undefined;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const applyValue = (next: number) => {
    const bounded = Math.min(1_000_000, Math.max(0, allowDecimal ? next : Math.round(next)));
    setDraft(formatQuantity(bounded));
    onChange(bounded);
  };

  const commit = (input: string) => {
    const parsed = normalizedValue(input);
    if (parsed === undefined) return;
    applyValue(parsed);
  };

  const currentDraftValue = () => normalizedValue(draft) ?? value;

  return (
    <View style={styles.counterWrap}>
      <View style={styles.counter}>
        <Pressable accessibilityLabel="Уменьшить на один" onPress={() => applyValue(currentDraftValue() - 1)} style={styles.counterButton}>
          <ThemedText style={styles.counterGlyph}>−</ThemedText>
        </Pressable>
        <TextInput
          accessibilityLabel="Фактическое количество"
          keyboardType="decimal-pad"
          onBlur={() => {
            commit(draft);
            if (!draft.trim()) setDraft(formatQuantity(value));
          }}
          onChangeText={(next) => {
            setDraft(next);
            commit(next);
          }}
          selectTextOnFocus
          style={styles.counterInput}
          value={draft}
        />
        <Pressable accessibilityLabel="Увеличить на один" onPress={() => applyValue(currentDraftValue() + 1)} style={styles.counterButton}>
          <ThemedText style={styles.counterGlyph}>+</ThemedText>
        </Pressable>
      </View>
      <View style={styles.counterQuickActions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => applyValue(target)}
          style={({ pressed }) => [styles.counterQuickButton, pressed && styles.pressed]}>
          <ThemedText type="smallBold">Поставить цель: {formatQuantity(target)}</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => applyValue(currentDraftValue() + 5)}
          style={({ pressed }) => [styles.counterQuickButton, pressed && styles.pressed]}>
          <ThemedText type="smallBold">+5</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function blockPrescription(block: MissionExecutionBlock) {
  if (block.kind === 'timer') {
    return `${block.sets} × ${formatDuration(block.durationSecondsPerSet)} · отдых ${formatDuration(block.restSeconds)}`;
  }
  if (block.kind === 'counter') {
    return `${block.sets} × ${formatQuantity(block.targetPerSet)} ${counterUnitLabel(block)} · ${formatDuration(block.workSecondsPerSet)} · отдых ${formatDuration(block.restSeconds)}${block.tempo ? ` · ${block.tempo}` : ''}`;
  }
  if (block.kind === 'checklist') {
    return `${block.items.length} пунктов · ~${formatDuration(block.estimatedSeconds)}`;
  }
  return `${block.minCharacters}–${block.maxCharacters} знаков · ~${formatDuration(block.estimatedSeconds)}`;
}

function BlockInfoPopover({ block }: { block: MissionExecutionBlock }) {
  return (
    <InfoPopover
      title={block.title}
      accessibilityLabel={`Показать подробности блока ${block.title}`}
      sections={blockContextSections(block)}
    />
  );
}

function blockContextSections(block: MissionExecutionBlock): ContextInfoSection[] {
  const sections: ContextInfoSection[] = [];
  if ('instruction' in block) {
    const details = instructionDetails(block.instruction);
    if (details) sections.push({ heading: 'Подробнее', body: details });
  }
  const criterion = withoutExecutionSafetyCopy(block.successCriterion);
  if (criterion) sections.push({ heading: 'Критерий', body: criterion });
  sections.push(...executionBlockContextSections(block));
  return sections;
}

function primaryInstruction(instruction: string) {
  const normalized = withoutExecutionSafetyCopy(instruction)?.trim() ?? '';
  const match = normalized.match(/^.*?[.!?](?=\s|$)/u);
  return match?.[0].trim() || normalized;
}

function instructionDetails(instruction: string) {
  const normalized = withoutExecutionSafetyCopy(instruction)?.trim() ?? '';
  const primary = primaryInstruction(normalized);
  return normalized.slice(primary.length).trim();
}

function startLabel(block: MissionExecutionBlock) {
  if (block.kind === 'timer') return 'Начать таймер';
  if (block.kind === 'counter') return 'Начать подход';
  if (block.kind === 'checklist') return 'Открыть чек-лист';
  return 'Открыть поле ответа';
}

function counterUnitLabel(block: CounterExecutionBlock) {
  if (block.unit === 'custom') return block.unitLabel?.trim() || 'ед.';
  return {
    reps: 'повт.',
    pages: 'стр.',
    items: 'элем.',
    words: 'слов',
    meters: 'м',
    attempts: 'попыток',
  }[block.unit];
}

function blockResultLabel(result: MissionRunBlockResult) {
  if (result.kind === 'timer') {
    return result.sets
      .map((set) => `${set.setIndex + 1}: ${formatDuration(set.actualDurationSeconds)}/${formatDuration(set.targetDurationSeconds)}`)
      .join(' · ');
  }
  if (result.kind === 'counter') {
    return result.sets
      .map((set) => `${set.setIndex + 1}: ${formatQuantity(set.actualQuantity)}/${formatQuantity(set.targetQuantity)} ${result.unitLabel || result.unit} · время ${formatDuration(set.actualDurationSeconds)}/${formatDuration(set.targetDurationSeconds)}`)
      .join(' · ');
  }
  if (result.kind === 'checklist') return `${result.checkedIndexes.length} пунктов отмечено`;
  return `${Array.from(result.value.trim()).length} знаков сохранено`;
}

function blockResultSuccessful(result: MissionRunBlockResult) {
  if (!result.completed || result.criterionMet !== true) return false;
  return (
    (result.kind !== 'timer' && result.kind !== 'counter') ||
    result.sets.every((set) => set.targetMet)
  );
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe} сек`;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest ? `${minutes} мин ${rest} сек` : `${minutes} мин`;
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))).replace('.', ',');
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Palette.inkRaised },
  safe: { flex: 1 },
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
    gap: Spacing.three,
  },
  headerCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: Palette.textMuted, fontSize: 27, lineHeight: 29 },
  pressed: { opacity: 0.7 },
  content: { flexGrow: 1, padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  titleBlock: { gap: Spacing.two },
  persistenceCard: {
    gap: Spacing.two,
    padding: Spacing.twoHalf,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
  },
  persistenceCardError: {
    borderColor: 'rgba(215, 0, 21, 0.28)',
    backgroundColor: 'rgba(215, 0, 21, 0.06)',
  },
  muted: { color: Palette.textMuted },
  cyan: { color: Palette.cyan },
  gold: { color: Palette.goldBright },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  plan: { gap: Spacing.two },
  planBlock: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.twoHalf,
    borderRadius: Radius.medium,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.line,
  },
  planIndex: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
  },
  planCopy: { flex: 1, gap: 4 },
  progressCard: { gap: Spacing.two },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  activeCard: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.large,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.line,
  },
  preparationCard: {
    alignItems: 'center',
    paddingVertical: Spacing.six,
  },
  countdownNumber: {
    color: Palette.text,
    fontSize: 120,
    lineHeight: 128,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    textAlign: 'center',
  },
  restCard: {
    borderColor: 'rgba(0, 122, 255, 0.24)',
    backgroundColor: 'rgba(0, 122, 255, 0.06)',
  },
  clock: {
    color: Palette.text,
    fontSize: 64,
    lineHeight: 72,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    fontWeight: '700',
  },
  counterWrap: { gap: Spacing.two },
  counter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  counterButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.surfaceSoft,
    borderWidth: 1,
    borderColor: Palette.line,
  },
  counterGlyph: { fontSize: 34, lineHeight: 38 },
  counterInput: {
    width: 120,
    minHeight: 64,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.ink,
    color: Palette.text,
    textAlign: 'center',
    fontSize: 42,
    lineHeight: 50,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  counterQuickActions: { flexDirection: 'row', gap: Spacing.two },
  counterQuickButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.small,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surfaceSoft,
    paddingHorizontal: Spacing.two,
  },
  checklist: { gap: Spacing.two },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.twoHalf,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surfaceSoft,
  },
  checkRowDone: {
    borderColor: Palette.success,
    backgroundColor: 'rgba(36, 138, 61, 0.08)',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Palette.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: { borderColor: Palette.success, backgroundColor: Palette.success },
  checkText: { flex: 1 },
  textLog: {
    minHeight: 150,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.ink,
    color: Palette.text,
    padding: Spacing.three,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  commentBlock: { gap: Spacing.two },
  criterionCheck: {
    gap: Spacing.two,
    padding: Spacing.twoHalf,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.ink,
  },
  criterionOptions: { flexDirection: 'row', gap: Spacing.two },
  criterionOption: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.small,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
  },
  criterionOptionSuccess: {
    borderColor: Palette.success,
    backgroundColor: 'rgba(36, 138, 61, 0.08)',
  },
  criterionOptionWarning: {
    borderColor: Palette.warning,
    backgroundColor: 'rgba(199, 120, 0, 0.08)',
  },
  commentInput: {
    minHeight: 90,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.ink,
    color: Palette.text,
    padding: Spacing.three,
    textAlignVertical: 'top',
  },
  summaryCard: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
  },
  warningText: { color: Palette.warning },
  footerActions: { gap: Spacing.two, paddingTop: Spacing.two },
});
