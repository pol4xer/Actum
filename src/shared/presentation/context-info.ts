import type {
  CounterExecutionBlock,
  Mission,
  MissionExecutionBlock,
  PlanBaseline,
  PlanVersion,
  RoutineLoadBasis,
} from '@/domain/types';

import { formatBaselineMetric } from './plan-formatters';
import {
  containsExecutionSafetyCopy,
  withoutExecutionSafetyCopy,
} from './execution-visibility';

export type ContextInfoTone = 'default' | 'warning';

export type ContextInfoSection = Readonly<{
  heading?: string;
  body: string;
  tone?: ContextInfoTone;
}>;

export type PlanContextFallbacks = Readonly<{
  baseline?: PlanBaseline;
  targetTimeline?: string;
}>;

/**
 * Return explanatory mission copy that can safely move behind an info affordance.
 *
 * A plan-v5 in-app description summarizes the day; legacy descriptions can be the
 * actual instruction, so they deliberately remain outside this presentation helper.
 */
export function missionContextSections(mission: Mission): ContextInfoSection[] {
  const sections: ContextInfoSection[] = [];
  const inAppExecution = mission.execution?.kind === 'in_app' ? mission.execution : undefined;

  if (inAppExecution) {
    appendSection(sections, 'О дне', withoutExecutionSafetyCopy(mission.description));

    // execution.successCriterion is the source of truth for an in-app day. The
    // persisted completionCriterion is retained as a fallback for older records.
    appendSection(
      sections,
      'Критерий дня',
      withoutExecutionSafetyCopy(
        firstNonEmpty(inAppExecution.successCriterion, mission.completionCriterion),
      ),
    );
  }

  return sections;
}

/**
 * Explain where a ready-to-use block load came from without moving its instruction,
 * prescribed dose, tempo, or success criterion out of the executable interface.
 */
export function executionBlockContextSections(
  block: MissionExecutionBlock,
): ContextInfoSection[] {
  if ((block.kind !== 'timer' && block.kind !== 'counter') || !block.loadBasis) return [];

  return [
    {
      heading: 'Расчёт нагрузки',
      body: formatLoadProvenance(block.loadBasis, targetUnit(block)),
    },
  ];
}

/** Return non-executable plan rationale and generation provenance for presentation. */
export function planContextSections(
  plan: PlanVersion,
  fallbacks: PlanContextFallbacks = {},
): ContextInfoSection[] {
  const sections: ContextInfoSection[] = [];
  const baseline = plan.baseline ?? fallbacks.baseline;
  const targetTimeline = firstNonEmpty(plan.targetTimeline, fallbacks.targetTimeline);

  appendSection(
    sections,
    'Версия и метод',
    joinLines([
      `План v${plan.version}`,
      `Метод: ${researchMethodLabel(plan.research.method)}`,
      `Уверенность: ${plan.research.confidence === 'high' ? 'высокая' : 'средняя'}`,
    ]),
  );

  appendSection(sections, 'Логика плана', withoutExecutionSafetyCopy(plan.summary));

  if (baseline) {
    appendSection(
      sections,
      'Исходная точка и расчёт',
      joinLines([
        baseline.userStatement,
        formatBaselineMetric(baseline),
        baseline.calculationRule,
      ]),
    );
  }

  appendSection(sections, 'Срок большой цели', targetTimeline);
  appendListSection(
    sections,
    'Допущения',
    plan.research.assumptions.filter((value) => !containsExecutionSafetyCopy(value)),
  );
  appendListSection(
    sections,
    'Основа методики',
    plan.research.sourceLabels.filter((value) => !containsExecutionSafetyCopy(value)),
  );

  const sources = plan.research.sources
    ?.filter((source) => !containsExecutionSafetyCopy(source.title))
    .map((source) => joinLines([source.title, source.url]));
  appendListSection(sections, 'Источники', sources);

  if (plan.research.request) {
    const request = plan.research.request;
    appendSection(
      sections,
      'Метаданные генерации',
      joinLines([
        `Модель: ${request.model}`,
        `Версия промпта: ${request.promptVersion}`,
        `ID запроса: ${request.requestId}`,
        request.providerResponseId ? `ID ответа провайдера: ${request.providerResponseId}` : undefined,
        `Длительность: ${formatNumber(request.durationMs)} мс`,
        `Web-поисков: ${formatNumber(request.webSearchCount)}`,
        request.inputTokens === undefined
          ? undefined
          : `Входных токенов: ${formatNumber(request.inputTokens)}`,
        request.outputTokens === undefined
          ? undefined
          : `Выходных токенов: ${formatNumber(request.outputTokens)}`,
      ]),
    );
  }

  return sections;
}

function researchMethodLabel(method: PlanVersion['research']['method']) {
  if (method === 'openai-web-research-v1') return 'Web research · Responses API';
  if (method === 'openai-responses-v1') return 'GPT · Responses API';
  return 'Локальный план';
}

function appendSection(
  sections: ContextInfoSection[],
  heading: string | undefined,
  body: string | undefined,
  tone?: ContextInfoTone,
) {
  const normalizedBody = body?.trim();
  if (!normalizedBody) return;

  const normalizedHeading = heading?.trim();
  sections.push({
    ...(normalizedHeading ? { heading: normalizedHeading } : {}),
    body: normalizedBody,
    ...(tone && tone !== 'default' ? { tone } : {}),
  });
}

function appendListSection(
  sections: ContextInfoSection[],
  heading: string,
  values: readonly (string | undefined)[] | undefined,
  tone?: ContextInfoTone,
) {
  const items = values?.map((value) => value?.trim()).filter(isNonEmptyString) ?? [];
  if (!items.length) return;
  appendSection(
    sections,
    heading,
    items.map((item) => `• ${item}`).join('\n'),
    tone,
  );
}

function formatLoadProvenance(basis: RoutineLoadBasis, unit: string) {
  return `${formatNumber(basis.percentage)}% × ${formatNumber(basis.baseValue)} ${displayUnit(basis.baseUnit)} = ${formatNumber(basis.result)} ${unit}`;
}

function targetUnit(block: Extract<MissionExecutionBlock, { kind: 'timer' | 'counter' }>) {
  return block.kind === 'timer' ? 'сек' : counterUnitLabel(block);
}

function counterUnitLabel(block: CounterExecutionBlock) {
  if (block.unit === 'custom') return block.unitLabel?.trim() || 'ед.';
  return {
    reps: 'повт.',
    pages: 'стр.',
    items: 'элем.',
    words: 'слов',
    meters: 'м',
    attempts: 'попыток',
  }[block.unit];
}

function displayUnit(unit: string) {
  const normalized = unit.trim();
  const labels: Record<string, string> = {
    seconds: 'сек',
    minutes: 'мин',
    reps: 'повт.',
    pages: 'стр.',
    items: 'элем.',
    words: 'слов',
    meters: 'м',
    attempts: 'попыток',
  };
  return labels[normalized] ?? normalized;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4))).replace('.', ',');
}

function joinLines(values: readonly (string | undefined)[]) {
  return values.map((value) => value?.trim()).filter(isNonEmptyString).join('\n');
}

function firstNonEmpty(...values: readonly (string | undefined)[]) {
  return values.map((value) => value?.trim()).find(isNonEmptyString);
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value);
}
