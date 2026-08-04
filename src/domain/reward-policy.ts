import type { CheckIn, Mission, MissionOutcome } from './types';

type ReportedMissionOutcome = Exclude<MissionOutcome, 'pending'>;

const PARTIAL_COMPLETION_WEIGHT = 0.45;

export const REWARD_POLICY = {
  initialEnergy: 76,
  initialWorldLight: 18,
  xpPerLevel: 100,
  adherence: {
    alignedThreshold: 0.8,
    recoverableThreshold: PARTIAL_COMPLETION_WEIGHT,
  },
  outcomes: {
    completed: {
      xpMultiplier: 1,
      energyDelta: 6,
      worldLightDelta: 7,
    },
    partial: {
      xpMultiplier: PARTIAL_COMPLETION_WEIGHT,
      energyDelta: -2,
      worldLightDelta: 2,
    },
    skipped: {
      xpMultiplier: 0,
      energyDelta: -10,
      worldLightDelta: -5,
    },
  },
} as const;

export type AdherenceBand = 'unreported' | 'aligned' | 'recoverable' | 'returning';

export type MissionReward = {
  xpDelta: number;
  energyDelta: number;
  worldLightDelta: number;
};

export type TwinProjection = {
  completed: number;
  partial: number;
  reported: number;
  skipped: number;
  projectedXp: number;
  actualXp: number;
  adherence: number;
  adherenceBand: AdherenceBand;
  potentialLevel: number;
  potentialEnergy: number;
  potentialLight: number;
};

export function clampCharacterMeter(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function levelForXp(xp: number): number {
  return Math.floor(xp / REWARD_POLICY.xpPerLevel) + 1;
}

export function missionReward(
  missionXp: number,
  outcome: ReportedMissionOutcome,
): MissionReward {
  const reward = REWARD_POLICY.outcomes[outcome];
  return {
    xpDelta: Math.round(missionXp * reward.xpMultiplier),
    energyDelta: reward.energyDelta,
    worldLightDelta: reward.worldLightDelta,
  };
}

export function adherenceBand(adherence: number, reported: number): AdherenceBand {
  if (reported === 0) return 'unreported';
  if (adherence >= REWARD_POLICY.adherence.alignedThreshold) return 'aligned';
  if (adherence >= REWARD_POLICY.adherence.recoverableThreshold) return 'recoverable';
  return 'returning';
}

/**
 * Selects the real and full-completion trajectories from the current plan only.
 * The first mission remains visible before the first report, matching the original prototype.
 */
export function selectTwinProjection(
  missions: readonly Pick<Mission, 'outcome' | 'xp'>[],
  checkIns: readonly Pick<CheckIn, 'xpDelta'>[],
): TwinProjection {
  const completed = missions.filter((mission) => mission.outcome === 'completed').length;
  const partial = missions.filter((mission) => mission.outcome === 'partial').length;
  const reported = missions.filter((mission) => mission.outcome !== 'pending').length;
  const skipped = reported - completed - partial;
  const projectedXp = missions
    .slice(0, Math.max(1, reported))
    .reduce((sum, mission) => sum + mission.xp, 0);
  const actualXp = checkIns.reduce((sum, checkIn) => sum + checkIn.xpDelta, 0);
  const adherence = reported
    ? (completed + partial * REWARD_POLICY.outcomes.partial.xpMultiplier) / reported
    : 0;
  const completedReward = REWARD_POLICY.outcomes.completed;

  return {
    completed,
    partial,
    reported,
    skipped,
    projectedXp,
    actualXp,
    adherence,
    adherenceBand: adherenceBand(adherence, reported),
    potentialLevel: levelForXp(projectedXp),
    potentialEnergy: clampCharacterMeter(
      REWARD_POLICY.initialEnergy + reported * completedReward.energyDelta,
    ),
    potentialLight: clampCharacterMeter(
      REWARD_POLICY.initialWorldLight + reported * completedReward.worldLightDelta,
    ),
  };
}
