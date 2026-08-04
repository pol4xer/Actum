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
import { addCalendarDaysToKey } from '../lib/calendar-date';
import type {
  AppState,
  GeneratedGoal,
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
export type { AppStateV1, RestoreAppStateResult } from './app-state-codec';

export type AppStateAction =
  | { type: 'finish-onboarding'; profile: Profile; now: string }
  | { type: 'create-goal'; generated: GeneratedGoal; now: string }
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
  | { type: 'set-notifications-enabled'; enabled: boolean; now: string }
  | { type: 'restart-active-plan'; planId: string; startDate: string; now: string }
  | { type: 'start-new-goal'; now: string }
  | { type: 'reset'; state: AppState };

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
    return withTimestamp(
      {
        ...state,
        activeGoal: action.generated.goal,
        activePlan: action.generated.plan,
        checkIns: [],
        missionRuns: {},
        recovery: undefined,
        character: {
          ...state.character,
          energy: Math.max(state.character.energy, REWARD_POLICY.initialEnergy),
          buffs: ['Ясное намерение'],
          debuffs: [],
        },
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
    const allReported = missions.every((item) => item.outcome !== 'pending');
    const debuffs =
      action.outcome === 'skipped'
        ? Array.from(new Set([...state.character.debuffs, 'Туман сомнений']))
        : state.character.debuffs.filter((debuff) => debuff !== 'Туман сомнений');
    const reportedRun: MissionRun | undefined = run
      ? { ...run, status: 'reported', updatedAt: action.now }
      : undefined;
    const comment = action.note?.trim() || undefined;

    return withTimestamp(
      {
        ...state,
        activeGoal: state.activeGoal
          ? { ...state.activeGoal, status: allReported ? 'completed' : 'active' }
          : undefined,
        activePlan: { ...state.activePlan, missions },
        missionRuns: reportedRun
          ? { ...state.missionRuns, [action.missionId]: reportedRun }
          : state.missionRuns,
        checkIns: [
          {
            id: action.checkInId,
            missionId: action.missionId,
            runId: run?.id,
            outcome: action.outcome,
            comment,
            note: comment,
            xpDelta,
            energyDelta,
            createdAt: action.now,
          },
          ...state.checkIns,
        ],
        character: {
          ...state.character,
          xp,
          level: levelForXp(xp),
          energy: clampCharacterMeter(state.character.energy + energyDelta),
          streak: action.outcome === 'completed' ? state.character.streak + 1 : 0,
          worldLight: clampCharacterMeter(state.character.worldLight + worldLightDelta),
          buffs:
            action.outcome === 'completed'
              ? Array.from(new Set([...state.character.buffs, 'Импульс']))
              : state.character.buffs.filter((buff) => buff !== 'Импульс'),
          debuffs,
        },
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
    const targetDate = addCalendarDaysToKey(
      action.startDate,
      Math.max(0, state.activePlan.horizonDays - 1),
    );
    if (scheduledDates.some((date) => date === undefined) || !targetDate) return state;

    return withTimestamp(
      {
        ...state,
        activeGoal: {
          ...state.activeGoal,
          status: 'active',
          targetDate: `${targetDate}T00:00:00.000Z`,
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
