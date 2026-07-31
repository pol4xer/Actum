import { z } from 'zod';

import type { GeneratedGoal, GoalInput, Mission, QuestChapter } from '@/domain/types';

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
  title: z.string().trim().min(3).max(120),
  domain: z.enum(['read', 'learn', 'practice', 'organize', 'move', 'habit']),
  targetMetric: z.string().trim().min(3).max(180),
  summary: z.string().trim().min(10).max(500),
  safetyNotes: z.array(z.string().trim().min(3).max(300)).max(4),
  assumptions: z.array(z.string().trim().min(3).max(300)).min(1).max(5),
  sourceLabels: z.array(z.string().trim().min(2).max(160)).min(1).max(5),
  chapters: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(100),
        subtitle: z.string().trim().min(2).max(160),
        missions: z
          .array(
            z.object({
              title: z.string().trim().min(2).max(120),
              description: z.string().trim().min(5).max(500),
              type: missionType,
              estimatedMinutes: z.number().int().min(1).max(120),
              xp: z.number().int().min(10).max(60),
              steps: z.array(z.string().trim().min(2).max(260)).min(1).max(6),
              execution: executionSchema,
              warning: z.string().trim().min(3).max(300).nullable(),
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

export class AIPlannerError extends Error {
  constructor(
    message: string,
    readonly code: 'UNAVAILABLE' | 'INVALID_RESPONSE',
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
  const timeout = setTimeout(
    () => controller.abort(),
    input.researchMode === 'quick' ? 120_000 : 360_000,
  );
  const baseUrl = (process.env.EXPO_PUBLIC_ACTUM_AI_URL || DEFAULT_AI_URL).replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const raw: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : 'AI-сервер не смог собрать план.';
      const requestId =
        raw && typeof raw === 'object' && 'requestId' in raw && typeof raw.requestId === 'string'
          ? raw.requestId
          : undefined;
      throw new AIPlannerError(
        requestId ? `${message}\nЗапрос: ${requestId}` : message,
        'UNAVAILABLE',
      );
    }

    const parsed = serverResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AIPlannerError('GPT вернул план в неожиданном формате.', 'INVALID_RESPONSE');
    }

    return toGeneratedGoal(input, parsed.data.plan, parsed.data.meta);
  } catch (error) {
    if (error instanceof AIPlannerError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AIPlannerError('GPT отвечает слишком долго. Попробуй ещё раз.', 'UNAVAILABLE');
    }
    throw new AIPlannerError(
      'Не удалось связаться с локальным AI-сервером. Запусти `pnpm ai:server`.',
      'UNAVAILABLE',
    );
  } finally {
    clearTimeout(timeout);
  }
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
