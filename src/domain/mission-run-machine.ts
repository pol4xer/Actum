import type {
  CounterExecutionBlock,
  CounterRunBlockResult,
  MissionExecutionBlock,
  MissionRun,
  MissionRunFinishReason,
  TimerExecutionBlock,
  TimerRunBlockResult,
} from './types';

export type MissionRunTransition =
  | { kind: 'save'; run: MissionRun }
  | { kind: 'finish'; run: MissionRun; reason: MissionRunFinishReason };

type ClockValue = Date | string | number;

export const MISSION_RUN_PREPARATION_SECONDS = 3;

function clockMilliseconds(value: ClockValue): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.parse(value);
}

function clockTimestamp(value: ClockValue): string {
  const milliseconds = clockMilliseconds(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Mission-run transition requires a valid clock value.');
  return new Date(milliseconds).toISOString();
}

/** Deep-copies the mutable parts of a durable run before applying a transition. */
export function cloneMissionRun(run: MissionRun): MissionRun {
  return {
    ...run,
    cursor: { ...run.cursor },
    blockResults: run.blockResults.map((result) => {
      if (result.kind === 'timer') {
        return { ...result, sets: result.sets.map((set) => ({ ...set })) };
      }
      if (result.kind === 'counter') {
        return { ...result, sets: result.sets.map((set) => ({ ...set })) };
      }
      if (result.kind === 'checklist') {
        return { ...result, checkedIndexes: [...result.checkedIndexes] };
      }
      return { ...result };
    }),
  };
}

/**
 * Starts the current block. Timer sets first enter a durable preparation stage;
 * calling this again at that stage's absolute deadline starts measured work.
 */
export function startMissionRunWork(
  run: MissionRun,
  blocks: MissionExecutionBlock[] | undefined,
  at: ClockValue,
): MissionRun | undefined {
  const block = blocks?.[run.cursor.blockIndex];
  const result = run.blockResults[run.cursor.blockIndex];
  if (!block || !result) return undefined;
  if (!['ready', 'rest', 'preparing'].includes(run.cursor.stage)) return undefined;

  const checkpoint = cloneMissionRun(run);
  const atMilliseconds = clockMilliseconds(at);
  const atTimestamp = clockTimestamp(at);
  const target = checkpoint.blockResults[run.cursor.blockIndex];

  if (
    block.kind === 'timer' &&
    target.kind === 'timer' &&
    run.cursor.stage !== 'preparing'
  ) {
    checkpoint.cursor.stage = 'preparing';
    checkpoint.stageStartedAt = atTimestamp;
    checkpoint.stageEndsAt = new Date(
      atMilliseconds + MISSION_RUN_PREPARATION_SECONDS * 1_000,
    ).toISOString();
    return checkpoint;
  }

  if (run.cursor.stage === 'preparing' && block.kind !== 'timer') return undefined;

  target.startedAt ||= atTimestamp;
  checkpoint.cursor.stage = 'work';
  checkpoint.stageStartedAt = atTimestamp;
  checkpoint.stageEndsAt = undefined;

  if (block.kind === 'timer' && target.kind === 'timer') {
    const set = target.sets[run.cursor.setIndex];
    if (!set) return undefined;
    set.startedAt = atTimestamp;
    checkpoint.stageEndsAt = new Date(
      atMilliseconds + block.durationSecondsPerSet * 1_000,
    ).toISOString();
  } else if (block.kind === 'counter' && target.kind === 'counter') {
    const set = target.sets[run.cursor.setIndex];
    if (!set) return undefined;
    set.startedAt ||= atTimestamp;
    checkpoint.stageEndsAt = new Date(
      atMilliseconds + block.workSecondsPerSet * 1_000,
    ).toISOString();
  }

  return checkpoint;
}

/** Captures elapsed work when a running session is stopped before a set completes. */
export function checkpointMissionRunWork(
  run: MissionRun,
  block: MissionExecutionBlock | undefined,
  at: ClockValue,
): MissionRun {
  const checkpoint = cloneMissionRun(run);
  if (run.cursor.stage !== 'work' || !block) return checkpoint;

  const atMilliseconds = clockMilliseconds(at);
  const atTimestamp = clockTimestamp(at);
  const target = checkpoint.blockResults[run.cursor.blockIndex];
  if (block.kind === 'timer' && target?.kind === 'timer') {
    const set = target.sets[run.cursor.setIndex];
    if (set) {
      const startedAt = set.startedAt ? Date.parse(set.startedAt) : atMilliseconds;
      set.actualDurationSeconds = Math.max(
        set.actualDurationSeconds,
        Math.max(0, Math.round((atMilliseconds - startedAt) / 1_000)),
      );
      set.targetMet = set.actualDurationSeconds >= block.durationSecondsPerSet;
      set.completedAt = atTimestamp;
    }
  }
  if (block.kind === 'counter' && target?.kind === 'counter') {
    const set = target.sets[run.cursor.setIndex];
    if (set) {
      const startedAt = set.startedAt ? Date.parse(set.startedAt) : atMilliseconds;
      set.actualDurationSeconds = Math.max(
        set.actualDurationSeconds,
        Math.max(0, Math.round((atMilliseconds - startedAt) / 1_000)),
      );
      set.targetMet = set.actualQuantity >= block.targetPerSet;
      set.completedAt = atTimestamp;
    }
  }
  checkpoint.stageStartedAt = undefined;
  checkpoint.stageEndsAt = undefined;
  return checkpoint;
}

export function completeTimerMissionRunSet(
  run: MissionRun,
  block: TimerExecutionBlock,
  reachedZero: boolean,
  at: ClockValue,
): MissionRun | undefined {
  const checkpoint = cloneMissionRun(run);
  const target = checkpoint.blockResults[run.cursor.blockIndex];
  if (target?.kind !== 'timer') return undefined;

  const atMilliseconds = clockMilliseconds(at);
  const atTimestamp = clockTimestamp(at);
  const set = target.sets[run.cursor.setIndex];
  if (!set) return undefined;
  const startedAt = set.startedAt ? Date.parse(set.startedAt) : atMilliseconds;
  set.actualDurationSeconds = reachedZero
    ? Math.max(set.actualDurationSeconds, block.durationSecondsPerSet)
    : Math.max(
        set.actualDurationSeconds,
        Math.max(0, Math.round((atMilliseconds - startedAt) / 1_000)),
      );
  set.targetMet = set.actualDurationSeconds >= block.durationSecondsPerSet;
  set.completedAt = atTimestamp;
  return advanceAfterSet(checkpoint, block, target, atMilliseconds);
}

/**
 * Advances an automatic stage from its persisted deadline rather than callback time.
 * Timer work enters open-ended overtime at its target instead of fabricating a completed set.
 * This keeps preparation, work, and rest deterministic after the app resumes.
 */
export function advanceMissionRunTimedStage(
  run: MissionRun,
  blocks: MissionExecutionBlock[] | undefined,
): MissionRun | undefined {
  if (!run.stageEndsAt) return undefined;
  const deadlineMilliseconds = Date.parse(run.stageEndsAt);
  if (!Number.isFinite(deadlineMilliseconds)) return undefined;

  if (run.cursor.stage === 'preparing' || run.cursor.stage === 'rest') {
    return startMissionRunWork(run, blocks, deadlineMilliseconds);
  }

  const block = blocks?.[run.cursor.blockIndex];
  const result = run.blockResults[run.cursor.blockIndex];
  if (
    run.cursor.stage === 'work' &&
    block?.kind === 'timer' &&
    result?.kind === 'timer'
  ) {
    const checkpoint = cloneMissionRun(run);
    const target = checkpoint.blockResults[run.cursor.blockIndex];
    if (target?.kind !== 'timer') return undefined;
    const set = target.sets[run.cursor.setIndex];
    if (!set) return undefined;
    set.actualDurationSeconds = Math.max(
      set.actualDurationSeconds,
      block.durationSecondsPerSet,
    );
    set.targetMet = true;
    checkpoint.stageEndsAt = undefined;
    return checkpoint;
  }

  return undefined;
}

export function completeCounterMissionRunSet(
  run: MissionRun,
  block: CounterExecutionBlock,
  at: ClockValue,
): MissionRun | undefined {
  const checkpoint = cloneMissionRun(run);
  const target = checkpoint.blockResults[run.cursor.blockIndex];
  if (target?.kind !== 'counter') return undefined;

  const atMilliseconds = clockMilliseconds(at);
  const atTimestamp = clockTimestamp(at);
  const set = target.sets[run.cursor.setIndex];
  if (!set) return undefined;
  const startedAt = set.startedAt ? Date.parse(set.startedAt) : atMilliseconds;
  set.actualDurationSeconds = Math.max(
    0,
    Math.round((atMilliseconds - startedAt) / 1_000),
  );
  set.targetMet = set.actualQuantity >= block.targetPerSet;
  set.completedAt = atTimestamp;
  return advanceAfterSet(checkpoint, block, target, atMilliseconds);
}

function advanceAfterSet(
  checkpoint: MissionRun,
  block: TimerExecutionBlock | CounterExecutionBlock,
  result: TimerRunBlockResult | CounterRunBlockResult,
  atMilliseconds: number,
): MissionRun {
  const nextSetIndex = checkpoint.cursor.setIndex + 1;
  checkpoint.stageStartedAt = undefined;
  checkpoint.stageEndsAt = undefined;
  if (nextSetIndex >= block.sets) {
    result.completed = true;
    result.completedAt = new Date(atMilliseconds).toISOString();
    checkpoint.cursor.stage = 'review';
    return checkpoint;
  }

  checkpoint.cursor.setIndex = nextSetIndex;
  if (block.restSeconds > 0) {
    checkpoint.cursor.stage = 'rest';
    checkpoint.stageStartedAt = new Date(atMilliseconds).toISOString();
    checkpoint.stageEndsAt = new Date(
      atMilliseconds + block.restSeconds * 1_000,
    ).toISOString();
    return checkpoint;
  }

  checkpoint.cursor.stage = 'ready';
  return checkpoint;
}

export function completeSimpleMissionRunBlock(
  run: MissionRun,
  blockIndex: number,
  at: ClockValue,
): MissionRun | undefined {
  const checkpoint = cloneMissionRun(run);
  const target = checkpoint.blockResults[blockIndex];
  if (!target) return undefined;
  target.completed = true;
  target.completedAt = clockTimestamp(at);
  checkpoint.cursor.stage = 'review';
  checkpoint.stageEndsAt = undefined;
  return checkpoint;
}

/** Completes a non-actionable persisted block and advances without showing a review step. */
export function skipMissionRunBlock(
  run: MissionRun,
  blocks: MissionExecutionBlock[],
  at: ClockValue,
): MissionRunTransition | undefined {
  const checkpoint = cloneMissionRun(run);
  const target = checkpoint.blockResults[run.cursor.blockIndex];
  if (!target || !blocks[run.cursor.blockIndex]) return undefined;

  const atTimestamp = clockTimestamp(at);
  target.startedAt ||= atTimestamp;
  target.completed = true;
  target.completedAt = atTimestamp;
  target.criterionMet = true;
  checkpoint.cursor.stage = 'review';
  checkpoint.stageStartedAt = undefined;
  checkpoint.stageEndsAt = undefined;
  return continueMissionRunAfterReview(checkpoint, blocks, at);
}

export function continueMissionRunAfterReview(
  run: MissionRun,
  blocks: MissionExecutionBlock[],
  at: ClockValue,
): MissionRunTransition {
  // Validate the clock at the command boundary even though the persisted transition
  // timestamp is applied by the reducer. This keeps tests and callers deterministic.
  clockTimestamp(at);
  const checkpoint = cloneMissionRun(run);
  const nextBlockIndex = run.cursor.blockIndex + 1;
  if (nextBlockIndex >= blocks.length) {
    checkpoint.cursor.stage = 'complete';
    checkpoint.stageStartedAt = undefined;
    checkpoint.stageEndsAt = undefined;
    return { kind: 'finish', run: checkpoint, reason: 'completed' };
  }

  checkpoint.cursor = { blockIndex: nextBlockIndex, setIndex: 0, stage: 'ready' };
  checkpoint.stageStartedAt = undefined;
  checkpoint.stageEndsAt = undefined;
  return { kind: 'save', run: checkpoint };
}
