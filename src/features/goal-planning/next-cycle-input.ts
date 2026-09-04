import type { Goal, GoalInput, PlanVersion } from '@/domain/types';

const RESEARCH_ANCHOR_PATTERN = /^[a-f0-9]{64}$/u;

export function reusableResearchAnchor(plan: PlanVersion): string | undefined {
  const anchor = plan.research.researchAnchor;
  return plan.version >= 7 &&
    plan.research.method === 'openai-web-research-v1' &&
    typeof anchor === 'string' &&
    RESEARCH_ANCHOR_PATTERN.test(anchor)
    ? anchor
    : undefined;
}

/** Builds the only data sent for an adaptive cycle; the full MissionRun journal stays local. */
export function createNextCycleInput(
  goal: Goal,
  plan: PlanVersion,
  baseline: string,
): GoalInput {
  const program = goal.program;
  const cycleNumber = program.activeCycle + 1;
  if (cycleNumber > program.totalCycles) {
    throw new Error('Goal program has no next cycle.');
  }
  const normalizedBaseline = baseline.trim();
  if (normalizedBaseline.length < 2) {
    throw new Error('Next cycle requires a measured baseline.');
  }
  const researchAnchor = reusableResearchAnchor(plan);

  return {
    prompt: goal.rawPrompt,
    currentLevel: 'some-experience',
    baseline: normalizedBaseline,
    duration: program.duration,
    dailyMinutes: plan.dailyMinutes,
    cycleNumber,
    programContext: {
      target: program.target,
      roadmap: program.roadmap,
      completedCycles: program.completedCycles,
      ...(researchAnchor ? { researchAnchor } : {}),
      ...(plan.targetCycleNumber
        ? { targetCycleNumber: plan.targetCycleNumber }
        : {}),
    },
    researchMode: researchAnchor ? 'web' : 'quick',
  };
}
