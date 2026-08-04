import { z } from 'zod';

import type { GoalInput } from '@/domain/types';

function contractText(minLength: number, maxLength: number) {
  return z.string().trim().min(minLength).max(maxLength);
}

const missionTypeSchema = z.enum([
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

const counterUnitSchema = z.enum([
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

function createExecutionSchema(maximumTimerSeconds: number) {
  const maximumRestSeconds = Math.min(1800, maximumTimerSeconds);
  const timer = z
    .object({
      kind: z.literal('timer'),
      title: contractText(2, 100),
      instruction: contractText(8, 360),
      sets: z.number().int().min(1).max(20),
      durationSecondsPerSet: z.number().int().min(1).max(maximumTimerSeconds),
      loadBasis: routineLoadBasisSchema.nullable(),
      restSeconds: z.number().int().min(0).max(maximumRestSeconds),
      successCriterion: contractText(5, 260),
    })
    .strict();
  const counter = z
    .object({
      kind: z.literal('counter'),
      title: contractText(2, 100),
      instruction: contractText(8, 360),
      sets: z.number().int().min(1).max(20),
      targetPerSet: z.number().min(0.01).max(1_000_000),
      unit: counterUnitSchema,
      unitLabel: contractText(1, 40).nullable(),
      workSecondsPerSet: z.number().int().min(1).max(maximumTimerSeconds),
      restSeconds: z.number().int().min(0).max(maximumRestSeconds),
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
  const checklist = z
    .object({
      kind: z.literal('checklist'),
      title: contractText(2, 100),
      items: z.array(contractText(2, 260)).min(1).max(8),
      estimatedSeconds: z.number().int().min(1).max(maximumTimerSeconds),
      successCriterion: contractText(5, 260),
    })
    .strict();
  const textLog = z
    .object({
      kind: z.literal('text_log'),
      title: contractText(2, 100),
      prompt: contractText(5, 360),
      minCharacters: z.number().int().min(1).max(2_000),
      maxCharacters: z.number().int().min(1).max(4_000),
      estimatedSeconds: z.number().int().min(1).max(maximumTimerSeconds),
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

  return z
    .object({
      kind: z.literal('in_app'),
      blocks: z.array(z.union([timer, counter, checklist, textLog])).min(1).max(12),
      successCriterion: contractText(5, 320),
    })
    .strict();
}

export function createPlanDtoSchema(dailyMinutes: number, horizonDays: number) {
  const maximumMinutes = Math.max(1, Math.min(120, Math.round(dailyMinutes)));
  const calendarDays = Math.max(1, Math.min(30, Math.round(horizonDays)));
  const daySchema = z
    .object({
      dayNumber: z.number().int().min(1).max(calendarDays),
      phaseIndex: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      title: contractText(2, 120),
      description: contractText(5, 560),
      type: missionTypeSchema,
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

export type PlanDto = z.infer<ReturnType<typeof createPlanDtoSchema>>;

export const planMetaDtoSchema = z
  .object({
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
  })
  .strict();

export type PlanMetaDto = z.infer<typeof planMetaDtoSchema>;

export function createPlanResponseDtoSchema(input: GoalInput) {
  return z
    .object({
      plan: createPlanDtoSchema(input.dailyMinutes, input.horizonDays),
      meta: planMetaDtoSchema,
    })
    .strict();
}

const recoveredInputDtoSchema = z
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

export const savedPlanEnvelopeDtoSchema = z
  .object({
    input: recoveredInputDtoSchema,
    plan: z.unknown(),
    meta: planMetaDtoSchema,
  })
  .strict();

export type SavedPlanEnvelopeDto = z.infer<typeof savedPlanEnvelopeDtoSchema>;
