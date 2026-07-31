import { z } from 'zod';

import type { GeneratedGoal, GoalInput, Mission, QuestChapter } from '@/domain/types';

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

const executionSchema = z
  .object({
    kind: z.enum(['manual', 'timer']),
    durationSeconds: z.number().int().min(1).max(7200).nullable(),
  })
  .superRefine((execution, context) => {
    if (execution.kind === 'timer' && execution.durationSeconds == null) {
      context.addIssue({
        code: 'custom',
        message: 'Timer execution requires durationSeconds.',
        path: ['durationSeconds'],
      });
    }
  });

const aiPlanSchema = z.object({
  title: contractText(3, 120),
  domain: z.enum(['read', 'learn', 'practice', 'organize', 'move', 'habit']),
  targetMetric: contractText(3, 180),
  summary: contractText(10, 500),
  safetyNotes: z.array(contractText(3, 300)).max(4),
  assumptions: z.array(contractText(3, 300)).min(1).max(5),
  // Keep this limit aligned with PLAN_SCHEMA in scripts/ai/contracts/plan-v1.mjs.
  sourceLabels: z.array(contractText(2, 160)).min(1).max(6),
  chapters: z
    .array(
      z.object({
        title: contractText(2, 100),
        subtitle: contractText(2, 160),
        missions: z
          .array(
            z.object({
              title: contractText(2, 120),
              description: contractText(5, 500),
              type: missionType,
              estimatedMinutes: z.number().int().min(1).max(120),
              xp: z.number().int().min(10).max(60),
              steps: z.array(contractText(2, 260)).min(1).max(6),
              execution: executionSchema,
              warning: contractText(3, 300).nullable(),
            }),
          )
          .min(2)
          .max(3),
      }),
    )
    .length(3),
});

const serverMetaSchema = z.object({
  requestId: z.string().min(4).max(120),
  providerResponseId: z.string().min(4).max(180).optional(),
  researchResponseId: z.string().min(4).max(180).optional(),
  model: z.string().min(2).max(100),
  promptVersion: z.string().min(2).max(120),
  contractVersion: z.string().min(2).max(120),
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
});

const serverResponseSchema = z.object({ plan: aiPlanSchema, meta: serverMetaSchema });

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

export async function generateGoalWithAI(input: GoalInput): Promise<GeneratedGoal> {
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

    const parsed = serverResponseSchema.safeParse(raw);
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

function mapServerErrorCode(raw: unknown, status: number): AIPlannerErrorCode {
  const code =
    raw && typeof raw === 'object' && 'code' in raw && typeof raw.code === 'string'
      ? raw.code
      : undefined;
  if (code === 'refusal' || status === 422) return 'REFUSAL';
  if (code === 'upstream_timeout' || status === 504) return 'UPSTREAM_TIMEOUT';
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
  planDraft: z.infer<typeof aiPlanSchema>,
  meta: z.infer<typeof serverMetaSchema>,
): GeneratedGoal {
  const now = new Date();
  const id = createIdFactory();
  const chapterIds = planDraft.chapters.map(() => id('chapter'));
  const chapters: QuestChapter[] = planDraft.chapters.map((chapter, index) => ({
    id: chapterIds[index],
    title: chapter.title,
    subtitle: chapter.subtitle,
    order: index + 1,
  }));
  let missionSequence = 0;
  const missions: Mission[] = planDraft.chapters.flatMap((chapter, chapterIndex) =>
    chapter.missions.map((mission) => ({
      id: id('mission'),
      chapterId: chapterIds[chapterIndex],
      sequence: ++missionSequence,
      title: mission.title,
      description: mission.description,
      type: mission.type,
      estimatedMinutes: Math.min(input.dailyMinutes, mission.estimatedMinutes),
      xp: mission.xp,
      outcome: 'pending',
      steps: mission.steps,
      execution:
        mission.execution.kind === 'timer' && mission.execution.durationSeconds != null
          ? { kind: 'timer' as const, durationSeconds: mission.execution.durationSeconds }
          : { kind: 'manual' as const },
      warning: mission.warning ?? undefined,
    })),
  );
  const targetDate = new Date(now.getTime() + input.horizonDays * 86_400_000);

  const goalId = id('goal');
  return {
    goal: {
      id: goalId,
      rawPrompt: input.prompt.trim(),
      title: planDraft.title,
      domain: planDraft.domain,
      targetDate: targetDate.toISOString(),
      targetMetric: planDraft.targetMetric,
      status: 'active',
      createdAt: now.toISOString(),
    },
    plan: {
      id: id('plan'),
      version: 1,
      createdAt: now.toISOString(),
      dailyMinutes: input.dailyMinutes,
      horizonDays: input.horizonDays,
      summary: planDraft.summary,
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
