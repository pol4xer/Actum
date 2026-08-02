import { z } from 'zod';

import type { GeneratedGoal, GoalInput, Mission, QuestChapter } from '@/domain/types';
import { addLocalCalendarDays, toLocalDateKey } from '@/lib/calendar-date';

function contractText(minLength: number, maxLength: number) {
  return z
    .string()
    .transform((value) => value.trim())
    .superRefine((value, context) => {
      const length = Array.from(value).length;
      if (length < minLength) {
        context.addIssue({ code: 'custom', message: `Expected at least ${minLength} characters.` });
      }
      if (length > maxLength) {
        context.addIssue({ code: 'custom', message: `Expected at most ${maxLength} characters.` });
      }
    });
}

const missionType = z.enum([
  'learn',
  'read',
  'practice',
  'prepare',
  'recover',
  'organize',
  'move',
  'reflect',
  'submit',
  'check',
]);

const counterUnit = z.enum([
  'reps',
  'pages',
  'items',
  'words',
  'meters',
  'attempts',
  'custom',
]);
const discreteCounterUnits = new Set(['reps', 'pages', 'items', 'words', 'attempts']);

const routineLoadBasisSchema = z
  .object({
    percentage: z.number().min(0.01).max(1000),
    baseValue: z.number().min(0).max(1_000_000_000),
    baseUnit: contractText(1, 40),
    result: z.number().min(0).max(1_000_000),
  })
  .strict();

const timerBlockSchema = z
  .object({
    kind: z.literal('timer'),
    title: contractText(2, 100),
    instruction: contractText(8, 360),
    sets: z.number().int().min(1).max(20),
    durationSecondsPerSet: z.number().int().min(1).max(7200),
    loadBasis: routineLoadBasisSchema.nullable(),
    restSeconds: z.number().int().min(0).max(1800),
    successCriterion: contractText(5, 260),
  })
  .strict();

const counterBlockSchema = z
  .object({
    kind: z.literal('counter'),
    title: contractText(2, 100),
    instruction: contractText(8, 360),
    sets: z.number().int().min(1).max(20),
    targetPerSet: z.number().min(0.01).max(1_000_000),
    unit: counterUnit,
    unitLabel: contractText(1, 40).nullable(),
    workSecondsPerSet: z.number().int().min(1).max(7200),
    restSeconds: z.number().int().min(0).max(1800),
    tempo: contractText(2, 100).nullable(),
    loadBasis: routineLoadBasisSchema.nullable(),
    successCriterion: contractText(5, 260),
  })
  .strict()
  .superRefine((action, context) => {
    if (discreteCounterUnits.has(action.unit) && !Number.isInteger(action.targetPerSet)) {
      context.addIssue({
        code: 'custom',
        message: `Discrete unit ${action.unit} requires an integer quantity.`,
        path: ['targetPerSet'],
      });
    }
    if (action.unit === 'custom' && action.unitLabel == null) {
      context.addIssue({
        code: 'custom',
        message: 'Custom routine units require unitLabel.',
        path: ['unitLabel'],
      });
    }
    if (action.unit !== 'custom' && action.unitLabel != null) {
      context.addIssue({
        code: 'custom',
        message: 'unitLabel is only allowed for custom routine units.',
        path: ['unitLabel'],
      });
    }
  });

const checklistBlockSchema = z
  .object({
    kind: z.literal('checklist'),
    title: contractText(2, 100),
    items: z.array(contractText(2, 260)).min(1).max(8),
    estimatedSeconds: z.number().int().min(1).max(7200),
    successCriterion: contractText(5, 260),
  })
  .strict();

const textLogBlockSchema = z
  .object({
    kind: z.literal('text_log'),
    title: contractText(2, 100),
    prompt: contractText(5, 360),
    minCharacters: z.number().int().min(1).max(2_000),
    maxCharacters: z.number().int().min(1).max(4_000),
    estimatedSeconds: z.number().int().min(1).max(7200),
    successCriterion: contractText(5, 260),
  })
  .strict()
  .superRefine((block, context) => {
    if (block.maxCharacters < block.minCharacters) {
      context.addIssue({
        code: 'custom',
        message: 'maxCharacters must be greater than or equal to minCharacters.',
        path: ['maxCharacters'],
      });
    }
  });

function createExecutionSchema(maximumTimerSeconds: number) {
  const timer = timerBlockSchema.refine(
    (block) => block.durationSecondsPerSet <= maximumTimerSeconds,
    { message: 'Timer block exceeds the daily limit.', path: ['durationSecondsPerSet'] },
  );
  const counter = counterBlockSchema.refine(
    (block) =>
      block.workSecondsPerSet <= maximumTimerSeconds &&
      block.restSeconds <= maximumTimerSeconds,
    { message: 'Counter block exceeds the daily limit.' },
  );
  const checklist = checklistBlockSchema.refine(
    (block) => block.estimatedSeconds <= maximumTimerSeconds,
    { message: 'Checklist block exceeds the daily limit.', path: ['estimatedSeconds'] },
  );
  const textLog = textLogBlockSchema.refine(
    (block) => block.estimatedSeconds <= maximumTimerSeconds,
    { message: 'Text log block exceeds the daily limit.', path: ['estimatedSeconds'] },
  );

  return z
    .object({
      kind: z.literal('in_app'),
      blocks: z.array(z.union([timer, counter, checklist, textLog])).min(1).max(12),
      successCriterion: contractText(5, 320),
    })
    .strict();
}

function createAIPlanSchema(dailyMinutes: number, horizonDays: number) {
  const maximumMinutes = Math.max(1, Math.min(120, Math.round(dailyMinutes)));
  const calendarDays = Math.max(1, Math.min(30, Math.round(horizonDays)));
  const daySchema = z
    .object({
      dayNumber: z.number().int().min(1).max(calendarDays),
      phaseIndex: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      title: contractText(2, 120),
      description: contractText(5, 560),
      type: missionType,
      estimatedMinutes: z.number().int().min(1).max(maximumMinutes),
      xp: z.number().int().min(5).max(60),
      execution: createExecutionSchema(maximumMinutes * 60),
      warning: contractText(3, 300).nullable(),
    })
    .strict();

  return z
    .object({
      title: contractText(3, 120),
      domain: z.enum(['read', 'learn', 'practice', 'organize', 'move', 'habit']),
      targetMetric: contractText(3, 220),
      targetTimeline: contractText(2, 80),
      summary: contractText(10, 600),
      baseline: z
        .object({
          userStatement: contractText(2, 500),
          normalizedMetric: contractText(2, 180),
          value: z.number().min(0).nullable(),
          unit: contractText(1, 40).nullable(),
          calculationRule: contractText(8, 360),
        })
        .strict(),
      safetyNotes: z.array(contractText(3, 300)).max(4),
      assumptions: z.array(contractText(3, 300)).min(1).max(6),
      sourceLabels: z.array(contractText(2, 180)).min(1).max(8),
      phases: z
        .array(
          z
            .object({
              title: contractText(2, 100),
              subtitle: contractText(2, 180),
              startDay: z.number().int().min(1).max(calendarDays),
              endDay: z.number().int().min(1).max(calendarDays),
            })
            .strict(),
        )
        .length(3),
      days: z.array(daySchema).length(calendarDays),
    })
    .strict();
}

type AIPlanDraft = z.infer<ReturnType<typeof createAIPlanSchema>>;

const serverMetaSchema = z.object({
  requestId: z.string().min(4).max(120),
  providerResponseId: z.string().min(4).max(180).optional(),
  researchResponseId: z.string().min(4).max(180).optional(),
  model: z.string().min(2).max(100),
  promptVersion: z.string().min(2).max(120),
  contractVersion: z.literal('plan-v5'),
  durationMs: z.number().int().nonnegative(),
  webSearchCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  sources: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        url: z.string().url().max(2000),
      }),
    )
    .max(8),
}).strict();

const recoveredInputSchema = z
  .object({
    prompt: z.string().min(5).max(1000),
    currentLevel: z.enum(['starting', 'some-experience', 'returning']),
    baseline: z.string().min(2).max(500),
    targetTimeline: z.string().min(2).max(80),
    dailyMinutes: z.union([
      z.literal(10),
      z.literal(20),
      z.literal(30),
      z.literal(45),
      z.literal(60),
    ]),
    horizonDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
    researchMode: z.enum(['quick', 'web']).optional(),
  })
  .strict();

const recoveredPlanEnvelopeSchema = z
  .object({
    input: recoveredInputSchema,
    plan: z.unknown(),
    meta: serverMetaSchema,
  })
  .strict();

function createServerResponseSchema(input: GoalInput) {
  return z
    .object({
      plan: createAIPlanSchema(input.dailyMinutes, input.horizonDays),
      meta: serverMetaSchema,
    })
    .strict();
}

const DEFAULT_AI_URL = 'http://127.0.0.1:8787';
const QUICK_CLIENT_TIMEOUT_MS = 14 * 60_000;
const WEB_CLIENT_TIMEOUT_MS = 26 * 60_000;

export type AIPlannerErrorCode =
  | 'TIMEOUT'
  | 'GATEWAY_UNREACHABLE'
  | 'CONNECTION_INTERRUPTED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'REFUSAL'
  | 'INVALID_REQUEST'
  | 'SAVED_RESPONSE_UNAVAILABLE'
  | 'INVALID_RESPONSE';

export class AIPlannerError extends Error {
  constructor(
    message: string,
    readonly code: AIPlannerErrorCode,
  ) {
    super(message);
    this.name = 'AIPlannerError';
  }
}

function createIdFactory() {
  const stamp = Date.now().toString(36);
  let sequence = 0;
  return (prefix: string) => `${prefix}-${stamp}-${++sequence}`;
}

export async function generateGoalWithAI(
  input: GoalInput,
  options: { reuseOnly?: boolean } = {},
): Promise<GeneratedGoal> {
  const controller = new AbortController();
  const requestId = createClientRequestId();
  const timeoutMs =
    input.researchMode === 'quick' ? QUICK_CLIENT_TIMEOUT_MS : WEB_CLIENT_TIMEOUT_MS;
  let timeoutTriggered = false;
  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort();
  }, timeoutMs);
  const baseUrl = (process.env.EXPO_PUBLIC_ACTUM_AI_URL || DEFAULT_AI_URL).replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Actum-Request-Id': requestId,
        ...(options.reuseOnly ? { 'X-Actum-Reuse-Only': 'true' } : {}),
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const raw: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : 'AI-сервер не смог собрать план.';
      const serverRequestId =
        raw && typeof raw === 'object' && 'requestId' in raw && typeof raw.requestId === 'string'
          ? raw.requestId
          : undefined;
      throw new AIPlannerError(
        `${message}\nЗапрос: ${serverRequestId || requestId}`,
        mapServerErrorCode(raw, response.status),
      );
    }

    const parsed = createServerResponseSchema(input).safeParse(raw);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'response';
      const responseRequestId = readResponseRequestId(raw) || requestId;
      console.log(
        `[actum-ai] incompatible response request=${responseRequestId} field=${issuePath} issue=${firstIssue?.code || 'unknown'}`,
      );
      throw new AIPlannerError(
        `План создан, но приложение не смогло прочитать поле «${issuePath}».\nЗапрос: ${responseRequestId}`,
        'INVALID_RESPONSE',
      );
    }

    return toGeneratedGoal(input, parsed.data.plan, parsed.data.meta);
  } catch (error) {
    if (error instanceof AIPlannerError) throw error;
    if (timeoutTriggered || controller.signal.aborted) {
      throw new AIPlannerError(
        `Генерация превысила время ожидания приложения. Сервер может продолжать работу; повтор с теми же параметрами присоединится к ней или возьмёт результат из кэша.\nЗапрос: ${requestId}`,
        'TIMEOUT',
      );
    }

    const gatewayReachable = await probeGateway(baseUrl);
    throw new AIPlannerError(
      gatewayReachable
        ? `Связь с AI-сервером оборвалась, но сам сервер доступен. Проверь окно «Actum - AI server» и повтори: уже выполненная работа будет переиспользована.\nЗапрос: ${requestId}`
        : `AI-сервер недоступен по адресу ${baseUrl}. Запусти проект через \`./scripts/dev-ios.sh\` и проверь окно «Actum - AI server».\nЗапрос: ${requestId}`,
      gatewayReachable ? 'CONNECTION_INTERRUPTED' : 'GATEWAY_UNREACHABLE',
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function recoverLatestSavedGoal(): Promise<GeneratedGoal | undefined> {
  const baseUrl = (process.env.EXPO_PUBLIC_ACTUM_AI_URL || DEFAULT_AI_URL).replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}/saved-plan/latest`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error('Локальный AI-сервер не вернул сохранённый план.');

    const raw: unknown = await response.json();
    const envelope = recoveredPlanEnvelopeSchema.safeParse(raw);
    if (!envelope.success) throw new Error('Сохранённый план имеет несовместимый формат.');
    const { input, plan, meta } = envelope.data;
    const parsed = createServerResponseSchema(input).safeParse({ plan, meta });
    if (!parsed.success) throw new Error('Сохранённый plan-v5 не прошёл клиентскую проверку.');
    return toGeneratedGoal(input, parsed.data.plan, parsed.data.meta);
  } finally {
    clearTimeout(timeout);
  }
}

function mapServerErrorCode(raw: unknown, status: number): AIPlannerErrorCode {
  const code =
    raw && typeof raw === 'object' && 'code' in raw && typeof raw.code === 'string'
      ? raw.code
      : undefined;
  if (code === 'refusal' || status === 422) return 'REFUSAL';
  if (code === 'saved_response_unavailable') return 'SAVED_RESPONSE_UNAVAILABLE';
  if (code === 'upstream_timeout' || status === 504) return 'UPSTREAM_TIMEOUT';
  if (
    code === 'upstream_invalid_plan_contract' ||
    code === 'upstream_invalid_plan_json' ||
    code === 'upstream_missing_plan' ||
    code === 'upstream_missing_research_brief' ||
    code === 'upstream_insufficient_research_searches' ||
    code === 'upstream_missing_research_sources'
  ) {
    return 'INVALID_RESPONSE';
  }
  if (status === 400) return 'INVALID_REQUEST';
  return 'UPSTREAM_ERROR';
}

async function probeGateway(baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function createClientRequestId() {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `actum_${stamp}_${random}`;
}

function readResponseRequestId(raw: unknown) {
  if (!raw || typeof raw !== 'object' || !('meta' in raw)) return undefined;
  const meta = raw.meta;
  if (!meta || typeof meta !== 'object' || !('requestId' in meta)) return undefined;
  return typeof meta.requestId === 'string' ? meta.requestId : undefined;
}

function toGeneratedGoal(
  input: GoalInput,
  planDraft: AIPlanDraft,
  meta: z.infer<typeof serverMetaSchema>,
): GeneratedGoal {
  const now = new Date();
  const id = createIdFactory();
  const chapterIds = planDraft.phases.map(() => id('chapter'));
  const chapters: QuestChapter[] = planDraft.phases.map((phase, index) => ({
    id: chapterIds[index],
    title: phase.title,
    subtitle: phase.subtitle,
    order: index + 1,
    startDay: phase.startDay,
    endDay: phase.endDay,
  }));
  const missions: Mission[] = planDraft.days.map((day) => ({
    id: id('mission'),
    chapterId: chapterIds[day.phaseIndex - 1],
    sequence: day.dayNumber,
    dayNumber: day.dayNumber,
    scheduledDate: toLocalDateKey(addLocalCalendarDays(now, day.dayNumber - 1)),
    title: day.title,
    description: day.description,
    type: day.type,
    estimatedMinutes: day.estimatedMinutes,
    xp: day.xp,
    outcome: 'pending' as const,
    execution: {
      kind: 'in_app' as const,
      successCriterion: day.execution.successCriterion,
      blocks: day.execution.blocks.map((block) => {
        if (block.kind === 'timer') {
          return {
            kind: 'timer' as const,
            title: block.title,
            instruction: block.instruction,
            sets: block.sets,
            durationSecondsPerSet: block.durationSecondsPerSet,
            restSeconds: block.restSeconds,
            loadBasis: block.loadBasis ?? undefined,
            successCriterion: block.successCriterion,
          };
        }
        if (block.kind === 'counter') {
          return {
            kind: 'counter' as const,
            title: block.title,
            instruction: block.instruction,
            sets: block.sets,
            targetPerSet: block.targetPerSet,
            unit: block.unit,
            unitLabel: block.unitLabel ?? undefined,
            workSecondsPerSet: block.workSecondsPerSet,
            restSeconds: block.restSeconds,
            tempo: block.tempo ?? undefined,
            loadBasis: block.loadBasis ?? undefined,
            successCriterion: block.successCriterion,
          };
        }
        if (block.kind === 'checklist') {
          return {
            kind: 'checklist' as const,
            title: block.title,
            items: block.items,
            estimatedSeconds: block.estimatedSeconds,
            successCriterion: block.successCriterion,
          };
        }
        return {
          kind: 'text_log' as const,
          title: block.title,
          prompt: block.prompt,
          minCharacters: block.minCharacters,
          maxCharacters: block.maxCharacters,
          estimatedSeconds: block.estimatedSeconds,
          successCriterion: block.successCriterion,
        };
      }),
    },
    completionCriterion: day.execution.successCriterion,
    warning: day.warning ?? undefined,
  }));
  const targetDate = addLocalCalendarDays(now, input.horizonDays - 1);
  const targetTimeline = planDraft.targetTimeline;

  const goalId = id('goal');
  return {
    goal: {
      id: goalId,
      rawPrompt: input.prompt.trim(),
      title: planDraft.title,
      domain: planDraft.domain,
      targetDate: targetDate.toISOString(),
      targetMetric: planDraft.targetMetric,
      baseline: planDraft.baseline,
      targetTimeline,
      status: 'active',
      createdAt: now.toISOString(),
    },
    plan: {
      id: id('plan'),
      version: 5,
      createdAt: now.toISOString(),
      dailyMinutes: input.dailyMinutes,
      horizonDays: input.horizonDays,
      summary: planDraft.summary,
      baseline: planDraft.baseline,
      targetTimeline,
      chapters,
      missions,
      research: {
        method: meta.webSearchCount > 0 ? 'openai-web-research-v1' : 'openai-responses-v1',
        confidence: 'medium',
        safetyNotes: planDraft.safetyNotes,
        assumptions: planDraft.assumptions,
        sourceLabels: planDraft.sourceLabels,
        sources: meta.sources,
        request: {
          requestId: meta.requestId,
          providerResponseId: meta.providerResponseId,
          model: meta.model,
          promptVersion: meta.promptVersion,
          durationMs: meta.durationMs,
          webSearchCount: meta.webSearchCount,
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
        },
      },
    },
  };
}
