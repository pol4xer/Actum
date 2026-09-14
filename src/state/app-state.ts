import {
  isMissionRun,
  isMissionRunSuccessful,
  replaceMissionRunCheckpoint,
} from '../domain/mission-run';
import {
  clampCharacterMeter,
  levelForXp,
  missionReward,
  REWARD_POLICY,
} from '../domain/reward-policy';
import {
  assessmentActualFromMissionRun,
  canonicalMetricUnit,
  createGoalProgram,
  goalDurationEndDate,
  inferGoalDuration,
  isGoalProgramCycleComplete,
  parseLegacyGoalTarget,
  primaryActualFromMissionRun,
  programTargetReached,
} from '../domain/goal-program';
import { addCalendarDaysToKey } from '../lib/calendar-date';
import type {
  AppState,
  GeneratedGoal,
  GoalProgram,
  MissionOutcome,
  MissionRun,
  MissionRunFinishReason,
  MissionRunMutation,
  Profile,
} from '../domain/types';

export {
  APP_STATE_SCHEMA_VERSION,
  createInitialAppState,
} from './app-state-defaults';
export { APP_STATE_STORAGE_KEY, restoreAppState } from './app-state-codec';
export type { AppStateV1, AppStateV2, RestoreAppStateResult } from './app-state-codec';

export type AppStateAction =
  | { type: 'finish-onboarding'; profile: Profile; now: string }
  | { type: 'create-goal'; generated: GeneratedGoal; now: string }
  | { type: 'advance-goal-cycle'; generated: GeneratedGoal; now: string }
  | { type: 'begin-mission-run'; run: MissionRun; now: string }
  | { type: 'restart-mission-run'; run: MissionRun; now: string }
  | { type: 'save-mission-run'; run: MissionRun; now: string }
  | {
      type: 'mutate-mission-run';
      missionId: string;
      runId: string;
      mutation: MissionRunMutation;
      now: string;
    }
  | {
      type: 'finish-mission-run';
      run: MissionRun;
      finishReason: MissionRunFinishReason;
      now: string;
    }
  | {
      type: 'report-mission';
      missionId: string;
      runId?: string;
      outcome: Exclude<MissionOutcome, 'pending'>;
      note?: string;
      checkInId: string;
      now: string;
    }
  | {
      type: 'skip-mission-for-testing';
      missionId: string;
      checkInId: string;
      now: string;
    }
  | { type: 'set-notifications-enabled'; enabled: boolean; now: string }
  | { type: 'restart-active-plan'; planId: string; startDate: string; now: string }
  | { type: 'start-new-goal'; now: string }
  | { type: 'reset'; state: AppState };

export function getCurrentMission(state: AppState) {
  if (state.activeGoal?.status !== 'active') return undefined;
  return state.activePlan?.missions.find((mission) => mission.outcome === 'pending');
}

function withTimestamp(state: AppState, now: string): AppState {
  return { ...state, lastUpdatedAt: now };
}

function hasPendingMission(state: AppState, missionId: string): boolean {
  return Boolean(
    state.activePlan?.missions.some(
      (mission) => mission.id === missionId && mission.outcome === 'pending',
    ),
  );
}

function ensureGeneratedProgram(generated: GeneratedGoal): GeneratedGoal {
  const supplied = generated.goal.program;
  const duration = supplied?.duration ?? inferGoalDuration(
    generated.goal.targetTimeline ?? generated.plan.targetTimeline,
  );
  const target = supplied?.target ?? parseLegacyGoalTarget(generated.goal);
  const base = createGoalProgram({
    duration,
    target,
    activeCycle: generated.plan.cycleNumber ?? supplied?.activeCycle ?? 1,
    roadmap: supplied?.roadmap,
  });
  const program: GoalProgram = {
    ...base,
    completedCycles: supplied?.completedCycles ?? [],
    achievement: supplied?.achievement,
  };
  const cycleNumber = generated.plan.cycleNumber ?? program.activeCycle;
  const targetDate = generated.plan.targetCycleNumber === undefined
    ? goalDurationEndDate(generated.goal.createdAt, duration) ?? generated.goal.targetDate
    : generated.goal.targetDate;
  const cycleGoal = generated.plan.cycleGoal?.trim()
    || generated.plan.missions[0]?.title?.trim()
    || generated.plan.chapters?.[0]?.title?.trim()
    || generated.goal.title.trim()
    || `Cycle ${cycleNumber}`;
  return {
    goal: {
      ...generated.goal,
      baseline: generated.goal.baseline ?? generated.plan.baseline,
      targetDate,
      program,
    },
    plan: {
      ...generated.plan,
      cycleNumber,
      totalCycles: program.totalCycles,
      cycleGoal,
    },
  };
}

function sameProgramTarget(left: GoalProgram['target'], right: GoalProgram['target']): boolean {
  return (
    left.userStatement.trim() === right.userStatement.trim() &&
    left.normalizedMetric.trim() === right.normalizedMetric.trim() &&
    left.value === right.value &&
    canonicalMetricUnit(left.unit) === canonicalMetricUnit(right.unit)
  );
}

function withExplicitCycleBaseline(
  program: GoalProgram,
  cycleNumber: number,
  baseline: GeneratedGoal['plan']['baseline'],
): GoalProgram['completedCycles'] {
  if (
    !baseline ||
    baseline.value === null ||
    !Number.isFinite(baseline.value) ||
    baseline.value < 0 ||
    typeof baseline.unit !== 'string' ||
    !baseline.unit.trim()
  ) {
    return program.completedCycles;
  }

  let changed = false;
  const completedCycles = program.completedCycles.map((result) => {
    if (result.cycleNumber !== cycleNumber || result.measuredValue !== null) return result;
    changed = true;
    return {
      ...result,
      measuredValue: baseline.value,
      unit: baseline.unit,
    };
  });
  return changed ? completedCycles : program.completedCycles;
}

function completeActiveCycle(input: {
  goal: NonNullable<AppState['activeGoal']>;
  plan: NonNullable<AppState['activePlan']>;
  missionRuns: AppState['missionRuns'];
  completedAt: string;
  hasDevSkip: boolean;
}): NonNullable<AppState['activeGoal']> {
  const { goal, plan, missionRuns, completedAt, hasDevSkip } = input;
  const program = goal.program;
  if (!program || !isGoalProgramCycleComplete(plan)) {
    return { ...goal, status: 'active' };
  }

  const cycleNumber = plan.cycleNumber ?? program.activeCycle;
  const actual = assessmentActualFromMissionRun(plan, missionRuns);
  const existingResult = program.completedCycles.find(
    (result) => result.cycleNumber === cycleNumber,
  );
  const completedCycles = existingResult
    ? program.completedCycles
    : [
        ...program.completedCycles,
        {
          cycleNumber,
          completedAt,
          measuredValue: actual.measuredValue,
          unit: actual.unit,
        },
      ].sort((left, right) => left.cycleNumber - right.cycleNumber);
  const measuredTargetReached =
    !hasDevSkip && programTargetReached(program.target, actual, goal.baseline);
  const qualitativeTargetReached =
    plan.version >= 7 &&
    program.target.value === null &&
    plan.targetCycleNumber === cycleNumber &&
    !hasDevSkip &&
    plan.missions.every((mission) => mission.outcome === 'completed');
  const reached = measuredTargetReached || qualitativeTargetReached;
  const isFinalCycle = cycleNumber >= program.totalCycles;
  const status = reached
    ? 'completed'
    : !isFinalCycle
      ? 'active'
      : plan.version < 7 && program.target.value === null && !hasDevSkip
        ? 'completed'
        : 'paused';
  return {
    ...goal,
    status,
    program: { ...program, completedCycles },
  };
}

function mutateMissionRun(
  run: MissionRun,
  mutation: MissionRunMutation,
  now: string,
): MissionRun | undefined {
  if (mutation.kind === 'set-final-comment') {
    if (run.status !== 'awaiting_checkin') return undefined;
    return { ...run, finalCommentDraft: mutation.value.slice(0, 280), updatedAt: now };
  }

  if (
    run.status !== 'running' ||
    mutation.blockIndex !== run.cursor.blockIndex
  ) {
    return undefined;
  }

  const blockResults = run.blockResults.map((block, index) => {
    if (index !== mutation.blockIndex) return block;

    if (
      mutation.kind === 'set-counter' &&
      run.cursor.stage === 'work' &&
      block.kind === 'counter' &&
      mutation.setIndex === run.cursor.setIndex &&
      block.sets[mutation.setIndex] &&
      Number.isFinite(mutation.value)
    ) {
      const sets = block.sets.map((set, setIndex) =>
        setIndex === mutation.setIndex
          ? { ...set, actualQuantity: Math.min(1_000_000, Math.max(0, mutation.value)) }
          : set,
      );
      return { ...block, sets };
    }

    if (
      mutation.kind === 'toggle-checklist' &&
      run.cursor.stage === 'work' &&
      block.kind === 'checklist' &&
      Number.isInteger(mutation.itemIndex) &&
      mutation.itemIndex >= 0
    ) {
      const checked = block.checkedIndexes.includes(mutation.itemIndex);
      return {
        ...block,
        checkedIndexes: checked
          ? block.checkedIndexes.filter((index) => index !== mutation.itemIndex)
          : [...block.checkedIndexes, mutation.itemIndex].sort((left, right) => left - right),
      };
    }

    if (
      mutation.kind === 'set-text-log' &&
      run.cursor.stage === 'work' &&
      block.kind === 'text_log'
    ) {
      return { ...block, value: mutation.value.slice(0, 4_000) };
    }

    if (
      mutation.kind === 'set-block-comment' &&
      run.cursor.stage === 'review'
    ) {
      return { ...block, comment: mutation.value.slice(0, 500) };
    }

    if (
      mutation.kind === 'set-block-criterion' &&
      run.cursor.stage === 'review'
    ) {
      return { ...block, criterionMet: mutation.value };
    }

    return block;
  });

  if (blockResults.every((block, index) => block === run.blockResults[index])) return undefined;
  return { ...run, blockResults, updatedAt: now };
}

export function appStateReducer(state: AppState, action: AppStateAction): AppState {
  if (action.type === 'reset') return action.state;

  if (action.type === 'finish-onboarding') {
    return withTimestamp(
      { ...state, onboardingCompleted: true, profile: action.profile },
      action.now,
    );
  }

  if (action.type === 'create-goal') {
    const generated = ensureGeneratedProgram(action.generated);
    return withTimestamp(
      {
        ...state,
        activeGoal: generated.goal,
        activePlan: generated.plan,
        checkIns: [],
        missionRuns: {},
        recovery: undefined,
        character: {
          ...state.character,
          energy: Math.max(state.character.energy, REWARD_POLICY.initialEnergy),
          buffs: ['Clear intention'],
          debuffs: [],
        },
      },
      action.now,
    );
  }

  if (action.type === 'advance-goal-cycle') {
    if (
      !state.activeGoal?.program ||
      state.activeGoal.status !== 'active' ||
      !state.activePlan
    ) {
      return state;
    }
    const currentProgram = state.activeGoal.program;
    const currentCycle = state.activePlan.cycleNumber ?? currentProgram.activeCycle;
    const nextCycle = currentCycle + 1;
    const generated = ensureGeneratedProgram(action.generated);
    const nextProgram = generated.goal.program;
    if (
      !isGoalProgramCycleComplete(state.activePlan) ||
      !currentProgram.completedCycles.some((result) => result.cycleNumber === currentCycle) ||
      nextCycle > currentProgram.totalCycles ||
      generated.plan.cycleNumber !== nextCycle ||
      generated.plan.totalCycles !== currentProgram.totalCycles ||
      !nextProgram ||
      nextProgram.activeCycle !== nextCycle ||
      nextProgram.duration !== currentProgram.duration ||
      nextProgram.totalDays !== currentProgram.totalDays ||
      nextProgram.totalCycles !== currentProgram.totalCycles ||
      nextProgram.roadmap.length !== currentProgram.totalCycles ||
      !sameProgramTarget(currentProgram.target, nextProgram.target) ||
      generated.plan.missions.length === 0 ||
      generated.plan.missions.some((mission) => mission.outcome !== 'pending')
    ) {
      return state;
    }
    const completedCycles = withExplicitCycleBaseline(
      currentProgram,
      currentCycle,
      generated.plan.baseline,
    );

    return withTimestamp(
      {
        ...state,
        activeGoal: {
          ...state.activeGoal,
          targetDate: generated.plan.targetCycleNumber === undefined
            ? state.activeGoal.targetDate
            : generated.goal.targetDate,
          status: 'active',
          program: {
            ...currentProgram,
            activeCycle: nextCycle,
            roadmap: nextProgram.roadmap,
            completedCycles,
          },
        },
        activePlan: generated.plan,
        checkIns: [],
        missionRuns: {},
        recovery: undefined,
      },
      action.now,
    );
  }

  if (action.type === 'begin-mission-run' || action.type === 'restart-mission-run') {
    const { run } = action;
    if (!hasPendingMission(state, run.missionId) || !isMissionRun(run)) return state;
    if (action.type === 'begin-mission-run' && state.missionRuns[run.missionId]) return state;
    return withTimestamp(
      {
        ...state,
        missionRuns: { ...state.missionRuns, [run.missionId]: run },
        recovery: undefined,
      },
      action.now,
    );
  }

  if (action.type === 'save-mission-run') {
    const current = state.missionRuns[action.run.missionId];
    if (!current || !hasPendingMission(state, action.run.missionId)) return state;
    if (
      current.status === 'awaiting_checkin' &&
      action.run.status === 'awaiting_checkin' &&
      action.run.id === current.id &&
      action.run.missionId === current.missionId
    ) {
      const draft = action.run.finalCommentDraft?.slice(0, 280);
      return withTimestamp(
        {
          ...state,
          missionRuns: {
            ...state.missionRuns,
            [current.missionId]: { ...current, finalCommentDraft: draft, updatedAt: action.now },
          },
        },
        action.now,
      );
    }
    const replacement = replaceMissionRunCheckpoint(current, action.run, action.now);
    if (!replacement) return state;
    return withTimestamp(
      {
        ...state,
        missionRuns: { ...state.missionRuns, [replacement.missionId]: replacement },
      },
      action.now,
    );
  }

  if (action.type === 'mutate-mission-run') {
    const current = state.missionRuns[action.missionId];
    if (
      !current ||
      current.id !== action.runId ||
      !hasPendingMission(state, action.missionId)
    ) {
      return state;
    }
    const mutated = mutateMissionRun(current, action.mutation, action.now);
    if (!mutated) return state;
    return withTimestamp(
      {
        ...state,
        missionRuns: { ...state.missionRuns, [action.missionId]: mutated },
      },
      action.now,
    );
  }

  if (action.type === 'finish-mission-run') {
    const current = state.missionRuns[action.run.missionId];
    if (!current || !hasPendingMission(state, action.run.missionId)) return state;
    const checkpoint = replaceMissionRunCheckpoint(current, action.run, action.now);
    if (!checkpoint) return state;
    const finished: MissionRun = {
      ...checkpoint,
      status: 'awaiting_checkin',
      cursor: { ...checkpoint.cursor, stage: 'complete' },
      updatedAt: action.now,
      stageStartedAt: action.now,
      stageEndsAt: undefined,
      finishedAt: action.now,
      finishReason: action.finishReason,
    };
    return withTimestamp(
      {
        ...state,
        missionRuns: { ...state.missionRuns, [action.run.missionId]: finished },
      },
      action.now,
    );
  }

  if (action.type === 'report-mission') {
    if (!state.activePlan) return state;
    const mission = state.activePlan.missions.find((item) => item.id === action.missionId);
    const run = state.missionRuns[action.missionId];
    if (!mission || mission.outcome !== 'pending') return state;

    const requiresRun = mission.execution?.kind === 'in_app';
    if (requiresRun) {
      if (
        !run ||
        run.status !== 'awaiting_checkin' ||
        (action.runId !== undefined && run.id !== action.runId) ||
        (action.outcome === 'completed' && !isMissionRunSuccessful(run))
      ) {
        return state;
      }
    }

    const { xpDelta, energyDelta, worldLightDelta } = missionReward(
      mission.xp,
      action.outcome,
    );
    const xp = state.character.xp + xpDelta;
    const missions = state.activePlan.missions.map((item) =>
      item.id === action.missionId ? { ...item, outcome: action.outcome } : item,
    );
    const debuffs =
      action.outcome === 'skipped'
        ? Array.from(new Set([...state.character.debuffs, 'Fog of doubt']))
        : state.character.debuffs.filter((debuff) => debuff !== 'Fog of doubt');
    const reportedRun: MissionRun | undefined = run
      ? { ...run, status: 'reported', updatedAt: action.now }
      : undefined;
    const comment = action.note?.trim() || undefined;
    const missionRuns = reportedRun
      ? { ...state.missionRuns, [action.missionId]: reportedRun }
      : state.missionRuns;
    const checkIn = {
      id: action.checkInId,
      missionId: action.missionId,
      runId: run?.id,
      outcome: action.outcome,
      comment,
      note: comment,
      provenance: 'user' as const,
      xpDelta,
      energyDelta,
      createdAt: action.now,
    };
    const checkIns = [checkIn, ...state.checkIns];
    const activePlan = { ...state.activePlan, missions };
    const cycleGoal = state.activeGoal
      ? completeActiveCycle({
          goal: state.activeGoal,
          plan: activePlan,
          missionRuns,
          completedAt: action.now,
          hasDevSkip: checkIns.some((item) => item.provenance === 'dev-skip'),
        })
      : undefined;
    const primaryActual = state.activeGoal && reportedRun
      ? primaryActualFromMissionRun(
          mission,
          reportedRun,
          state.activeGoal.program.target,
          state.activeGoal.baseline ?? state.activePlan.baseline,
        )
      : { measuredValue: null, unit: null };
    const reachedFromPrimary =
      state.activeGoal?.status === 'active' &&
      state.activePlan.version >= 7 &&
      action.outcome === 'completed' &&
      !checkIns.some((item) => item.provenance === 'dev-skip') &&
      programTargetReached(
        state.activeGoal.program.target,
        primaryActual,
        state.activeGoal.baseline ?? state.activePlan.baseline,
      );
    const activeGoal =
      reachedFromPrimary &&
      cycleGoal &&
      primaryActual.measuredValue !== null &&
      primaryActual.unit !== null
      ? {
          ...cycleGoal,
          status: 'completed' as const,
          program: {
            ...cycleGoal.program,
            achievement: {
              cycleNumber: activePlan.cycleNumber ?? cycleGoal.program.activeCycle,
              completedAt: action.now,
              measuredValue: primaryActual.measuredValue,
              unit: primaryActual.unit,
            },
          },
        }
      : cycleGoal;

    return withTimestamp(
      {
        ...state,
        activeGoal,
        activePlan,
        missionRuns,
        checkIns,
        character: {
          ...state.character,
          xp,
          level: levelForXp(xp),
          energy: clampCharacterMeter(state.character.energy + energyDelta),
          streak: action.outcome === 'completed' ? state.character.streak + 1 : 0,
          worldLight: clampCharacterMeter(state.character.worldLight + worldLightDelta),
          buffs:
            action.outcome === 'completed'
              ? Array.from(new Set([...state.character.buffs, 'Momentum']))
              : state.character.buffs.filter((buff) => buff !== 'Momentum'),
          debuffs,
        },
        recovery: undefined,
      },
      action.now,
    );
  }

  if (action.type === 'skip-mission-for-testing') {
    if (!state.activePlan) return state;
    const currentMission = state.activePlan.missions.find(
      (mission) => mission.outcome === 'pending',
    );
    if (!currentMission || currentMission.id !== action.missionId) return state;

    // This advances the persisted QA journey without fabricating completed work
    // or applying gameplay rewards/penalties. Restarting the plan removes the
    // DEV check-ins and restores every mission to pending.
    const missions = state.activePlan.missions.map((mission) =>
      mission.id === action.missionId ? { ...mission, outcome: 'skipped' as const } : mission,
    );
    const missionRuns = { ...state.missionRuns };
    delete missionRuns[action.missionId];
    const note = 'Skipped in development mode.';
    const checkIn = {
      id: action.checkInId,
      missionId: action.missionId,
      outcome: 'skipped' as const,
      comment: note,
      note,
      provenance: 'dev-skip' as const,
      xpDelta: 0,
      energyDelta: 0,
      createdAt: action.now,
    };
    const checkIns = [checkIn, ...state.checkIns];
    const activePlan = { ...state.activePlan, missions };
    const activeGoal = state.activeGoal
      ? completeActiveCycle({
          goal: state.activeGoal,
          plan: activePlan,
          missionRuns,
          completedAt: action.now,
          hasDevSkip: true,
        })
      : undefined;

    return withTimestamp(
      {
        ...state,
        activeGoal,
        activePlan,
        missionRuns,
        checkIns,
        recovery: undefined,
      },
      action.now,
    );
  }

  if (action.type === 'set-notifications-enabled') {
    return withTimestamp(
      {
        ...state,
        settings: { ...state.settings, notificationsEnabled: action.enabled },
      },
      action.now,
    );
  }

  if (action.type === 'restart-active-plan') {
    if (
      !state.activeGoal ||
      !state.activePlan ||
      state.activePlan.id !== action.planId
    ) {
      return state;
    }
    const scheduledDates = state.activePlan.missions.map((mission) => {
      const dayNumber = mission.dayNumber ?? mission.sequence;
      if (!Number.isInteger(dayNumber) || dayNumber < 1) return undefined;
      return addCalendarDaysToKey(action.startDate, dayNumber - 1);
    });
    if (scheduledDates.some((date) => date === undefined)) return state;

    const activeCycle = state.activePlan.cycleNumber ?? state.activeGoal.program?.activeCycle;
    const program = state.activeGoal.program && activeCycle
      ? {
          ...state.activeGoal.program,
          achievement: undefined,
          completedCycles: state.activeGoal.program.completedCycles.filter(
            (result) => result.cycleNumber !== activeCycle,
          ),
        }
      : state.activeGoal.program;

    return withTimestamp(
      {
        ...state,
        activeGoal: {
          ...state.activeGoal,
          status: 'active',
          program,
        },
        activePlan: {
          ...state.activePlan,
          missions: state.activePlan.missions.map((mission, index) => ({
            ...mission,
            outcome: 'pending',
            scheduledDate: scheduledDates[index],
          })),
        },
        checkIns: [],
        missionRuns: {},
        recovery: undefined,
      },
      action.now,
    );
  }

  if (action.type === 'start-new-goal') {
    return withTimestamp(
      {
        ...state,
        activeGoal: undefined,
        activePlan: undefined,
        checkIns: [],
        missionRuns: {},
        recovery: undefined,
      },
      action.now,
    );
  }

  return state;
}
