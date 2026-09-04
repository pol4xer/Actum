import { REWARD_POLICY } from '../domain/reward-policy';
import type { AppState } from '../domain/types';

export const APP_STATE_SCHEMA_VERSION = 3 as const;

function toTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Builds the empty aggregate independently from reducer and storage concerns. */
export function createInitialAppState(now: Date | string = new Date(0)): AppState {
  return {
    schemaVersion: APP_STATE_SCHEMA_VERSION,
    onboardingCompleted: false,
    character: {
      level: 1,
      xp: 0,
      energy: REWARD_POLICY.initialEnergy,
      streak: 0,
      worldLight: REWARD_POLICY.initialWorldLight,
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
