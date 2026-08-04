import type { GeneratedGoal, GoalInput } from '@/domain/types';

export type GenerateGoalOptions = Readonly<{
  /** Re-validate an already saved provider response without starting billable AI work. */
  reuseOnly?: boolean;
}>;

/** Application-facing port for creating and recovering goal plans. */
export interface GoalPlanner {
  generateGoal(input: GoalInput, options?: GenerateGoalOptions): Promise<GeneratedGoal>;
  recoverLatestSavedGoal(): Promise<GeneratedGoal | undefined>;
}
