import { isMissionRun } from '../domain/mission-run';
import type { AppState, MissionRun } from '../domain/types';
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
