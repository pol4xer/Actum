import type {
  GoalProgram,
  ProgramAchievement,
  ProgramCycleResult,
  ProgramMilestone,
} from '@/domain/types';
import { formatMetricValue } from '@/shared/presentation/plan-formatters';

export type ProgramRoadmapMilestone = Readonly<{
  milestone: ProgramMilestone;
  result?: ProgramCycleResult;
  achievement?: ProgramAchievement;
}>;

export type ProgramRoadmapPresentation = Readonly<{
  progress: number;
  plannedCycles: number;
  primaryMilestones: readonly ProgramRoadmapMilestone[];
  reserveMilestones: readonly ProgramRoadmapMilestone[];
}>;

/** Keeps a completed month distinct from the milestone value it was aiming for. */
export function roadmapMilestoneMetricLabel(
  item: ProgramRoadmapMilestone,
): string | undefined {
  const actual = formatMetricValue(
    item.achievement?.measuredValue ?? item.result?.measuredValue,
    item.achievement?.unit ?? item.result?.unit,
  );
  const target = formatMetricValue(
    item.milestone.targetValue,
    item.milestone.targetUnit,
  );

  if (!item.result && !item.achievement) {
    return target ? `Ориентир ${target}` : undefined;
  }
  if (actual && target) return `Факт ${actual} · ориентир ${target}`;
  if (actual) return `Факт ${actual}`;
  return target ? `Месяц пройден · ориентир ${target}` : 'Месяц пройден';
}

/** Separates the estimated route from optional retries without changing persisted data. */
export function createProgramRoadmapPresentation(
  program: GoalProgram,
  targetCycleNumber: number | undefined,
): ProgramRoadmapPresentation {
  const hasTargetCycle =
    Number.isInteger(targetCycleNumber) &&
    (targetCycleNumber ?? 0) >= 1 &&
    (targetCycleNumber ?? 0) <= program.totalCycles;
  const achievementCycle =
    program.achievement &&
    Number.isInteger(program.achievement.cycleNumber) &&
    program.achievement.cycleNumber >= 1 &&
    program.achievement.cycleNumber <= program.totalCycles
      ? program.achievement.cycleNumber
      : undefined;
  const plannedCycles =
    achievementCycle ??
    (hasTargetCycle ? (targetCycleNumber as number) : program.totalCycles);
  const resultByCycle = new Map(
    program.completedCycles.map((result) => [result.cycleNumber, result]),
  );
  const completedPlannedCycles = [...resultByCycle.keys()].filter(
    (cycleNumber) => cycleNumber <= plannedCycles,
  ).length;
  const items = program.roadmap.map((milestone) => ({
    milestone,
    result: resultByCycle.get(milestone.cycleNumber),
    achievement:
      program.achievement?.cycleNumber === milestone.cycleNumber
        ? program.achievement
        : undefined,
  }));

  const progress = achievementCycle
    ? 1
    : plannedCycles
      ? Math.min(1, completedPlannedCycles / plannedCycles)
      : 0;
  const primaryMilestones = achievementCycle || hasTargetCycle
    ? items.filter(({ milestone }) => milestone.cycleNumber <= plannedCycles)
    : items;
  const reserveMilestones = achievementCycle
    ? []
    : hasTargetCycle
      ? items.filter(({ milestone }) => milestone.cycleNumber > plannedCycles)
      : [];

  return {
    progress,
    plannedCycles,
    primaryMilestones,
    reserveMilestones,
  };
}
