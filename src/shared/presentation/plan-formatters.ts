import type { Mission, PlanBaseline } from '@/domain/types';

export type MissionDurationFormat = {
  inAppRecordLabel?: 'records' | 'check-ins';
  approximateFallback?: boolean;
};

export function formatMissionDuration(
  mission: Mission,
  options: MissionDurationFormat = {},
): string {
  if (mission.execution?.kind === 'in_app') {
    const records = mission.execution.blocks.reduce(
      (total, block) =>
        total + (block.kind === 'timer' || block.kind === 'counter' ? block.sets : 1),
      0,
    );
    const blockCount = mission.execution.blocks.length;
    const recordLabel = options.inAppRecordLabel ?? 'records';
    return `${blockCount} ${blockCount === 1 ? 'block' : 'blocks'} · ${records} ${records === 1 ? recordLabel.slice(0, -1) : recordLabel} · ≈ ${mission.estimatedMinutes} min`;
  }
  if (mission.execution?.kind === 'routine') {
    const sets = mission.execution.actions.reduce((total, action) => total + action.sets, 0);
    const actionCount = mission.execution.actions.length;
    return `${actionCount} ${actionCount === 1 ? 'action' : 'actions'} · ${sets} ${sets === 1 ? 'set' : 'sets'} · ≈ ${mission.estimatedMinutes} min`;
  }
  if (mission.execution?.kind === 'timer') {
    const seconds = mission.execution.durationSeconds;
    const timer = seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`;
    return `${timer} timer · ≈ ${mission.estimatedMinutes} min total`;
  }
  return `${options.approximateFallback ? '≈ ' : ''}${mission.estimatedMinutes} min`;
}

export function formatBaselineMetric(baseline: PlanBaseline): string {
  if (baseline.value == null || baseline.unit == null) {
    return `${baseline.normalizedMetric} · no numeric value identified`;
  }
  const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(
    baseline.value,
  );
  return `${baseline.normalizedMetric} · ${value} ${baseline.unit}`;
}

export function formatMetricValue(
  value: number | null | undefined,
  unit: string | null | undefined,
): string | undefined {
  if (value == null || !unit) return undefined;
  if (unit === 'seconds') {
    const rounded = Math.max(0, Math.round(value));
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    if (!minutes) return `${seconds} sec`;
    if (!seconds) return `${minutes} min`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  const labels: Record<string, string> = {
    reps: 'reps',
    pages: 'pages',
    items: 'items',
    words: 'words',
    meters: 'm',
    attempts: 'attempts',
  };
  const label = labels[unit] ?? unit;
  return `${formatted} ${value === 1 && labels[unit] && label.endsWith('s') ? label.slice(0, -1) : label}`;
}

export function formatSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return 'source saved in plan';
  }
}
