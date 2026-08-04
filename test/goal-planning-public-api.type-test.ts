import {
  HttpGoalPlanner,
  createPlanDtoSchema,
  createPlanResponseDtoSchema,
  mapPlanDtoToGeneratedGoal,
  mapServerErrorCode,
  shouldReuseSavedResponseForRetry,
  type GoalPlanner,
} from '@/features/goal-planning';

// Compile-time contract: non-UI consumers can reach the planning API through
// the feature barrel without importing implementation files.
void [
  HttpGoalPlanner,
  createPlanDtoSchema,
  createPlanResponseDtoSchema,
  mapPlanDtoToGeneratedGoal,
  mapServerErrorCode,
  shouldReuseSavedResponseForRetry,
];

const planner: GoalPlanner | undefined = undefined;
void planner;
