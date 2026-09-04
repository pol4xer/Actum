import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  GeneratedGoal,
  GoalDuration,
  GoalInput,
  PlanVersion,
} from '@/domain/types';

import { AIPlannerError, type AIPlannerErrorCode } from './errors';
import { defaultGoalPlanner } from './http-goal-planner';
import type { GoalPlanner } from './goal-planner';

export type GoalBuilderStage = 'intent' | 'details' | 'generating' | 'review' | 'error';

export type UseGoalBuilderControllerOptions = Readonly<{
  onAcceptGoal(generated: GeneratedGoal): void;
  planner?: GoalPlanner;
  logger?: Pick<Console, 'log'>;
}>;

export function shouldReuseSavedResponseForRetry(errorCode?: AIPlannerErrorCode) {
  return errorCode === 'INVALID_RESPONSE';
}

export function recoveredCurrentLevel(plan: PlanVersion): GoalInput['currentLevel'] {
  return (
    plan.currentLevel ??
    (plan.baseline?.value != null ? 'some-experience' : 'starting')
  );
}

export function useGoalBuilderController({
  onAcceptGoal,
  planner = defaultGoalPlanner,
  logger = console,
}: UseGoalBuilderControllerOptions) {
  const [stage, setStage] = useState<GoalBuilderStage>('intent');
  const [prompt, setPrompt] = useState('');
  const [baseline, setBaseline] = useState('');
  const [duration, setDuration] = useState<GoalDuration>();
  const [dailyMinutes, setDailyMinutes] = useState(20);
  const [currentLevel, setCurrentLevel] =
    useState<GoalInput['currentLevel']>('starting');
  const [researchMode, setResearchMode] =
    useState<NonNullable<GoalInput['researchMode']>>('web');
  const [preview, setPreview] = useState<GeneratedGoal>();
  const [generationError, setGenerationError] = useState('');
  const [generationErrorCode, setGenerationErrorCode] = useState<AIPlannerErrorCode>();
  const [savedPreview, setSavedPreview] = useState<GeneratedGoal>();

  const input = useMemo<GoalInput | undefined>(
    () =>
      duration
        ? {
            prompt,
            baseline,
            duration,
            dailyMinutes,
            currentLevel,
            researchMode,
          }
        : undefined,
    [baseline, currentLevel, dailyMinutes, duration, prompt, researchMode],
  );
  const detailsComplete = baseline.trim().length >= 2 && duration !== undefined;

  useEffect(() => {
    let active = true;
    planner
      .recoverLatestSavedGoal()
      .then((saved) => {
        if (!active || !saved) return;
        setSavedPreview(saved);
        setPreview(saved);
        setPrompt(saved.goal.rawPrompt);
        setBaseline(saved.plan.baseline?.userStatement ?? 'Сохранённая исходная точка');
        setDuration(saved.goal.program.duration);
        setDailyMinutes(saved.plan.dailyMinutes);
        setCurrentLevel(recoveredCurrentLevel(saved.plan));
        setResearchMode(
          saved.plan.research.method === 'openai-web-research-v1' ? 'web' : 'quick',
        );
        setStage('review');
      })
      .catch((error: unknown) => {
        logger.log(
          `[actum-ai] saved plan discovery unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      });

    return () => {
      active = false;
    };
  }, [logger, planner]);

  const generateGoal = useCallback(
    async (reuseOnly = false) => {
      if (!detailsComplete || !input) return;
      setGenerationError('');
      setGenerationErrorCode(undefined);
      setStage('generating');
      try {
        setPreview(await planner.generateGoal(input, { reuseOnly }));
        setStage('review');
      } catch (error) {
        setGenerationErrorCode(error instanceof AIPlannerError ? error.code : 'UPSTREAM_ERROR');
        setGenerationError(
          error instanceof AIPlannerError ? error.message : 'Не удалось получить план от GPT.',
        );
        setStage('error');
      }
    },
    [detailsComplete, input, planner],
  );

  const retryGeneration = useCallback(
    () => generateGoal(shouldReuseSavedResponseForRetry(generationErrorCode)),
    [generateGoal, generationErrorCode],
  );

  const openSavedPlan = useCallback(() => {
    if (!savedPreview) return;
    setPreview(savedPreview);
    setPrompt(savedPreview.goal.rawPrompt);
    setStage('review');
  }, [savedPreview]);

  const acceptPlan = useCallback(() => {
    if (preview) onAcceptGoal(preview);
  }, [onAcceptGoal, preview]);

  return {
    stage,
    prompt,
    setPrompt,
    baseline,
    setBaseline,
    duration,
    setDuration,
    dailyMinutes,
    setDailyMinutes,
    currentLevel,
    setCurrentLevel,
    researchMode,
    setResearchMode,
    preview,
    savedPreview,
    generationError,
    generationErrorCode,
    detailsComplete,
    continueFromIntent: () => setStage('details'),
    backToIntent: () => setStage('intent'),
    editDetails: () => {
      setResearchMode('web');
      setStage('details');
    },
    generateGoal: () => generateGoal(false),
    retryGeneration,
    openSavedPlan,
    acceptPlan,
  } as const;
}
