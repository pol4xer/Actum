import { isMissionRun } from '../domain/mission-run';
import {
  assessmentActualFromMissionRun,
  createGoalProgram,
  goalDurationEndDate,
  inferGoalDuration,
  isGoalProgramCycleComplete,
  parseLegacyGoalTarget,
  programTargetReached,
} from '../domain/goal-program';
import type {
  AppState,
  CheckIn,
  Goal,
  GoalDuration,
  GoalProgram,
  MissionRun,
  PlanVersion,
  ProgramCycleResult,
} from '../domain/types';
import {
  APP_STATE_SCHEMA_VERSION,
  createInitialAppState,
} from './app-state-defaults';

// Deliberately stable: schema migrations happen inside the value, not by changing the key.
export const APP_STATE_STORAGE_KEY = 'actum.app-state.v1';

export { APP_STATE_SCHEMA_VERSION };

export type AppStateV1 = Omit<AppState, 'schemaVersion' | 'missionRuns'> & {
  schemaVersion: 1;
};

export type AppStateV2 = Omit<AppState, 'schemaVersion'> & {
  schemaVersion: 2;
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
    (value.provenance === undefined ||
      value.provenance === 'user' ||
      value.provenance === 'dev-skip') &&
    isFiniteNumber(value.xpDelta) &&
    isFiniteNumber(value.energyDelta) &&
    typeof value.createdAt === 'string'
  );
}

const LEGACY_DEV_SKIP_NOTE = 'Пропущено в DEV-режиме.';

// Translate only built-in labels from earlier releases, never user-authored content.
const LEGACY_CHARACTER_LABELS = new Map([
  ['Первый шаг', 'First step'],
  ['Ясное намерение', 'Clear intention'],
  ['Импульс', 'Momentum'],
  ['Туман сомнений', 'Fog of doubt'],
]);

function withEnglishBuiltInLabels(state: AppState): { state: AppState; migrated: boolean } {
  let migrated = false;
  const translateEffect = (label: string) => {
    const english = LEGACY_CHARACTER_LABELS.get(label);
    if (english) migrated = true;
    return english ?? label;
  };
  const buffs = state.character.buffs.map(translateEffect);
  const debuffs = state.character.debuffs.map(translateEffect);
  const checkIns = state.checkIns.map((checkIn) => {
    if (checkIn.provenance !== 'dev-skip') return checkIn;
    const translateNote = (note: string | undefined) => {
      if (note !== LEGACY_DEV_SKIP_NOTE) return note;
      migrated = true;
      return 'Skipped in development mode.';
    };
    return {
      ...checkIn,
      comment: translateNote(checkIn.comment) ?? '',
      note: translateNote(checkIn.note),
    };
  });
  return {
    state: migrated
      ? { ...state, character: { ...state.character, buffs, debuffs }, checkIns }
      : state,
    migrated,
  };
}

function withLegacyDevSkipProvenance(checkIns: CheckIn[]): {
  checkIns: CheckIn[];
  migrated: boolean;
} {
  let migrated = false;
  const normalized = checkIns.map((checkIn) => {
    if (
      checkIn.provenance === undefined &&
      checkIn.outcome === 'skipped' &&
      checkIn.runId === undefined &&
      checkIn.xpDelta === 0 &&
      checkIn.energyDelta === 0 &&
      checkIn.comment === LEGACY_DEV_SKIP_NOTE &&
      checkIn.note === LEGACY_DEV_SKIP_NOTE
    ) {
      migrated = true;
      return { ...checkIn, provenance: 'dev-skip' as const };
    }
    return checkIn;
  });
  return { checkIns: migrated ? normalized : checkIns, migrated };
}

function withConciseLegacyCycleGoal(state: AppState): {
  state: AppState;
  migrated: boolean;
} {
  const goal = state.activeGoal;
  const plan = state.activePlan;
  const cycleGoal = plan?.cycleGoal?.trim();
  const legacyChapterTitle = plan?.chapters[0]?.title?.trim();
  if (
    !goal ||
    !plan ||
    plan.version >= 6 ||
    (cycleGoal && cycleGoal !== plan.summary.trim() && cycleGoal !== legacyChapterTitle)
  ) {
    return { state, migrated: false };
  }

  const conciseCycleGoal = plan.missions[0]?.title?.trim()
    || legacyChapterTitle
    || goal.title.trim()
    || `Cycle ${plan.cycleNumber ?? goal.program.activeCycle}`;
  if (conciseCycleGoal === cycleGoal) return { state, migrated: false };
  return {
    state: { ...state, activePlan: { ...plan, cycleGoal: conciseCycleGoal } },
    migrated: true,
  };
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
  const hasGoal = value.activeGoal !== undefined;
  const hasPlan = value.activePlan !== undefined;
  return (
    hasGoal === hasPlan &&
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

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isGoalTarget(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.userStatement === 'string' &&
    typeof value.normalizedMetric === 'string' &&
    isNullableFiniteNumber(value.value) &&
    (value.value === null || (value.value as number) >= 0) &&
    isNullableString(value.unit)
  );
}

function isProgramMilestone(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.cycleNumber) &&
    typeof value.title === 'string' &&
    typeof value.focus === 'string' &&
    isNullableFiniteNumber(value.targetValue) &&
    (value.targetValue === null || (value.targetValue as number) >= 0) &&
    isNullableString(value.targetUnit)
  );
}

function isProgramCycleResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.cycleNumber) &&
    typeof value.completedAt === 'string' &&
    Number.isFinite(Date.parse(value.completedAt)) &&
    isNullableFiniteNumber(value.measuredValue) &&
    (value.measuredValue === null || (value.measuredValue as number) >= 0) &&
    isNullableString(value.unit)
  );
}

function isProgramAchievement(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.cycleNumber) &&
    typeof value.completedAt === 'string' &&
    Number.isFinite(Date.parse(value.completedAt)) &&
    isFiniteNumber(value.measuredValue) &&
    value.measuredValue >= 0 &&
    typeof value.unit === 'string' &&
    value.unit.trim().length > 0
  );
}

function isGoalProgram(value: unknown): value is GoalProgram {
  if (!isRecord(value) || !['month', 'half-year', 'year'].includes(String(value.duration))) {
    return false;
  }
  if (
    !Number.isInteger(value.totalDays) ||
    !Number.isInteger(value.totalCycles) ||
    !Number.isInteger(value.activeCycle) ||
    !isGoalTarget(value.target) ||
    !Array.isArray(value.roadmap) ||
    !value.roadmap.every(isProgramMilestone) ||
    !Array.isArray(value.completedCycles) ||
    !value.completedCycles.every(isProgramCycleResult) ||
    (value.achievement !== undefined && !isProgramAchievement(value.achievement))
  ) {
    return false;
  }
  const duration = value.duration as GoalDuration;
  const expected = createGoalProgram({ duration, target: value.target as GoalProgram['target'] });
  const roadmap = value.roadmap as GoalProgram['roadmap'];
  const completedCycles = value.completedCycles as GoalProgram['completedCycles'];
  const achievement = value.achievement as GoalProgram['achievement'];
  return (
    value.totalDays === expected.totalDays &&
    value.totalCycles === expected.totalCycles &&
    (value.activeCycle as number) >= 1 &&
    (value.activeCycle as number) <= expected.totalCycles &&
    roadmap.length === expected.totalCycles &&
    roadmap.every((milestone, index) => milestone.cycleNumber === index + 1) &&
    (achievement === undefined || achievement.cycleNumber === value.activeCycle) &&
    completedCycles.every(
      (result, index) =>
        result.cycleNumber === index + 1 && result.cycleNumber <= (value.activeCycle as number),
    )
  );
}

function hasValidV3ProgramState(value: Record<string, unknown>): boolean {
  if (value.activeGoal === undefined) return value.activePlan === undefined;
  if (!isRecord(value.activeGoal) || !isGoalProgram(value.activeGoal.program)) return false;
  if (!isRecord(value.activePlan)) return value.activePlan === undefined;
  const planCycleComplete = (value.activePlan.missions as Array<{ outcome?: unknown }>).length > 0 &&
    (value.activePlan.missions as Array<{ outcome?: unknown }>).every(
      (mission) => mission.outcome !== 'pending',
    );
  const program = value.activeGoal.program;
  const hasActiveResult = program.completedCycles.some(
    (result) => result.cycleNumber === program.activeCycle,
  );
  const achievementIsConsistent = program.achievement === undefined || (
    value.activeGoal.status === 'completed' &&
    Number(value.activePlan.version) >= 7 &&
    programTargetReached(
      program.target,
      {
        measuredValue: program.achievement.measuredValue,
        unit: program.achievement.unit,
      },
      (value.activeGoal as unknown as Goal).baseline,
    )
  );
  return (
    Number.isInteger(value.activePlan.cycleNumber) &&
    value.activePlan.cycleNumber === program.activeCycle &&
    value.activePlan.totalCycles === program.totalCycles &&
    typeof value.activePlan.cycleGoal === 'string' &&
    achievementIsConsistent &&
    planCycleComplete === hasActiveResult
  );
}

function migrateLegacyGoalAndPlan(
  goal: Goal,
  plan: PlanVersion,
  missionRuns: Record<string, MissionRun>,
  completedAt: string,
): { goal: Goal; plan: PlanVersion } {
  const duration = inferGoalDuration(goal.targetTimeline ?? plan.targetTimeline);
  const target = parseLegacyGoalTarget(goal);
  const baseProgram = createGoalProgram({ duration, target });
  // Old contracts had no machine-readable assessment pointer. Choosing an
  // arbitrary timer/counter would turn ordinary practice into a fake record.
  const assessment = plan.assessment;
  const cycleGoal = plan.cycleGoal?.trim()
    || plan.missions[0]?.title?.trim()
    || plan.chapters?.[0]?.title?.trim()
    || goal.title.trim()
    || 'First cycle';
  const migratedPlan: PlanVersion = {
    ...plan,
    cycleNumber: 1,
    totalCycles: baseProgram.totalCycles,
    cycleGoal,
    assessment,
  };
  const cycleComplete = isGoalProgramCycleComplete(migratedPlan);
  const actual = assessmentActualFromMissionRun(migratedPlan, missionRuns);
  const cycleResult: ProgramCycleResult | undefined = cycleComplete
    ? {
        cycleNumber: 1,
        completedAt,
        measuredValue: actual.measuredValue,
        unit: actual.unit,
      }
    : undefined;
  const program: GoalProgram = {
    ...baseProgram,
    completedCycles: cycleResult ? [cycleResult] : [],
  };
  const targetReached = programTargetReached(
    target,
    actual,
    goal.baseline ?? plan.baseline,
  );
  const targetDate = goalDurationEndDate(goal.createdAt, duration) ?? goal.targetDate;
  const status = targetReached
    ? 'completed'
    : cycleComplete && program.totalCycles === 1
      ? target.value === null
        ? goal.status
        : 'paused'
      : goal.status === 'completed'
        ? 'active'
        : goal.status;

  return {
    goal: {
      ...goal,
      baseline: goal.baseline ?? plan.baseline,
      targetDate,
      status,
      program,
    },
    plan: migratedPlan,
  };
}

function migrateLegacyState(
  value: AppStateV1 | AppStateV2,
  missionRuns: Record<string, MissionRun>,
): AppState {
  const normalizedCheckIns = withLegacyDevSkipProvenance(value.checkIns);
  const pair =
    value.activeGoal && value.activePlan
      ? migrateLegacyGoalAndPlan(
          value.activeGoal,
          value.activePlan,
          missionRuns,
          value.lastUpdatedAt,
        )
      : undefined;
  return withEnglishBuiltInLabels({
    ...value,
    schemaVersion: APP_STATE_SCHEMA_VERSION,
    activeGoal: pair?.goal ?? value.activeGoal,
    activePlan: pair?.plan ?? value.activePlan,
    checkIns: normalizedCheckIns.checkIns,
    missionRuns,
  }).state;
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
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== APP_STATE_SCHEMA_VERSION) {
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
      state: migrateLegacyState(previous, {}),
    };
  }

  if (!hasValidMissionRuns(value.missionRuns)) {
    return { status: 'blocked', reason: 'corrupt', schemaVersion };
  }

  if (schemaVersion === 2) {
    return {
      status: 'ready',
      source: 'stored',
      migrated: true,
      state: migrateLegacyState(value as unknown as AppStateV2, value.missionRuns),
    };
  }

  if (!hasValidV3ProgramState(value)) {
    return { status: 'blocked', reason: 'corrupt', schemaVersion };
  }

  const state = value as unknown as AppState;
  const normalizedCheckIns = withLegacyDevSkipProvenance(state.checkIns);
  const normalizedState = normalizedCheckIns.migrated
    ? { ...state, checkIns: normalizedCheckIns.checkIns }
    : state;
  const conciseCycleGoal = withConciseLegacyCycleGoal(normalizedState);
  const englishLabels = withEnglishBuiltInLabels(conciseCycleGoal.state);
  return {
    status: 'ready',
    source: 'stored',
    state: englishLabels.state,
    migrated: normalizedCheckIns.migrated || conciseCycleGoal.migrated || englishLabels.migrated,
  };
}
