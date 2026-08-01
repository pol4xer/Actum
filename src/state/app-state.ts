import {
  isMissionRun,
  isMissionRunSuccessful,
  replaceMissionRunCheckpoint,
} from '../domain/mission-run';
import type {
  AppState,
  GeneratedGoal,
  MissionOutcome,
  MissionRun,
  MissionRunFinishReason,
  MissionRunMutation,
  Profile,
} from '../domain/types';

export const APP_STATE_SCHEMA_VERSION = 2 as const;
// Deliberately stable: schema migrations happen inside the value, not by changing the key.
export const APP_STATE_STORAGE_KEY = 'actum.app-state.v1';

export type AppStateV1 = Omit<AppState, 'schemaVersion' | 'missionRuns'> & {
  schemaVersion: 1;
};

export type RestoreAppStateResult =
  | {
      status: 'ready';
      source: 'empty' | 'stored';
      state: AppState;
      migrated: boolean;
    }
  | {
      status: 'blocked';
      reason: 'corrupt' | 'unsupported-schema';
      schemaVersion?: number;
    };

export type AppStateAction =
  | { type: 'finish-onboarding'; profile: Profile; now: string }
  | { type: 'create-goal'; generated: GeneratedGoal; now: string }
  | { type: 'begin-mission-run'; run: MissionRun; now: string }
  | { type: 'restart-mission-run'; run: MissionRun; now: string }
  | { type: 'save-mission-run'; run: MissionRun; now: string }
  | {
      type: 'mutate-mission-run';
      missionId: string;
      runId: string;
      mutation: MissionRunMutation;
      now: string;
    }
  | {
      type: 'finish-mission-run';
      run: MissionRun;
      finishReason: MissionRunFinishReason;
      now: string;
    }
  | {
      type: 'report-mission';
      missionId: string;
      runId?: string;
      outcome: Exclude<MissionOutcome, 'pending'>;
      note?: string;
      checkInId: string;
      now: string;
    }
  | { type: 'set-notifications-enabled'; enabled: boolean; now: string }
  | { type: 'start-new-goal'; now: string }
  | { type: 'reset'; state: AppState };

function toTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function createInitialAppState(now: Date | string = new Date(0)): AppState {
  return {
    schemaVersion: APP_STATE_SCHEMA_VERSION,
    onboardingCompleted: false,
    character: {
      level: 1,
      xp: 0,
      energy: 76,
      streak: 0,
      worldLight: 18,
      buffs: ['Первый шаг'],
      debuffs: [],
    },
    checkIns: [],
    missionRuns: {},
    settings: {
      notificationsEnabled: false,
      reminderHour: 9,
      reminderMinute: 0,
    },
    lastUpdatedAt: toTimestamp(now),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCharacter(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.level) &&
    isFiniteNumber(value.xp) &&
    isFiniteNumber(value.energy) &&
    isFiniteNumber(value.streak) &&
    isFiniteNumber(value.worldLight) &&
    isStringArray(value.buffs) &&
    isStringArray(value.debuffs)
  );
}

function isSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.notificationsEnabled === 'boolean' &&
    isFiniteNumber(value.reminderHour) &&
    isFiniteNumber(value.reminderMinute)
  );
}

function isCheckIn(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.missionId === 'string' &&
    (value.runId === undefined || typeof value.runId === 'string') &&
    ['completed', 'partial', 'skipped'].includes(String(value.outcome)) &&
    (value.comment === undefined || typeof value.comment === 'string') &&
    (value.note === undefined || typeof value.note === 'string') &&
    isFiniteNumber(value.xpDelta) &&
    isFiniteNumber(value.energyDelta) &&
    typeof value.createdAt === 'string'
  );
}

function hasValidOptionalPlan(value: Record<string, unknown>): boolean {
  if (value.activePlan === undefined) return true;
  return (
    isRecord(value.activePlan) &&
    typeof value.activePlan.id === 'string' &&
    Array.isArray(value.activePlan.missions)
  );
}

function hasValidOptionalGoal(value: Record<string, unknown>): boolean {
  return (
    value.activeGoal === undefined ||
    (isRecord(value.activeGoal) && typeof value.activeGoal.id === 'string')
  );
}

function hasValidBaseState(value: Record<string, unknown>): boolean {
  return (
    typeof value.onboardingCompleted === 'boolean' &&
    isCharacter(value.character) &&
    Array.isArray(value.checkIns) &&
    value.checkIns.every(isCheckIn) &&
    isSettings(value.settings) &&
    typeof value.lastUpdatedAt === 'string' &&
    hasValidOptionalGoal(value) &&
    hasValidOptionalPlan(value)
  );
}

function hasValidMissionRuns(value: unknown): value is Record<string, MissionRun> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([missionId, run]) => isMissionRun(run) && run.missionId === missionId,
  );
}

/**
 * Decodes storage without guessing. A blocked result must keep persistence disabled so an
 * unknown future or corrupt payload is not replaced by fresh state merely by opening the app.
 */
export function restoreAppState(raw: string | null): RestoreAppStateResult {
  if (raw === null) {
    return {
      status: 'ready',
      source: 'empty',
      state: createInitialAppState(),
      migrated: false,
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: 'blocked', reason: 'corrupt' };
  }

  if (!isRecord(value) || !Number.isInteger(value.schemaVersion)) {
    return { status: 'blocked', reason: 'corrupt' };
  }

  const schemaVersion = value.schemaVersion as number;
  if (schemaVersion !== 1 && schemaVersion !== APP_STATE_SCHEMA_VERSION) {
    return { status: 'blocked', reason: 'unsupported-schema', schemaVersion };
  }

  if (!hasValidBaseState(value)) {
    return { status: 'blocked', reason: 'corrupt', schemaVersion };
  }

  if (schemaVersion === 1) {
    const previous = value as unknown as AppStateV1;
    return {
      status: 'ready',
      source: 'stored',
      migrated: true,
      state: {
        ...previous,
        schemaVersion: APP_STATE_SCHEMA_VERSION,
        missionRuns: {},
      },
    };
  }

  if (!hasValidMissionRuns(value.missionRuns)) {
    return { status: 'blocked', reason: 'corrupt', schemaVersion };
  }

  return {
    status: 'ready',
    source: 'stored',
    state: value as unknown as AppState,
    migrated: false,
  };
}

function withTimestamp(state: AppState, now: string): AppState {
  return { ...state, lastUpdatedAt: now };
}

function hasPendingMission(state: AppState, missionId: string): boolean {
  return Boolean(
    state.activePlan?.missions.some(
      (mission) => mission.id === missionId && mission.outcome === 'pending',
    ),
  );
}

function mutateMissionRun(
  run: MissionRun,
  mutation: MissionRunMutation,
  now: string,
): MissionRun | undefined {
  if (mutation.kind === 'set-final-comment') {
    if (run.status !== 'awaiting_checkin') return undefined;
    return { ...run, finalCommentDraft: mutation.value.slice(0, 280), updatedAt: now };
  }

  if (
    run.status !== 'running' ||
    mutation.blockIndex !== run.cursor.blockIndex
  ) {
    return undefined;
  }

  const blockResults = run.blockResults.map((block, index) => {
    if (index !== mutation.blockIndex) return block;

    if (
      mutation.kind === 'set-counter' &&
      run.cursor.stage === 'work' &&
      block.kind === 'counter' &&
      mutation.setIndex === run.cursor.setIndex &&
      block.sets[mutation.setIndex] &&
      Number.isFinite(mutation.value)
    ) {
      const sets = block.sets.map((set, setIndex) =>
        setIndex === mutation.setIndex
          ? { ...set, actualQuantity: Math.min(1_000_000, Math.max(0, mutation.value)) }
          : set,
      );
      return { ...block, sets };
    }

    if (
      mutation.kind === 'toggle-checklist' &&
      run.cursor.stage === 'work' &&
      block.kind === 'checklist' &&
      Number.isInteger(mutation.itemIndex) &&
      mutation.itemIndex >= 0
    ) {
      const checked = block.checkedIndexes.includes(mutation.itemIndex);
      return {
        ...block,
        checkedIndexes: checked
          ? block.checkedIndexes.filter((index) => index !== mutation.itemIndex)
          : [...block.checkedIndexes, mutation.itemIndex].sort((left, right) => left - right),
      };
    }

    if (
      mutation.kind === 'set-text-log' &&
      run.cursor.stage === 'work' &&
      block.kind === 'text_log'
    ) {
      return { ...block, value: mutation.value.slice(0, 4_000) };
    }

    if (
      mutation.kind === 'set-block-comment' &&
      run.cursor.stage === 'review'
    ) {
      return { ...block, comment: mutation.value.slice(0, 500) };
    }

    if (
      mutation.kind === 'set-block-criterion' &&
      run.cursor.stage === 'review'
    ) {
      return { ...block, criterionMet: mutation.value };
    }

    return block;
  });

  if (blockResults.every((block, index) => block === run.blockResults[index])) return undefined;
  return { ...run, blockResults, updatedAt: now };
}

export function appStateReducer(state: AppState, action: AppStateAction): AppState {
  if (action.type === 'reset') return action.state;

  if (action.type === 'finish-onboarding') {
    return withTimestamp(
      { ...state, onboardingCompleted: true, profile: action.profile },
      action.now,
    );
  }

  if (action.type === 'create-goal') {
    return withTimestamp(
      {
        ...state,
        activeGoal: action.generated.goal,
        activePlan: action.generated.plan,
        checkIns: [],
        missionRuns: {},
        recovery: undefined,
        character: {
          ...state.character,
          energy: Math.max(state.character.energy, 76),
          buffs: ['Ясное намерение'],
          debuffs: [],
        },
      },
      action.now,
    );
  }

  if (action.type === 'begin-mission-run' || action.type === 'restart-mission-run') {
    const { run } = action;
    if (!hasPendingMission(state, run.missionId) || !isMissionRun(run)) return state;
    if (action.type === 'begin-mission-run' && state.missionRuns[run.missionId]) return state;
    return withTimestamp(
      {
        ...state,
        missionRuns: { ...state.missionRuns, [run.missionId]: run },
        recovery: undefined,
      },
      action.now,
    );
  }

  if (action.type === 'save-mission-run') {
    const current = state.missionRuns[action.run.missionId];
    if (!current || !hasPendingMission(state, action.run.missionId)) return state;
    if (
      current.status === 'awaiting_checkin' &&
      action.run.status === 'awaiting_checkin' &&
      action.run.id === current.id &&
      action.run.missionId === current.missionId
    ) {
      const draft = action.run.finalCommentDraft?.slice(0, 280);
      return withTimestamp(
        {
          ...state,
          missionRuns: {
            ...state.missionRuns,
            [current.missionId]: { ...current, finalCommentDraft: draft, updatedAt: action.now },
          },
        },
        action.now,
      );
    }
    const replacement = replaceMissionRunCheckpoint(current, action.run, action.now);
    if (!replacement) return state;
    return withTimestamp(
      {
        ...state,
        missionRuns: { ...state.missionRuns, [replacement.missionId]: replacement },
      },
      action.now,
    );
  }

  if (action.type === 'mutate-mission-run') {
    const current = state.missionRuns[action.missionId];
    if (
      !current ||
      current.id !== action.runId ||
      !hasPendingMission(state, action.missionId)
    ) {
      return state;
    }
    const mutated = mutateMissionRun(current, action.mutation, action.now);
    if (!mutated) return state;
    return withTimestamp(
      {
        ...state,
        missionRuns: { ...state.missionRuns, [action.missionId]: mutated },
      },
      action.now,
    );
  }

  if (action.type === 'finish-mission-run') {
    const current = state.missionRuns[action.run.missionId];
    if (!current || !hasPendingMission(state, action.run.missionId)) return state;
    const checkpoint = replaceMissionRunCheckpoint(current, action.run, action.now);
    if (!checkpoint) return state;
    const finished: MissionRun = {
      ...checkpoint,
      status: 'awaiting_checkin',
      cursor: { ...checkpoint.cursor, stage: 'complete' },
      updatedAt: action.now,
      stageStartedAt: action.now,
      stageEndsAt: undefined,
      finishedAt: action.now,
      finishReason: action.finishReason,
    };
    return withTimestamp(
      {
        ...state,
        missionRuns: { ...state.missionRuns, [action.run.missionId]: finished },
      },
      action.now,
    );
  }

  if (action.type === 'report-mission') {
    if (!state.activePlan) return state;
    const mission = state.activePlan.missions.find((item) => item.id === action.missionId);
    const run = state.missionRuns[action.missionId];
    if (!mission || mission.outcome !== 'pending') return state;

    const requiresRun = mission.execution?.kind === 'in_app';
    if (requiresRun) {
      if (
        !run ||
        run.status !== 'awaiting_checkin' ||
        (action.runId !== undefined && run.id !== action.runId) ||
        (action.outcome === 'completed' && !isMissionRunSuccessful(run))
      ) {
        return state;
      }
    }

    const multiplier = action.outcome === 'completed' ? 1 : action.outcome === 'partial' ? 0.45 : 0;
    const xpDelta = Math.round(mission.xp * multiplier);
    const energyDelta = action.outcome === 'completed' ? 6 : action.outcome === 'partial' ? -2 : -10;
    const xp = state.character.xp + xpDelta;
    const missions = state.activePlan.missions.map((item) =>
      item.id === action.missionId ? { ...item, outcome: action.outcome } : item,
    );
    const allReported = missions.every((item) => item.outcome !== 'pending');
    const debuffs =
      action.outcome === 'skipped'
        ? Array.from(new Set([...state.character.debuffs, 'Туман сомнений']))
        : state.character.debuffs.filter((debuff) => debuff !== 'Туман сомнений');
    const reportedRun: MissionRun | undefined = run
      ? { ...run, status: 'reported', updatedAt: action.now }
      : undefined;
    const comment = action.note?.trim() || undefined;

    return withTimestamp(
      {
        ...state,
        activeGoal: state.activeGoal
          ? { ...state.activeGoal, status: allReported ? 'completed' : 'active' }
          : undefined,
        activePlan: { ...state.activePlan, missions },
        missionRuns: reportedRun
          ? { ...state.missionRuns, [action.missionId]: reportedRun }
          : state.missionRuns,
        checkIns: [
          {
            id: action.checkInId,
            missionId: action.missionId,
            runId: run?.id,
            outcome: action.outcome,
            comment,
            note: comment,
            xpDelta,
            energyDelta,
            createdAt: action.now,
          },
          ...state.checkIns,
        ],
        character: {
          ...state.character,
          xp,
          level: Math.floor(xp / 100) + 1,
          energy: Math.max(0, Math.min(100, state.character.energy + energyDelta)),
          streak: action.outcome === 'completed' ? state.character.streak + 1 : 0,
          worldLight: Math.max(
            0,
            Math.min(
              100,
              state.character.worldLight +
                (action.outcome === 'completed' ? 7 : action.outcome === 'partial' ? 2 : -5),
            ),
          ),
          buffs:
            action.outcome === 'completed'
              ? Array.from(new Set([...state.character.buffs, 'Импульс']))
              : state.character.buffs.filter((buff) => buff !== 'Импульс'),
          debuffs,
        },
        recovery: undefined,
      },
      action.now,
    );
  }

  if (action.type === 'set-notifications-enabled') {
    return withTimestamp(
      {
        ...state,
        settings: { ...state.settings, notificationsEnabled: action.enabled },
      },
      action.now,
    );
  }

  if (action.type === 'start-new-goal') {
    return withTimestamp(
      {
        ...state,
        activeGoal: undefined,
        activePlan: undefined,
        checkIns: [],
        missionRuns: {},
        recovery: undefined,
      },
      action.now,
    );
  }

  return state;
}
