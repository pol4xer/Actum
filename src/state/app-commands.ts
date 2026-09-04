import { createMissionRun } from '@/domain/mission-run';
import type {
  AppState,
  Archetype,
  GeneratedGoal,
  MissionOutcome,
  MissionRun,
  MissionRunFinishReason,
  MissionRunMutation,
  Profile,
  StrictnessMode,
} from '@/domain/types';
import { toLocalDateKey } from '@/lib/calendar-date';

import type { AppStateAction } from './app-state';

export type AppCommands = {
  finishOnboarding(input: {
    name: string;
    archetype: Archetype;
    strictness: StrictnessMode;
  }): void;
  createGoal(generated: GeneratedGoal): void;
  advanceGoalCycle(generated: GeneratedGoal): void;
  beginMissionRun(missionId: string): MissionRun | undefined;
  restartMissionRun(missionId: string): MissionRun | undefined;
  saveMissionRun(run: MissionRun): void;
  mutateMissionRun(missionId: string, runId: string, mutation: MissionRunMutation): void;
  finishMissionRun(run: MissionRun, finishReason?: MissionRunFinishReason): void;
  reportMission(
    missionId: string,
    outcome: Exclude<MissionOutcome, 'pending'>,
    note?: string,
    runId?: string,
  ): void;
  skipMissionForTesting(missionId: string): void;
  restartActivePlan(planId: string): void;
  startNewGoal(): void;
  setNotificationsEnabled(enabled: boolean): void;
};

export type AppCommandDependencies = {
  state: AppState;
  dispatch(action: AppStateAction): void;
  now(): Date;
  canSkipMissionDays: boolean;
};

function checkInId(at: string): string {
  return `checkin-${Date.parse(at).toString(36)}`;
}

/** Application commands coordinate domain objects without depending on React or storage. */
export function createAppCommands({
  state,
  dispatch,
  now,
  canSkipMissionDays,
}: AppCommandDependencies): AppCommands {
  const timestamp = () => now().toISOString();

  return {
    finishOnboarding(input) {
      const at = timestamp();
      const profile: Profile = {
        ...input,
        name: input.name.trim() || 'Путник',
        contractAcceptedAt: at,
      };
      dispatch({ type: 'finish-onboarding', profile, now: at });
    },
    createGoal(generated) {
      dispatch({ type: 'create-goal', generated, now: timestamp() });
    },
    advanceGoalCycle(generated) {
      const currentProgram = state.activeGoal?.program;
      const currentCycle = state.activePlan?.cycleNumber ?? currentProgram?.activeCycle;
      const nextProgram = generated.goal.program;
      if (
        !state.activePlan ||
        !currentProgram ||
        state.activeGoal?.status !== 'active' ||
        !currentCycle ||
        !state.activePlan.missions.every((mission) => mission.outcome !== 'pending') ||
        generated.plan.cycleNumber !== currentCycle + 1 ||
        generated.plan.totalCycles !== currentProgram.totalCycles ||
        !nextProgram ||
        nextProgram.duration !== currentProgram.duration
      ) {
        return;
      }
      dispatch({ type: 'advance-goal-cycle', generated, now: timestamp() });
    },
    beginMissionRun(missionId) {
      const existing = state.missionRuns[missionId];
      if (existing) return existing;
      const mission = state.activePlan?.missions.find(
        (item) => item.id === missionId && item.outcome === 'pending',
      );
      if (!mission) return undefined;
      const at = timestamp();
      const run = createMissionRun(mission, at);
      dispatch({ type: 'begin-mission-run', run, now: at });
      return run;
    },
    restartMissionRun(missionId) {
      const mission = state.activePlan?.missions.find(
        (item) => item.id === missionId && item.outcome === 'pending',
      );
      if (!mission) return undefined;

      let at = timestamp();
      let run = createMissionRun(mission, at);
      if (run.id === state.missionRuns[missionId]?.id) {
        at = new Date(Date.parse(at) + 1).toISOString();
        run = createMissionRun(mission, at);
      }
      dispatch({ type: 'restart-mission-run', run, now: at });
      return run;
    },
    saveMissionRun(run) {
      dispatch({ type: 'save-mission-run', run, now: timestamp() });
    },
    mutateMissionRun(missionId, runId, mutation) {
      dispatch({ type: 'mutate-mission-run', missionId, runId, mutation, now: timestamp() });
    },
    finishMissionRun(run, finishReason = 'completed') {
      dispatch({ type: 'finish-mission-run', run, finishReason, now: timestamp() });
    },
    reportMission(missionId, outcome, note, runId) {
      const at = timestamp();
      dispatch({
        type: 'report-mission',
        missionId,
        outcome,
        note,
        runId,
        checkInId: checkInId(at),
        now: at,
      });
    },
    skipMissionForTesting(missionId) {
      if (!canSkipMissionDays) return;

      const currentMission = state.activePlan?.missions.find(
        (mission) => mission.outcome === 'pending',
      );
      if (currentMission?.id !== missionId) return;

      const at = timestamp();
      dispatch({
        type: 'skip-mission-for-testing',
        missionId,
        checkInId: checkInId(at),
        now: at,
      });
    },
    restartActivePlan(planId) {
      const restartedAt = now();
      dispatch({
        type: 'restart-active-plan',
        planId,
        startDate: toLocalDateKey(restartedAt),
        now: restartedAt.toISOString(),
      });
    },
    startNewGoal() {
      dispatch({ type: 'start-new-goal', now: timestamp() });
    },
    setNotificationsEnabled(enabled) {
      dispatch({ type: 'set-notifications-enabled', enabled, now: timestamp() });
    },
  };
}
