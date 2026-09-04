import {
  createContext,
  PropsWithChildren,
  useContext,
  useMemo,
} from 'react';

import { featureFlags } from '@/config/feature-flags';
import type {
  AppState,
  Archetype,
  GeneratedGoal,
  MissionOutcome,
  MissionRun,
  MissionRunFinishReason,
  MissionRunMutation,
  StrictnessMode,
} from '@/domain/types';
import { disableDailyReminder } from '@/lib/notifications';
import storage from '@/lib/storage';

import { createAppCommands } from './app-commands';
import { createInitialAppState } from './app-state-defaults';
import { createAppStateRepository } from './app-state-repository';
import {
  usePersistentAppState,
  type HydrationIssue,
  type PersistenceStatus,
} from './use-persistent-app-state';

export type { HydrationIssue, PersistenceStatus } from './use-persistent-app-state';

export type AppContextValue = {
  state: AppState;
  isHydrated: boolean;
  /** Present when persistence is deliberately disabled to protect unreadable stored data. */
  hydrationIssue?: HydrationIssue;
  persistenceStatus: PersistenceStatus;
  retryPersistence(): Promise<boolean>;
  currentMission: ReturnType<typeof getCurrentMission>;
  completedCount: number;
  finishOnboarding(input: {
    name: string;
    archetype: Archetype;
    strictness: StrictnessMode;
  }): void;
  createGoal(generated: GeneratedGoal): void;
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
  resetProgress(): Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);
const appStateRepository = createAppStateRepository(storage);

function getCurrentMission(state: AppState) {
  return state.activePlan?.missions.find((mission) => mission.outcome === 'pending');
}

export function AppProvider({ children }: PropsWithChildren) {
  const {
    state,
    dispatch,
    isHydrated,
    hydrationIssue,
    persistenceStatus,
    retryPersistence,
    resetPersistedState,
  } = usePersistentAppState(appStateRepository);

  const value = useMemo<AppContextValue>(() => {
    const commands = createAppCommands({
      state,
      dispatch,
      now: () => new Date(),
      canSkipMissionDays: featureFlags.canSkipMissionDays,
    });

    const resetProgress: AppContextValue['resetProgress'] = async () => {
      await resetPersistedState(createInitialAppState(new Date()), disableDailyReminder);
    };

    return {
      state,
      isHydrated,
      hydrationIssue,
      persistenceStatus,
      retryPersistence,
      currentMission: getCurrentMission(state),
      completedCount:
        state.activePlan?.missions.filter((mission) => mission.outcome === 'completed').length ?? 0,
      ...commands,
      resetProgress,
    };
  }, [
    dispatch,
    hydrationIssue,
    isHydrated,
    persistenceStatus,
    resetPersistedState,
    retryPersistence,
    state,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
