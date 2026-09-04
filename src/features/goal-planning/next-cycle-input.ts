import type { Goal, GoalInput, PlanVersion } from '@/domain/types';

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
    },
    researchMode:
      plan.version >= 6 && plan.research.method === 'openai-web-research-v1'
        ? 'web'
        : 'quick',
  };
}
