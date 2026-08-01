import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

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
import { disableDailyReminder } from '@/lib/notifications';
import storage from '@/lib/storage';

import {
  APP_STATE_STORAGE_KEY,
  appStateReducer,
  createInitialAppState,
  restoreAppState,
  type RestoreAppStateResult,
} from './app-state';

type HydrationIssue = Extract<RestoreAppStateResult, { status: 'blocked' }> | {
  reason: 'storage-error';
};

export type PersistenceStatus = 'loading' | 'saving' | 'saved' | 'error';

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
  startNewGoal(): void;
  setNotificationsEnabled(enabled: boolean): void;
  resetProgress(): Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

function getCurrentMission(state: AppState) {
  return state.activePlan?.missions.find((mission) => mission.outcome === 'pending');
}

function now(): string {
  return new Date().toISOString();
}

function checkInId(at: string): string {
  return `checkin-${Date.parse(at).toString(36)}`;
}

export function AppProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(appStateReducer, undefined, () => createInitialAppState());
  const [isHydrated, setIsHydrated] = useState(false);
  const [persistenceEnabled, setPersistenceEnabled] = useState(false);
  const [hydrationIssue, setHydrationIssue] = useState<HydrationIssue>();
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('loading');
  const latestStateRef = useRef(state);
  const pendingPersistenceRef = useRef<string | undefined>(undefined);
  const persistenceWriteRef = useRef<Promise<boolean> | undefined>(undefined);
  latestStateRef.current = state;

  const flushPersistence = useCallback((): Promise<boolean> => {
    if (persistenceWriteRef.current) return persistenceWriteRef.current;

    const write = (async () => {
      try {
        while (pendingPersistenceRef.current !== undefined) {
          const payload = pendingPersistenceRef.current;
          pendingPersistenceRef.current = undefined;
          await storage.setItem(APP_STATE_STORAGE_KEY, payload);
        }
        setPersistenceStatus('saved');
        return true;
      } catch {
        pendingPersistenceRef.current = JSON.stringify(latestStateRef.current);
        setPersistenceEnabled(false);
        setHydrationIssue({ reason: 'storage-error' });
        setPersistenceStatus('error');
        return false;
      }
    })();

    persistenceWriteRef.current = write;
    void write.finally(() => {
      if (persistenceWriteRef.current === write) persistenceWriteRef.current = undefined;
    });
    return write;
  }, []);

  useEffect(() => {
    let active = true;

    storage
      .getItem(APP_STATE_STORAGE_KEY)
      .then((raw) => {
        if (!active) return;
        const restored = restoreAppState(raw);
        if (restored.status === 'ready') {
          dispatch({ type: 'reset', state: restored.state });
          setPersistenceEnabled(true);
          setHydrationIssue(undefined);
          setPersistenceStatus('saved');
        } else {
          // Keep the unknown/corrupt bytes intact until the user explicitly resets progress.
          setPersistenceEnabled(false);
          setHydrationIssue(restored);
          setPersistenceStatus('error');
        }
      })
      .catch(() => {
        if (!active) return;
        setPersistenceEnabled(false);
        setHydrationIssue({ reason: 'storage-error' });
        setPersistenceStatus('error');
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || !persistenceEnabled) return;
    pendingPersistenceRef.current = JSON.stringify(state);
    setPersistenceStatus('saving');
    void flushPersistence();
  }, [flushPersistence, isHydrated, persistenceEnabled, state]);

  const retryPersistence = useCallback(async () => {
    if (hydrationIssue && hydrationIssue.reason !== 'storage-error') return false;
    pendingPersistenceRef.current = JSON.stringify(latestStateRef.current);
    setPersistenceStatus('saving');
    const saved = await flushPersistence();
    if (saved) {
      setHydrationIssue(undefined);
      setPersistenceEnabled(true);
    }
    return saved;
  }, [flushPersistence, hydrationIssue]);

  const value = useMemo<AppContextValue>(() => {
    const finishOnboarding: AppContextValue['finishOnboarding'] = (input) => {
      const at = now();
      const profile: Profile = {
        ...input,
        name: input.name.trim() || 'Путник',
        contractAcceptedAt: at,
      };
      dispatch({ type: 'finish-onboarding', profile, now: at });
    };

    const createGoal: AppContextValue['createGoal'] = (generated) => {
      dispatch({ type: 'create-goal', generated, now: now() });
    };

    const beginMissionRun: AppContextValue['beginMissionRun'] = (missionId) => {
      const existing = state.missionRuns[missionId];
      if (existing) return existing;
      const mission = state.activePlan?.missions.find(
        (item) => item.id === missionId && item.outcome === 'pending',
      );
      if (!mission) return undefined;
      const at = now();
      const run = createMissionRun(mission, at);
      dispatch({ type: 'begin-mission-run', run, now: at });
      return run;
    };

    const restartMissionRun: AppContextValue['restartMissionRun'] = (missionId) => {
      const mission = state.activePlan?.missions.find(
        (item) => item.id === missionId && item.outcome === 'pending',
      );
      if (!mission) return undefined;

      let at = now();
      let run = createMissionRun(mission, at);
      if (run.id === state.missionRuns[missionId]?.id) {
        at = new Date(Date.parse(at) + 1).toISOString();
        run = createMissionRun(mission, at);
      }
      dispatch({ type: 'restart-mission-run', run, now: at });
      return run;
    };

    const saveMissionRun: AppContextValue['saveMissionRun'] = (run) => {
      dispatch({ type: 'save-mission-run', run, now: now() });
    };

    const mutateMissionRun: AppContextValue['mutateMissionRun'] = (
      missionId,
      runId,
      mutation,
    ) => {
      dispatch({ type: 'mutate-mission-run', missionId, runId, mutation, now: now() });
    };

    const finishMissionRun: AppContextValue['finishMissionRun'] = (
      run,
      finishReason = 'completed',
    ) => {
      dispatch({ type: 'finish-mission-run', run, finishReason, now: now() });
    };

    const reportMission: AppContextValue['reportMission'] = (
      missionId,
      outcome,
      note,
      runId,
    ) => {
      const at = now();
      dispatch({
        type: 'report-mission',
        missionId,
        outcome,
        note,
        runId,
        checkInId: checkInId(at),
        now: at,
      });
    };

    const setNotificationsEnabled: AppContextValue['setNotificationsEnabled'] = (enabled) => {
      dispatch({ type: 'set-notifications-enabled', enabled, now: now() });
    };

    const startNewGoal: AppContextValue['startNewGoal'] = () => {
      dispatch({ type: 'start-new-goal', now: now() });
    };

    const resetProgress: AppContextValue['resetProgress'] = async () => {
      setPersistenceEnabled(false);
      pendingPersistenceRef.current = undefined;
      await persistenceWriteRef.current;
      await disableDailyReminder();
      await storage.removeItem(APP_STATE_STORAGE_KEY);
      setHydrationIssue(undefined);
      setPersistenceStatus('saving');
      setPersistenceEnabled(true);
      dispatch({ type: 'reset', state: createInitialAppState(now()) });
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
      finishOnboarding,
      createGoal,
      beginMissionRun,
      restartMissionRun,
      saveMissionRun,
      mutateMissionRun,
      finishMissionRun,
      reportMission,
      startNewGoal,
      setNotificationsEnabled,
      resetProgress,
    };
  }, [hydrationIssue, isHydrated, persistenceStatus, retryPersistence, state]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
