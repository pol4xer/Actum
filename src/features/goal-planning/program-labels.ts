import type { GoalDuration } from '@/domain/types';

export const RETRY_LIMIT_QUESTION = 'Если за месяц не получится?';

export const RETRY_LIMIT_HELP =
  'Первый контрольный замер — через 30 дней. AI выбирает самый ранний обоснованный месяц достижения; этот выбор лишь задаёт предел продолжения и не растягивает план.';

export const RETRY_LIMIT_OPTIONS = Object.freeze([
  { value: 'month', label: 'Остановиться после месяца' },
  { value: 'half-year', label: 'Продолжать до 6 месяцев' },
  { value: 'year', label: 'Продолжать до года' },
] satisfies ReadonlyArray<Readonly<{ value: GoalDuration; label: string }>>);

const RETRY_LIMIT_LABELS: Record<GoalDuration, string> = {
  month: '1 месяц',
  'half-year': 'до 6 месяцев',
  year: 'до года',
};

/** User-facing label for the maximum number of monthly attempts. */
export function retryLimitLabel(duration: GoalDuration): string {
  return RETRY_LIMIT_LABELS[duration];
}

export function estimatedTargetCycleLabel(cycleNumber: number | undefined): string | undefined {
  if (!Number.isInteger(cycleNumber) || (cycleNumber ?? 0) < 1) return undefined;
  return `Месяц ${cycleNumber}`;
}
