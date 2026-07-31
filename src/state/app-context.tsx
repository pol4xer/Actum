import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import {
  AppState,
  Archetype,
  GeneratedGoal,
  MissionOutcome,
  Profile,
  StrictnessMode,
} from '@/domain/types';
import { disableDailyReminder } from '@/lib/notifications';
import storage from '@/lib/storage';

const STORAGE_KEY = 'actum.app-state.v1';

const INITIAL_STATE: AppState = {
  schemaVersion: 1,
  onboardingCompleted: false,
  character: {
    level: 1,
    xp: 0,
    energy: 76,
    streak: 0,
    worldLight: 18,
    buffs: ['Первый шаг'],
    debuffs: [],
  },
  checkIns: [],
  settings: {
    notificationsEnabled: false,
    reminderHour: 9,
    reminderMinute: 0,
  },
  lastUpdatedAt: new Date(0).toISOString(),
};

type AppContextValue = {
  state: AppState;
  isHydrated: boolean;
  currentMission: AppState['activePlan'] extends infer _T ? ReturnType<typeof getCurrentMission> : never;
  completedCount: number;
  finishOnboarding(input: {
    name: string;
    archetype: Archetype;
    strictness: StrictnessMode;
  }): void;
  createGoal(generated: GeneratedGoal): void;
  reportMission(missionId: string, outcome: Exclude<MissionOutcome, 'pending'>, note?: string): void;
  completeRecovery(): void;
  startNewGoal(): void;
  setNotificationsEnabled(enabled: boolean): void;
  resetProgress(): Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

function getCurrentMission(state: AppState) {
  return state.activePlan?.missions.find((mission) => mission.outcome === 'pending');
}

function withTimestamp(state: AppState): AppState {
  return { ...state, lastUpdatedAt: new Date().toISOString() };
}

export function AppProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let active = true;

    storage
      .getItem(STORAGE_KEY)
      .then((raw) => {
        if (!active || !raw) return;
        const restored = JSON.parse(raw) as AppState;
        if (restored.schemaVersion === 1) setState(restored);
      })
      .catch(() => {
        // A fresh local state is a safe fallback if persisted data is unreadable.
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    storage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {
      // The UI remains usable in-memory when storage is unavailable.
    });
  }, [isHydrated, state]);

  const value = useMemo<AppContextValue>(() => {
    const finishOnboarding: AppContextValue['finishOnboarding'] = (input) => {
      const profile: Profile = {
        ...input,
        name: input.name.trim() || 'Путник',
        contractAcceptedAt: new Date().toISOString(),
      };
      setState((previous) =>
        withTimestamp({ ...previous, onboardingCompleted: true, profile }),
      );
    };

    const createGoal: AppContextValue['createGoal'] = (generated) => {
      setState((previous) =>
        withTimestamp({
          ...previous,
          activeGoal: generated.goal,
          activePlan: generated.plan,
          checkIns: [],
          recovery: undefined,
          character: {
            ...previous.character,
            energy: Math.max(previous.character.energy, 76),
            buffs: ['Ясное намерение'],
            debuffs: [],
          },
        }),
      );
    };

    const reportMission: AppContextValue['reportMission'] = (missionId, outcome, note) => {
      setState((previous) => {
        if (!previous.activePlan) return previous;
        const mission = previous.activePlan.missions.find((item) => item.id === missionId);
        if (!mission || mission.outcome !== 'pending') return previous;

        const multiplier = outcome === 'completed' ? 1 : outcome === 'partial' ? 0.45 : 0;
        const xpDelta = Math.round(mission.xp * multiplier);
        const energyDelta = outcome === 'completed' ? 6 : outcome === 'partial' ? -2 : -10;
        const xp = previous.character.xp + xpDelta;
        const missions = previous.activePlan.missions.map((item) =>
          item.id === missionId ? { ...item, outcome } : item,
        );
        const allReported = missions.every((item) => item.outcome !== 'pending');
        const newDebuffs =
          outcome === 'skipped'
            ? Array.from(new Set([...previous.character.debuffs, 'Туман сомнений']))
            : previous.character.debuffs.filter((debuff) => debuff !== 'Туман сомнений');

        return withTimestamp({
          ...previous,
          activeGoal: previous.activeGoal
            ? { ...previous.activeGoal, status: allReported ? 'completed' : 'active' }
            : undefined,
          activePlan: { ...previous.activePlan, missions },
          checkIns: [
            {
              id: `checkin-${Date.now().toString(36)}`,
              missionId,
              outcome,
              note: note?.trim() || undefined,
              xpDelta,
              energyDelta,
              createdAt: new Date().toISOString(),
            },
            ...previous.checkIns,
          ],
          character: {
            ...previous.character,
            xp,
            level: Math.floor(xp / 100) + 1,
            energy: Math.max(0, Math.min(100, previous.character.energy + energyDelta)),
            streak: outcome === 'completed' ? previous.character.streak + 1 : 0,
            worldLight: Math.max(
              0,
              Math.min(
                100,
                previous.character.worldLight +
                  (outcome === 'completed' ? 7 : outcome === 'partial' ? 2 : -5),
              ),
            ),
            buffs:
              outcome === 'completed'
                ? Array.from(new Set([...previous.character.buffs, 'Импульс']))
                : previous.character.buffs.filter((buff) => buff !== 'Импульс'),
            debuffs: newDebuffs,
          },
          recovery:
            outcome === 'skipped'
              ? {
                  sourceMissionId: missionId,
                  title: 'Развеять туман',
                  description: 'Сделай двухминутную версию следующего шага. Это не отменит правду, но вернёт движение.',
                  xp: 8,
                }
              : undefined,
        });
      });
    };

    const completeRecovery: AppContextValue['completeRecovery'] = () => {
      setState((previous) => {
        if (!previous.recovery) return previous;
        const xp = previous.character.xp + previous.recovery.xp;
        return withTimestamp({
          ...previous,
          recovery: undefined,
          character: {
            ...previous.character,
            xp,
            level: Math.floor(xp / 100) + 1,
            energy: Math.min(100, previous.character.energy + 8),
            debuffs: previous.character.debuffs.filter((debuff) => debuff !== 'Туман сомнений'),
            buffs: Array.from(new Set([...previous.character.buffs, 'Возвращение'])),
          },
        });
      });
    };

    const setNotificationsEnabled: AppContextValue['setNotificationsEnabled'] = (enabled) => {
      setState((previous) =>
        withTimestamp({
          ...previous,
          settings: { ...previous.settings, notificationsEnabled: enabled },
        }),
      );
    };

    const startNewGoal: AppContextValue['startNewGoal'] = () => {
      setState((previous) =>
        withTimestamp({
          ...previous,
          activeGoal: undefined,
          activePlan: undefined,
          checkIns: [],
          recovery: undefined,
        }),
      );
    };

    const resetProgress: AppContextValue['resetProgress'] = async () => {
      await disableDailyReminder();
      await storage.removeItem(STORAGE_KEY);
      setState({ ...INITIAL_STATE, lastUpdatedAt: new Date().toISOString() });
    };

    return {
      state,
      isHydrated,
      currentMission: getCurrentMission(state),
      completedCount:
        state.activePlan?.missions.filter((mission) => mission.outcome === 'completed').length ?? 0,
      finishOnboarding,
      createGoal,
      reportMission,
      completeRecovery,
      startNewGoal,
      setNotificationsEnabled,
      resetProgress,
    };
  }, [isHydrated, state]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
