import type { GeneratedGoal, GoalInput, Mission, QuestChapter } from '@/domain/types';
import {
  GOAL_DURATION_CONFIG,
  goalDurationEndDate,
  goalDurationLabel,
} from '@/domain/goal-program';

import type { PlanDto, PlanMetaDto } from './api-contract';

export type GoalPlanningClock = () => Date;
export type GoalPlanningIdGenerator = (prefix: string) => string;
export type GoalPlanningIdFactory = () => GoalPlanningIdGenerator;

export type GeneratedGoalMapperDependencies = Readonly<{
  clock: GoalPlanningClock;
  idFactory: GoalPlanningIdFactory;
}>;

function createProductionIdGenerator(): GoalPlanningIdGenerator {
  const stamp = Date.now().toString(36);
  let sequence = 0;
  return (prefix) => `${prefix}-${stamp}-${++sequence}`;
}

export const productionGeneratedGoalMapperDependencies: GeneratedGoalMapperDependencies = {
  clock: () => new Date(),
  idFactory: createProductionIdGenerator,
};

/**
 * Convert the validated API DTO into the persisted domain model.
 * Supplying a clock and ID factory makes the conversion deterministic and side-effect free.
 */
export function mapPlanDtoToGeneratedGoal(
  input: GoalInput,
  planDraft: PlanDto,
  meta: PlanMetaDto,
  dependencies: GeneratedGoalMapperDependencies = productionGeneratedGoalMapperDependencies,
): GeneratedGoal {
  const now = dependencies.clock();
  const id = dependencies.idFactory();
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
  const durationConfig = GOAL_DURATION_CONFIG[input.duration];
  const createdAt = now.toISOString();
  const targetDate = goalDurationEndDate(createdAt, input.duration) ?? createdAt;
  const targetTimeline = goalDurationLabel(input.duration);
  const goalId = id('goal');
  const completedCycles = input.programContext?.completedCycles ?? [];
  const programTarget = input.programContext?.target ?? planDraft.target;

  return {
    goal: {
      id: goalId,
      rawPrompt: input.prompt.trim(),
      title: planDraft.title,
      domain: planDraft.domain,
      targetDate,
      targetMetric: planDraft.targetMetric,
      baseline: planDraft.baseline,
      targetTimeline,
      program: {
        duration: input.duration,
        totalDays: durationConfig.totalDays,
        totalCycles: durationConfig.totalCycles,
        activeCycle: planDraft.cycleNumber,
        target: programTarget,
        roadmap: planDraft.roadmap,
        completedCycles,
      },
      status: 'active',
      createdAt,
    },
    plan: {
      id: id('plan'),
      version: 6,
      createdAt: now.toISOString(),
      dailyMinutes: input.dailyMinutes,
      horizonDays: 30,
      cycleNumber: planDraft.cycleNumber,
      totalCycles: planDraft.totalCycles,
      cycleGoal: planDraft.cycleGoal,
      assessment: planDraft.assessment,
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

function addLocalCalendarDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toLocalDateKey(date: Date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
