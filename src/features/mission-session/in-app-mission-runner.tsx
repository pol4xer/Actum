import { useEffect, useState } from 'react';
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
import { AppButton, Pill, ProgressBar } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import {
  isMissionRunSuccessful,
  missionRunSummary,
} from '@/domain/mission-run';
import {
  checkpointMissionRunWork,
  completeCounterMissionRunSet,
  completeSimpleMissionRunBlock,
  completeTimerMissionRunSet,
  continueMissionRunAfterReview,
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
  const execution = mission.execution?.kind === 'in_app' ? mission.execution : undefined;
  const activeBlock = execution?.blocks[run?.cursor.blockIndex ?? 0];
  const activeResult = run?.blockResults[run.cursor.blockIndex];
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
      !run.stageEndsAt ||
      (run.cursor.stage !== 'work' && run.cursor.stage !== 'rest')
    ) {
      return;
    }

    const timeout = setTimeout(() => {
      if (run.cursor.stage === 'rest') {
        const checkpoint = startMissionRunWork(run, execution?.blocks, new Date());
        if (checkpoint) onSave(checkpoint);
        return;
      }
      if (activeBlock?.kind === 'timer' && activeResult?.kind === 'timer') {
        const checkpoint = completeTimerMissionRunSet(run, activeBlock, true, new Date());
        if (checkpoint) onSave(checkpoint);
        return;
      }
    }, Math.max(0, Date.parse(run.stageEndsAt) - Date.now()));
    return () => clearTimeout(timeout);
  }, [activeBlock, activeResult, execution?.blocks, onSave, run, visible]);

  if (!execution) return null;

  const summary = run
    ? missionRunSummary(run)
    : { completedBlocks: 0, totalBlocks: 0, targetMetSets: 0, totalSets: 0 };
  const progress = execution.blocks.length
    ? summary.completedBlocks / execution.blocks.length
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
                    ? 'сессия записана'
                    : run
                      ? 'сессия идёт'
                      : 'всё внутри Actum'}
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
              <ThemedText type="title">{mission.title}</ThemedText>
              <ThemedText style={styles.muted}>{mission.description}</ThemedText>
            </View>

            <View
              style={[
                styles.persistenceCard,
                persistenceStatus === 'error' && styles.persistenceCardError,
              ]}>
              <Pill
                tone={
                  persistenceStatus === 'saved'
                    ? 'success'
                    : persistenceStatus === 'error'
                      ? 'danger'
                      : 'gold'
                }>
                {persistenceStatus === 'saved'
                  ? 'журнал сохранён'
                  : persistenceStatus === 'error'
                    ? 'ошибка сохранения'
                    : 'сохраняю журнал'}
              </Pill>
              <ThemedText type="small" style={styles.muted}>
                {persistenceStatus === 'error'
                  ? 'Текущие данные остаются в памяти. Повтори локальную запись перед закрытием Actum.'
                  : 'Подходы, таймеры, ответы и комментарии записываются в локальный журнал Actum.'}
              </ThemedText>
              {persistenceStatus === 'error' ? (
                <AppButton
                  label="Повторить сохранение"
                  variant="secondary"
                  onPress={async () => {
                    await onRetryPersistence();
                  }}
                />
              ) : null}
            </View>

            {!run ? (
              <>
                <View style={styles.closedLoopCard}>
                  <ThemedText type="eyebrow" style={styles.cyan}>
                    закрытый контур
                  </ThemedText>
                  <ThemedText type="smallBold">
                    Таймеры, фактические результаты, ответы и комментарии сохраняются в Actum.
                  </ThemedText>
                  <ThemedText type="small" style={styles.muted}>
                    Внешний секундомер, блокнот, файл или другой сервис не нужны.
                  </ThemedText>
                </View>
                <ExecutionPlan blocks={execution.blocks} />
                {mission.warning ? <Warning text={mission.warning} /> : null}
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

            {!readOnly && run?.status === 'running' && activeBlock && activeResult ? (
              <>
                <View style={styles.progressCard}>
                  <View style={styles.rowBetween}>
                    <ThemedText type="eyebrow" style={styles.muted}>
                      блок {run.cursor.blockIndex + 1} из {execution.blocks.length}
                    </ThemedText>
                    <ThemedText type="small" style={styles.muted}>
                      {summary.completedBlocks}/{execution.blocks.length} записано
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
                      встроенный отдых
                    </ThemedText>
                    <ThemedText style={styles.clock}>{formatClock(remainingSeconds)}</ThemedText>
                    <ThemedText style={styles.center}>Следующий шаг начнётся автоматически.</ThemedText>
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

                {mission.warning ? <Warning text={mission.warning} /> : null}
                <View style={styles.footerActions}>
                  <AppButton
                    label="Остановить сессию и сохранить"
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
      <ThemedText type="eyebrow" style={styles.gold}>
        следующий встроенный блок
      </ThemedText>
      <ThemedText type="subtitle">{block.title}</ThemedText>
      {'instruction' in block ? <ThemedText>{block.instruction}</ThemedText> : null}
      <ThemedText type="small" style={styles.muted}>
        {blockPrescription(block)}
      </ThemedText>
      <BlockMetadata block={block} />
      <AppButton label={startLabel(block)} icon="→" onPress={onStart} />
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
        <ThemedText type="subtitle">{block.title}</ThemedText>
        <ThemedText>{block.instruction}</ThemedText>
        <BlockMetadata block={block} />
        <ThemedText accessibilityLiveRegion="polite" style={styles.clock}>
          {formatClock(remainingSeconds)}
        </ThemedText>
        <ThemedText style={styles.center}>до автоматической записи результата</ThemedText>
        <AppButton
          label="Не выдержал — записать фактическое время"
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
        <ThemedText type="subtitle">{block.title}</ThemedText>
        <ThemedText>{block.instruction}</ThemedText>
        <BlockMetadata block={block} />
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
        <ThemedText type="subtitle">{block.title}</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          {blockPrescription(block)}
        </ThemedText>
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
    return (
      <View style={styles.activeCard}>
        <ThemedText type="subtitle">{block.title}</ThemedText>
        <ThemedText>{block.prompt}</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          {blockPrescription(block)}
        </ThemedText>
        <TextInput
          accessibilityLabel={block.prompt}
          maxLength={block.maxCharacters}
          multiline
          onChangeText={(value) => {
            onMutate(run.id, {
              kind: 'set-text-log',
              blockIndex: run.cursor.blockIndex,
              value,
            });
          }}
          placeholder="Ответ сохраняется только в журнале Actum…"
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
      <ThemedText type="small" style={styles.muted}>
        {missedTargets
          ? `${missedTargets} подход(а) ниже цели. Это сохранится и ограничит итоговый check-in.`
          : block.successCriterion}
      </ThemedText>
      <View style={styles.criterionCheck}>
        <ThemedText type="smallBold">Критерий выполнен?</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          {block.successCriterion}
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
      <ThemedText type="eyebrow" style={styles.muted}>
        что приложение проведёт и запишет
      </ThemedText>
      {blocks.map((block, index) => (
        <View key={`${index}-${block.title}`} style={styles.planBlock}>
          <View style={styles.planIndex}>
            <ThemedText type="smallBold" style={styles.gold}>
              {index + 1}
            </ThemedText>
          </View>
          <View style={styles.planCopy}>
            <ThemedText type="smallBold">{block.title}</ThemedText>
            <ThemedText type="small" style={styles.cyan}>
              {blockKindLabel(block)} · {blockPrescription(block)}
            </ThemedText>
            {'instruction' in block ? (
              <ThemedText type="small" style={styles.muted}>
                {block.instruction}
              </ThemedText>
            ) : null}
            <BlockMetadata block={block} />
            {block.kind === 'checklist' ? (
              <View style={styles.planDetails}>
                {block.items.map((item, itemIndex) => (
                  <ThemedText key={`${itemIndex}-${item}`} type="small" style={styles.muted}>
                    {itemIndex + 1}. {item}
                  </ThemedText>
                ))}
              </View>
            ) : null}
            {block.kind === 'text_log' ? (
              <ThemedText type="small" style={styles.muted}>
                {block.prompt}
              </ThemedText>
            ) : null}
            <ThemedText type="small" style={styles.planCriterion}>
              Критерий: {block.successCriterion}
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

export function RunSummary({ mission, run }: { mission: Mission; run: MissionRun }) {
  const summary = missionRunSummary(run);
  const successful = isMissionRunSuccessful(run);
  const elapsed = Math.max(
    0,
    Math.round(((run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) - Date.parse(run.startedAt)) / 1000),
  );
  return (
    <View style={styles.summaryCard}>
      <Pill tone={successful ? 'success' : 'warning'}>
        {successful ? 'все критерии выполнены' : 'сессия сохранена с недочётами'}
      </Pill>
      <ThemedText type="subtitle">Журнал: {mission.title}</ThemedText>
      <ThemedText type="small" style={styles.muted}>
        {summary.completedBlocks}/{summary.totalBlocks} блоков
        {summary.totalSets
          ? ` · ${summary.targetMetSets}/${summary.totalSets} подходов по цели`
          : ''}{' '}
        · {formatDuration(elapsed)}
      </ThemedText>
      <View style={styles.resultList}>
        {run.blockResults.map((result) => {
          const block =
            mission.execution?.kind === 'in_app'
              ? mission.execution.blocks[result.blockIndex]
              : undefined;
          return (
            <View key={`${result.blockIndex}-${result.title}`} style={styles.resultItem}>
              <ThemedText type="smallBold">
                {blockResultSuccessful(result) ? '✓' : result.completed ? '≈' : '—'} {result.title}
              </ThemedText>
              <ThemedText type="small" style={styles.muted}>
                {blockResultLabel(result)}
              </ThemedText>
              {block && 'instruction' in block ? (
                <ThemedText type="small" style={styles.muted}>
                  Инструкция: {block.instruction}
                </ThemedText>
              ) : null}
              {block ? <BlockMetadata block={block} /> : null}
              <ThemedText
                type="small"
                style={result.criterionMet === true ? styles.successText : styles.warningText}>
                Критерий: {result.criterionMet === true ? 'да' : result.criterionMet === false ? 'нет' : 'не отмечен'}
              </ThemedText>
              {block?.kind === 'checklist' && result.kind === 'checklist' ? (
                <View style={styles.savedDetails}>
                  {block.items.map((item, index) => (
                    <ThemedText key={`${index}-${item}`} type="small">
                      {result.checkedIndexes.includes(index) ? '✓' : '○'} {item}
                    </ThemedText>
                  ))}
                </View>
              ) : null}
              {block?.kind === 'text_log' && result.kind === 'text_log' && result.value.trim() ? (
                <ThemedText type="small" style={styles.savedText}>
                  «{result.value.trim()}»
                </ThemedText>
              ) : null}
              {result.comment ? (
                <ThemedText type="small">Комментарий: {result.comment}</ThemedText>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
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

function Warning({ text }: { text: string }) {
  return (
    <View style={styles.warningCard}>
      <ThemedText type="eyebrow" style={styles.warningText}>
        важно знать
      </ThemedText>
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

function blockPrescription(block: MissionExecutionBlock) {
  if (block.kind === 'timer') {
    return `${block.sets} × ${formatDuration(block.durationSecondsPerSet)} · отдых ${formatDuration(block.restSeconds)}`;
  }
  if (block.kind === 'counter') {
    return `${block.sets} × ${formatQuantity(block.targetPerSet)} ${counterUnitLabel(block)} · время подхода ${formatDuration(block.workSecondsPerSet)} · отдых ${formatDuration(block.restSeconds)}`;
  }
  if (block.kind === 'checklist') {
    return `${block.items.length} пунктов внутри приложения · ориентир ${formatDuration(block.estimatedSeconds)}`;
  }
  return `ответ ${block.minCharacters}–${block.maxCharacters} знаков внутри приложения · ориентир ${formatDuration(block.estimatedSeconds)}`;
}

function BlockMetadata({ block }: { block: MissionExecutionBlock }) {
  const lines: string[] = [];
  if (block.kind === 'counter' && block.tempo) lines.push(`Темп: ${block.tempo}`);
  if ((block.kind === 'timer' || block.kind === 'counter') && block.loadBasis) {
    const basis = block.loadBasis;
    const targetUnit = block.kind === 'timer' ? 'сек' : counterUnitLabel(block);
    lines.push(
      `Расчёт нагрузки: ${formatQuantity(basis.percentage)}% × ${formatQuantity(basis.baseValue)} ${displayUnit(basis.baseUnit)} = ${formatQuantity(basis.result)} ${targetUnit}`,
    );
  }
  if (!lines.length) return null;
  return (
    <View style={styles.planDetails}>
      {lines.map((line) => (
        <ThemedText key={line} type="small" style={styles.cyan}>
          {line}
        </ThemedText>
      ))}
    </View>
  );
}

function displayUnit(unit: string) {
  const labels: Record<string, string> = {
    seconds: 'сек',
    minutes: 'мин',
    reps: 'повт.',
    pages: 'стр.',
    items: 'элем.',
    words: 'слов',
    meters: 'м',
    attempts: 'попыток',
  };
  return labels[unit] ?? unit;
}

function blockKindLabel(block: MissionExecutionBlock) {
  if (block.kind === 'timer') return 'таймер Actum';
  if (block.kind === 'counter') return 'счётчик Actum';
  if (block.kind === 'checklist') return 'чек-лист Actum';
  return 'поле журнала Actum';
}

function startLabel(block: MissionExecutionBlock) {
  if (block.kind === 'timer') return 'Запустить встроенный таймер';
  if (block.kind === 'counter') return 'Открыть встроенный счётчик';
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
    borderColor: '#2F624B',
    backgroundColor: '#15271F',
  },
  persistenceCardError: { borderColor: '#6B3737', backgroundColor: '#2B1818' },
  muted: { color: Palette.textMuted },
  cyan: { color: Palette.cyan },
  gold: { color: Palette.goldBright },
  center: { textAlign: 'center' },
  closedLoopCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: '#2D5961',
    backgroundColor: '#16282C',
  },
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
    backgroundColor: '#2A2418',
  },
  planCopy: { flex: 1, gap: 4 },
  planDetails: { gap: 3, paddingTop: Spacing.one },
  planCriterion: { color: Palette.text, paddingTop: Spacing.one },
  progressCard: { gap: Spacing.two },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  activeCard: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.large,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: '#4A432E',
  },
  restCard: { borderColor: '#2D5961', backgroundColor: '#16272D' },
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
  checkRowDone: { borderColor: Palette.success, backgroundColor: '#163025' },
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
  criterionOptionSuccess: { borderColor: Palette.success, backgroundColor: '#163025' },
  criterionOptionWarning: { borderColor: Palette.warning, backgroundColor: '#2A2117' },
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
    borderColor: '#2F624B',
    backgroundColor: '#15271F',
  },
  resultList: { gap: Spacing.two },
  resultItem: {
    gap: 4,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#FFFFFF20',
  },
  savedDetails: { gap: 3, paddingTop: Spacing.one },
  savedText: {
    color: Palette.text,
    fontStyle: 'italic',
    paddingTop: Spacing.one,
  },
  warningCard: {
    gap: Spacing.one,
    borderRadius: Radius.medium,
    padding: Spacing.twoHalf,
    borderWidth: 1,
    borderColor: '#614A2C',
    backgroundColor: '#2A2117',
  },
  warningText: { color: Palette.warning },
  successText: { color: Palette.success },
  footerActions: { gap: Spacing.two, paddingTop: Spacing.two },
});
