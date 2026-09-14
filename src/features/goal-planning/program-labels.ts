import type { GoalDuration } from '@/domain/types';

export const RETRY_LIMIT_QUESTION = 'What if one month is not enough?';

export const RETRY_LIMIT_HELP =
  'Your first progress check is in 30 days. AI estimates the earliest realistic month to reach your goal; this choice only limits how long you can continue and does not stretch out the plan.';

export const RETRY_LIMIT_OPTIONS = Object.freeze([
  { value: 'month', label: 'Stop after one month' },
  { value: 'half-year', label: 'Continue for up to 6 months' },
  { value: 'year', label: 'Continue for up to a year' },
] satisfies ReadonlyArray<Readonly<{ value: GoalDuration; label: string }>>);

const RETRY_LIMIT_LABELS: Record<GoalDuration, string> = {
  month: '1 month',
  'half-year': 'up to 6 months',
  year: 'up to a year',
};

/** User-facing label for the maximum number of monthly attempts. */
export function retryLimitLabel(duration: GoalDuration): string {
  return RETRY_LIMIT_LABELS[duration];
}

export function estimatedTargetCycleLabel(cycleNumber: number | undefined): string | undefined {
  if (!Number.isInteger(cycleNumber) || (cycleNumber ?? 0) < 1) return undefined;
  return `Month ${cycleNumber}`;
}
