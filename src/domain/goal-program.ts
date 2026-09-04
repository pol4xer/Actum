import type {
  Goal,
  GoalDuration,
  GoalProgram,
  GoalTarget,
  MissionRun,
  PlanVersion,
  ProgramMilestone,
} from './types';

export const GOAL_DURATION_CONFIG = Object.freeze({
  month: Object.freeze({ totalDays: 30, totalCycles: 1 }),
  'half-year': Object.freeze({ totalDays: 180, totalCycles: 6 }),
  year: Object.freeze({ totalDays: 365, totalCycles: 12 }),
} satisfies Record<GoalDuration, Readonly<{ totalDays: number; totalCycles: number }>>);

const GOAL_DURATION_LABELS: Record<GoalDuration, string> = {
  month: 'Месяц',
  'half-year': 'Полгода',
  year: 'Год',
};

export function goalDurationLabel(duration: GoalDuration): string {
  return GOAL_DURATION_LABELS[duration];
}

export function inferGoalDuration(targetTimeline: string | undefined): GoalDuration {
  const normalized = targetTimeline?.trim().toLocaleLowerCase('ru-RU') ?? '';
  if (
    /(?:полу?\s*-?\s*года?|полугод|6\s*месяц|шесть\s+месяц|six[-\s]+months?|half(?:[-\s]+a)?[-\s]+year)/u
      .test(normalized)
  ) {
    return 'half-year';
  }
  if (/(год|12\s*месяц|\byear\b|twelve\s+months?)/u.test(normalized)) return 'year';
  return 'month';
}

function decimalNumber(value: string): number | undefined {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Best-effort conversion used only to preserve old local plans during schema migration. */
export function parseLegacyGoalTarget(goal: Pick<Goal, 'rawPrompt' | 'targetMetric'>): GoalTarget {
  const sources = [goal.targetMetric, goal.rawPrompt].filter(Boolean);
  const timeCandidates: number[] = [];
  for (const source of sources) {
    const matches = source.matchAll(
      /(\d+(?:[.,]\d+)?)\s*(час(?:а|ов)?|hour(?:s)?|hr|минут(?:а|ы)?|мин(?:\.|ут)?|minute(?:s)?|min|секунд(?:а|ы)?|сек(?:\.|унд)?|second(?:s)?|sec)(?=$|[\s,.;:!?])/giu,
    );
    for (const match of matches) {
      const value = decimalNumber(match[1]);
      if (value === undefined) continue;
      const unit = match[2].toLocaleLowerCase('ru-RU');
      const multiplier = /^(час|hour|hr)/u.test(unit)
        ? 3_600
        : /^(мин|minute|min)/u.test(unit)
          ? 60
          : 1;
      timeCandidates.push(value * multiplier);
    }
  }
  if (timeCandidates.length > 0) {
    return {
      userStatement: goal.rawPrompt,
      normalizedMetric: goal.targetMetric.trim() || 'duration',
      value: Math.max(...timeCandidates),
      unit: 'seconds',
    };
  }

  const genericUnitPattern =
    /(\d+(?:[.,]\d+)?)\s*(pages?|страниц(?:а|ы)?|reps?|повтор(?:а|ов|ения|ений)?|words?|слов(?:о|а)?|meters?|metres?|метр(?:а|ов)?|items?|элемент(?:а|ов)?|attempts?|попыт(?:ка|ки|ок))/giu;
  for (const source of sources) {
    const matches = [...source.matchAll(genericUnitPattern)];
    const match = matches.at(-1);
    const value = match ? decimalNumber(match[1]) : undefined;
    if (!match || value === undefined) continue;
    const rawUnit = match[2].toLocaleLowerCase('ru-RU');
    const unit = /^(page|страниц)/u.test(rawUnit)
      ? 'pages'
      : /^(rep|повтор)/u.test(rawUnit)
        ? 'reps'
        : /^(word|слов)/u.test(rawUnit)
          ? 'words'
          : /^(meter|metre|метр)/u.test(rawUnit)
            ? 'meters'
            : /^(attempt|попыт)/u.test(rawUnit)
              ? 'attempts'
              : 'items';
    return {
      userStatement: goal.rawPrompt,
      normalizedMetric: goal.targetMetric.trim() || unit,
      value,
      unit,
    };
  }

  return {
    userStatement: goal.rawPrompt,
    normalizedMetric: goal.targetMetric.trim() || goal.rawPrompt,
    value: null,
    unit: null,
  };
}

/** Returns the final inclusive local-calendar day while preserving the local wall-clock time. */
export function goalDurationEndDate(createdAt: string, duration: GoalDuration): string | undefined {
  const start = new Date(createdAt);
  if (!Number.isFinite(start.getTime())) return undefined;
  const { totalDays } = GOAL_DURATION_CONFIG[duration];
  const end = new Date(start);
  end.setDate(end.getDate() + totalDays - 1);
  return end.toISOString();
}

export function createProgramRoadmap(
  duration: GoalDuration,
  target: GoalTarget,
): ProgramMilestone[] {
  const { totalCycles } = GOAL_DURATION_CONFIG[duration];
  return Array.from({ length: totalCycles }, (_, index) => {
    const cycleNumber = index + 1;
    const isFinal = cycleNumber === totalCycles;
    return {
      cycleNumber,
      title: `Цикл ${cycleNumber}`,
      focus: isFinal ? 'Итоговый цикл и контрольный замер' : 'Следующий адаптивный цикл',
      // A legacy migration cannot know evidence-backed intermediate targets.
      targetValue: isFinal ? target.value : null,
      targetUnit: isFinal ? target.unit : null,
    };
  });
}

export function createGoalProgram(input: {
  duration: GoalDuration;
  target: GoalTarget;
  activeCycle?: number;
  roadmap?: ProgramMilestone[];
}): GoalProgram {
  const config = GOAL_DURATION_CONFIG[input.duration];
  const activeCycle = Math.min(
    config.totalCycles,
    Math.max(1, Math.trunc(input.activeCycle ?? 1)),
  );
  return {
    duration: input.duration,
    totalDays: config.totalDays,
    totalCycles: config.totalCycles,
    activeCycle,
    target: input.target,
    roadmap: input.roadmap ?? createProgramRoadmap(input.duration, input.target),
    completedCycles: [],
  };
}

export function isGoalProgramCycleComplete(plan: PlanVersion | undefined): boolean {
  return Boolean(
    plan &&
      plan.missions.length > 0 &&
      plan.missions.every((mission) => mission.outcome !== 'pending'),
  );
}

export type ProgramAssessmentActual = {
  measuredValue: number | null;
  unit: string | null;
};

const METRIC_UNIT_ALIASES = new Map<string, string>([
  ['reps', 'reps'],
  ['rep', 'reps'],
  ['repetitions', 'reps'],
  ['повтор', 'reps'],
  ['повтора', 'reps'],
  ['повторов', 'reps'],
  ['повторения', 'reps'],
  ['seconds', 'seconds'],
  ['second', 'seconds'],
  ['sec', 'seconds'],
  ['secs', 'seconds'],
  ['s', 'seconds'],
  ['сек', 'seconds'],
  ['секунда', 'seconds'],
  ['секунды', 'seconds'],
  ['секунд', 'seconds'],
  ['minutes', 'minutes'],
  ['minute', 'minutes'],
  ['min', 'minutes'],
  ['mins', 'minutes'],
  ['мин', 'minutes'],
  ['минута', 'minutes'],
  ['минуты', 'minutes'],
  ['минут', 'minutes'],
  ['pages', 'pages'],
  ['page', 'pages'],
  ['стр', 'pages'],
  ['страница', 'pages'],
  ['страницы', 'pages'],
  ['страниц', 'pages'],
  ['items', 'items'],
  ['item', 'items'],
  ['элемент', 'items'],
  ['элемента', 'items'],
  ['элементов', 'items'],
  ['words', 'words'],
  ['word', 'words'],
  ['слово', 'words'],
  ['слова', 'words'],
  ['слов', 'words'],
  ['meters', 'meters'],
  ['meter', 'meters'],
  ['metres', 'meters'],
  ['metre', 'meters'],
  ['m', 'meters'],
  ['метр', 'meters'],
  ['метра', 'meters'],
  ['метров', 'meters'],
  ['attempts', 'attempts'],
  ['attempt', 'attempts'],
  ['попытка', 'attempts'],
  ['попытки', 'attempts'],
  ['попыток', 'attempts'],
]);

export function canonicalMetricUnit(unit: string | null | undefined): string | undefined {
  if (typeof unit !== 'string') return undefined;
  const normalized = unit.trim().toLocaleLowerCase('ru-RU');
  if (!normalized) return undefined;
  return METRIC_UNIT_ALIASES.get(normalized) ?? normalized;
}

export type MetricPoint = {
  value: number | null | undefined;
  unit: string | null | undefined;
};

/** Progress along the original baseline→target direction, clamped for UI presentation. */
export function goalMetricProgress(
  baseline: MetricPoint,
  current: MetricPoint,
  target: MetricPoint,
): number | undefined {
  if (
    !Number.isFinite(baseline.value) ||
    !Number.isFinite(current.value) ||
    !Number.isFinite(target.value)
  ) {
    return undefined;
  }
  const baselineUnit = canonicalMetricUnit(baseline.unit);
  const currentUnit = canonicalMetricUnit(current.unit);
  const targetUnit = canonicalMetricUnit(target.unit);
  if (!baselineUnit || baselineUnit !== currentUnit || baselineUnit !== targetUnit) {
    return undefined;
  }

  const baselineValue = baseline.value as number;
  const currentValue = current.value as number;
  const targetValue = target.value as number;
  if (baselineValue === targetValue) return 1;
  const progress = (currentValue - baselineValue) / (targetValue - baselineValue);
  return Math.min(1, Math.max(0, progress));
}

function timerUnitValue(seconds: number, targetUnit: string | null): ProgramAssessmentActual {
  const normalizedUnit = targetUnit?.trim().toLocaleLowerCase('ru-RU');
  if (normalizedUnit && /^(minute|minutes|min|минута|минуты|минут|мин)$/.test(normalizedUnit)) {
    return { measuredValue: seconds / 60, unit: targetUnit };
  }
  return { measuredValue: seconds, unit: targetUnit ?? 'seconds' };
}

function assessmentValue(
  plan: PlanVersion,
  values: number[],
  targetUnit: string | null,
): number | undefined {
  if (values.length === 0) return undefined;
  const baseline = plan.baseline;
  const targetValue = plan.assessment?.targetValue;
  const decreasing =
    Number.isFinite(baseline?.value) &&
    Number.isFinite(targetValue) &&
    canonicalMetricUnit(baseline?.unit) === canonicalMetricUnit(targetUnit) &&
    (baseline?.value as number) > (targetValue as number);
  return decreasing ? Math.min(...values) : Math.max(...values);
}

function recordedSetValue(
  set: { completedAt?: string },
  value: number,
): number | undefined {
  return set.completedAt && Number.isFinite(Date.parse(set.completedAt)) && Number.isFinite(value)
    ? value
    : undefined;
}

/** Reads the assessment block named by plan-v6. It never infers work from a missing run. */
export function assessmentActualFromMissionRun(
  plan: PlanVersion,
  missionRuns: Record<string, MissionRun>,
): ProgramAssessmentActual {
  const assessment = plan.assessment;
  if (!assessment) return { measuredValue: null, unit: null };
  const mission = plan.missions.find(
    (candidate) => (candidate.dayNumber ?? candidate.sequence) === assessment.dayNumber,
  );
  const run = mission ? missionRuns[mission.id] : undefined;
  const block = run?.blockResults[assessment.blockIndex];
  if (!block) return { measuredValue: null, unit: null };

  if (block.kind === 'timer') {
    const values = block.sets
      .map((set) => recordedSetValue(set, set.actualDurationSeconds))
      .filter((value): value is number => value !== undefined && value >= 0);
    const measuredValue = assessmentValue(plan, values, assessment.targetUnit);
    return measuredValue !== undefined
      ? timerUnitValue(measuredValue, assessment.targetUnit)
      : { measuredValue: null, unit: null };
  }

  if (block.kind === 'counter') {
    const values = block.sets
      .map((set) => recordedSetValue(set, set.actualQuantity))
      .filter((value): value is number => value !== undefined && value >= 0);
    const measuredValue = assessmentValue(plan, values, assessment.targetUnit);
    return measuredValue !== undefined
      ? {
          measuredValue,
          unit: assessment.targetUnit ?? block.unitLabel ?? block.unit,
        }
      : { measuredValue: null, unit: null };
  }

  return { measuredValue: null, unit: null };
}

export function programTargetReached(
  target: GoalTarget,
  actual: ProgramAssessmentActual,
  baseline?: MetricPoint,
): boolean {
  if (target.value === null || actual.measuredValue === null) return false;
  const expectedUnit = canonicalMetricUnit(target.unit);
  const actualUnit = canonicalMetricUnit(actual.unit);
  if (!expectedUnit || expectedUnit !== actualUnit) return false;

  const baselineValue = baseline?.value;
  const baselineUnit = canonicalMetricUnit(baseline?.unit);
  const isDecreasing =
    Number.isFinite(baselineValue) &&
    baselineUnit === expectedUnit &&
    (baselineValue as number) > target.value;
  return isDecreasing
    ? actual.measuredValue <= target.value
    : actual.measuredValue >= target.value;
}
