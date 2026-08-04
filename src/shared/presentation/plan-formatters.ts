import type { Mission, PlanBaseline } from '@/domain/types';

export type MissionDurationFormat = {
  inAppRecordLabel?: 'записей' | 'отметок';
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
    return `${mission.execution.blocks.length} блоков · ${records} ${options.inAppRecordLabel ?? 'записей'} · ≈ ${mission.estimatedMinutes} мин`;
  }
  if (mission.execution?.kind === 'routine') {
    const sets = mission.execution.actions.reduce((total, action) => total + action.sets, 0);
    return `${mission.execution.actions.length} действий · ${sets} подходов · ≈ ${mission.estimatedMinutes} мин`;
  }
  if (mission.execution?.kind === 'timer') {
    const seconds = mission.execution.durationSeconds;
    const timer = seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} мин` : `${seconds} сек`;
    return `${timer} таймер · ≈ ${mission.estimatedMinutes} мин всего`;
  }
  return `${options.approximateFallback ? '≈ ' : ''}${mission.estimatedMinutes} мин`;
}

export function formatBaselineMetric(baseline: PlanBaseline): string {
  if (baseline.value == null || baseline.unit == null) {
    return `${baseline.normalizedMetric} · числовое значение не выделено`;
  }
  const value = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 }).format(
    baseline.value,
  );
  return `${baseline.normalizedMetric} · ${value} ${baseline.unit}`;
}

export function formatSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return 'источник сохранён в плане';
  }
}
