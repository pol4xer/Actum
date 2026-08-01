import type {
  CounterRunBlockResult,
  Mission,
  MissionRun,
  MissionRunBlockResult,
  MissionRunCursorStage,
  MissionRunSetResult,
  TimerRunBlockResult,
} from './types';

export type MissionRunSummary = {
  completedBlocks: number;
  totalBlocks: number;
  targetMetSets: number;
  totalSets: number;
};

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function createRunId(missionId: string, startedAt: string): string {
  const milliseconds = Date.parse(startedAt);
  const stamp = Number.isFinite(milliseconds)
    ? milliseconds.toString(36)
    : startedAt.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return `run-${missionId}-${stamp}`;
}

function createBlockResults(mission: Mission): MissionRunBlockResult[] {
  if (mission.execution?.kind !== 'in_app') return [];

  return mission.execution.blocks.map((block, blockIndex) => {
    const base = {
      blockIndex,
      title: block.title,
      completed: false,
    };

    if (block.kind === 'timer') {
      return {
        ...base,
        kind: 'timer',
        sets: Array.from({ length: block.sets }, (_, setIndex) => ({
          setIndex,
          targetDurationSeconds: block.durationSecondsPerSet,
          actualDurationSeconds: 0,
          targetMet: false,
        })),
      } satisfies TimerRunBlockResult;
    }

    if (block.kind === 'counter') {
      return {
        ...base,
        kind: 'counter',
        unit: block.unit,
        unitLabel: block.unitLabel,
        sets: Array.from({ length: block.sets }, (_, setIndex) => ({
          setIndex,
          targetQuantity: block.targetPerSet,
          actualQuantity: 0,
          targetDurationSeconds: block.workSecondsPerSet,
          actualDurationSeconds: 0,
          targetMet: false,
        })),
      } satisfies CounterRunBlockResult;
    }

    if (block.kind === 'checklist') {
      return { ...base, kind: 'checklist', checkedIndexes: [] };
    }

    return { ...base, kind: 'text_log', value: '' };
  });
}

/** Creates a durable run snapshot. Nothing in this helper schedules ticking persistence. */
export function createMissionRun(
  mission: Mission,
  now: Date | string = new Date(),
): MissionRun {
  const startedAt = timestamp(now);
  return {
    id: createRunId(mission.id, startedAt),
    missionId: mission.id,
    status: 'running',
    cursor: { blockIndex: 0, setIndex: 0, stage: 'ready' },
    startedAt,
    updatedAt: startedAt,
    stageStartedAt: startedAt,
    blockResults: createBlockResults(mission),
  };
}

export function isMissionRunComplete(run: MissionRun): boolean {
  return (
    (run.status === 'awaiting_checkin' || run.status === 'reported') &&
    Boolean(run.finishedAt) &&
    run.cursor.stage === 'complete' &&
    run.blockResults.every((block) => block.completed)
  );
}

export function isMissionRunSuccessful(run: MissionRun): boolean {
  return (
    isMissionRunComplete(run) &&
    run.blockResults.every(
      (block) =>
        block.criterionMet === true &&
        ((block.kind !== 'timer' && block.kind !== 'counter') ||
          block.sets.every((set) => set.targetMet)),
    )
  );
}

export function missionRunSummary(run: MissionRun): MissionRunSummary {
  let totalSets = 0;
  let targetMetSets = 0;

  for (const block of run.blockResults) {
    if (block.kind !== 'timer' && block.kind !== 'counter') continue;
    totalSets += block.sets.length;
    targetMetSets += block.sets.filter((set) => set.targetMet).length;
  }

  return {
    completedBlocks: run.blockResults.filter((block) => block.completed).length,
    totalBlocks: run.blockResults.length,
    targetMetSets,
    totalSets,
  };
}

function sameSetTopology(
  current: MissionRunSetResult,
  checkpoint: MissionRunSetResult,
): boolean {
  if (current.setIndex !== checkpoint.setIndex) return false;
  if (
    current.targetDurationSeconds !== checkpoint.targetDurationSeconds ||
    'targetQuantity' in current !== 'targetQuantity' in checkpoint
  ) {
    return false;
  }
  return (
    !('targetQuantity' in current) ||
    ('targetQuantity' in checkpoint && current.targetQuantity === checkpoint.targetQuantity)
  );
}

function sameBlockTopology(
  current: MissionRunBlockResult,
  checkpoint: MissionRunBlockResult,
): boolean {
  if (
    current.kind !== checkpoint.kind ||
    current.blockIndex !== checkpoint.blockIndex ||
    current.title !== checkpoint.title
  ) {
    return false;
  }

  if (current.kind === 'timer' && checkpoint.kind === 'timer') {
    return (
      current.sets.length === checkpoint.sets.length &&
      current.sets.every((set, index) => sameSetTopology(set, checkpoint.sets[index]))
    );
  }

  if (current.kind === 'counter' && checkpoint.kind === 'counter') {
    return (
      current.unit === checkpoint.unit &&
      current.unitLabel === checkpoint.unitLabel &&
      current.sets.length === checkpoint.sets.length &&
      current.sets.every((set, index) => sameSetTopology(set, checkpoint.sets[index]))
    );
  }

  return true;
}

function mergeCurrentUserInput(
  current: MissionRunBlockResult,
  checkpoint: MissionRunBlockResult,
  checkpointIsStale: boolean,
): MissionRunBlockResult {
  if (!checkpointIsStale) return checkpoint;

  const common = {
    ...checkpoint,
    criterionMet: current.criterionMet,
    comment: current.comment,
  };

  if (current.kind === 'counter' && checkpoint.kind === 'counter') {
    return {
      ...common,
      kind: 'counter',
      unit: checkpoint.unit,
      unitLabel: checkpoint.unitLabel,
      sets: checkpoint.sets.map((set, index) => {
        const currentSet = current.sets[index];
        const actualQuantity = currentSet?.actualQuantity ?? set.actualQuantity;
        return {
          ...set,
          actualQuantity,
          targetMet: set.completedAt
            ? actualQuantity >= set.targetQuantity
            : set.targetMet,
        };
      }),
    };
  }

  if (current.kind === 'checklist' && checkpoint.kind === 'checklist') {
    return { ...common, kind: 'checklist', checkedIndexes: [...current.checkedIndexes] };
  }

  if (current.kind === 'text_log' && checkpoint.kind === 'text_log') {
    return { ...common, kind: 'text_log', value: current.value };
  }

  return common as MissionRunBlockResult;
}

/**
 * Accepts a full event checkpoint while keeping run identity and lifecycle fields authoritative.
 * Undefined means the checkpoint belongs to another run or changed the execution topology.
 */
export function replaceMissionRunCheckpoint(
  current: MissionRun,
  checkpoint: MissionRun,
  now: Date | string = new Date(),
): MissionRun | undefined {
  if (
    !isMissionRun(checkpoint) ||
    current.status !== 'running' ||
    checkpoint.status !== 'running' ||
    current.id !== checkpoint.id ||
    current.missionId !== checkpoint.missionId ||
    current.startedAt !== checkpoint.startedAt ||
    current.blockResults.length !== checkpoint.blockResults.length ||
    !current.blockResults.every((block, index) =>
      sameBlockTopology(block, checkpoint.blockResults[index]),
    )
  ) {
    return undefined;
  }

  const checkpointIsStale = checkpoint.updatedAt !== current.updatedAt;
  return {
    ...checkpoint,
    id: current.id,
    missionId: current.missionId,
    status: 'running',
    startedAt: current.startedAt,
    updatedAt: timestamp(now),
    finalCommentDraft: current.finalCommentDraft,
    blockResults: checkpoint.blockResults.map((block, index) =>
      mergeCurrentUserInput(current.blockResults[index], block, checkpointIsStale),
    ),
    finishedAt: undefined,
    finishReason: undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isCursorStage(value: unknown): value is MissionRunCursorStage {
  return ['ready', 'work', 'rest', 'review', 'complete'].includes(String(value));
}

function isSetResult(value: unknown, kind: 'timer' | 'counter'): boolean {
  if (!isRecord(value)) return false;
  if (
    !Number.isInteger(value.setIndex) ||
    !isFiniteNumber(value.targetDurationSeconds) ||
    !isFiniteNumber(value.actualDurationSeconds) ||
    typeof value.targetMet !== 'boolean' ||
    !isOptionalString(value.startedAt) ||
    !isOptionalString(value.completedAt)
  ) {
    return false;
  }
  return (
    kind === 'timer' ||
    (isFiniteNumber(value.targetQuantity) && isFiniteNumber(value.actualQuantity))
  );
}

function isBlockResult(value: unknown): value is MissionRunBlockResult {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.blockIndex) ||
    typeof value.title !== 'string' ||
    typeof value.completed !== 'boolean' ||
    (value.criterionMet !== undefined && typeof value.criterionMet !== 'boolean') ||
    !isOptionalString(value.comment) ||
    !isOptionalString(value.startedAt) ||
    !isOptionalString(value.completedAt)
  ) {
    return false;
  }

  if (value.kind === 'timer' || value.kind === 'counter') {
    const kind = value.kind;
    if (!Array.isArray(value.sets) || !value.sets.every((set) => isSetResult(set, kind))) {
      return false;
    }
    return (
      value.kind === 'timer' ||
      (typeof value.unit === 'string' && isOptionalString(value.unitLabel))
    );
  }
  if (value.kind === 'checklist') {
    return (
      Array.isArray(value.checkedIndexes) &&
      value.checkedIndexes.every((index) => Number.isInteger(index) && index >= 0)
    );
  }
  return value.kind === 'text_log' && typeof value.value === 'string';
}

export function isMissionRun(value: unknown): value is MissionRun {
  if (!isRecord(value) || !isRecord(value.cursor)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.missionId !== 'string' ||
    !['running', 'awaiting_checkin', 'reported'].includes(String(value.status)) ||
    !Number.isInteger(value.cursor.blockIndex) ||
    !Number.isInteger(value.cursor.setIndex) ||
    !isCursorStage(value.cursor.stage) ||
    typeof value.startedAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isOptionalString(value.stageStartedAt) ||
    !isOptionalString(value.stageEndsAt) ||
    !isOptionalString(value.finishedAt) ||
    !isOptionalString(value.finalCommentDraft) ||
    !Array.isArray(value.blockResults) ||
    !value.blockResults.every(isBlockResult)
  ) {
    return false;
  }

  if (
    value.finishReason !== undefined &&
    value.finishReason !== 'completed' &&
    value.finishReason !== 'stopped'
  ) {
    return false;
  }
  return value.status === 'running' || typeof value.finishedAt === 'string';
}
