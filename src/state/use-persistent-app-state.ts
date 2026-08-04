import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from 'react';

import type { AppState } from '@/domain/types';

import {
  appStateReducer,
  type AppStateAction,
} from './app-state';
import type { RestoreAppStateResult } from './app-state-codec';
import { createInitialAppState } from './app-state-defaults';
import type { AppStateRepository } from './app-state-repository';

export type HydrationIssue =
  | Extract<RestoreAppStateResult, { status: 'blocked' }>
  | { reason: 'storage-error' };

export type PersistenceStatus = 'loading' | 'saving' | 'saved' | 'error';

export type PersistentAppStateStore = {
  state: AppState;
  dispatch: Dispatch<AppStateAction>;
  isHydrated: boolean;
  hydrationIssue?: HydrationIssue;
  persistenceStatus: PersistenceStatus;
  retryPersistence(): Promise<boolean>;
  resetPersistedState(
    nextState: AppState,
    beforeClear?: () => Promise<void>,
  ): Promise<void>;
};

/** Owns hydration and serialized writes; React context remains only a composition facade. */
export function usePersistentAppState(
  repository: AppStateRepository,
): PersistentAppStateStore {
  const [state, dispatch] = useReducer(appStateReducer, undefined, () => createInitialAppState());
  const [isHydrated, setIsHydrated] = useState(false);
  const [persistenceEnabled, setPersistenceEnabled] = useState(false);
  const [hydrationIssue, setHydrationIssue] = useState<HydrationIssue>();
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('loading');
  const latestStateRef = useRef(state);
  const pendingPersistenceRef = useRef<AppState | undefined>(undefined);
  const persistenceWriteRef = useRef<Promise<boolean> | undefined>(undefined);
  latestStateRef.current = state;

  const flushPersistence = useCallback((): Promise<boolean> => {
    if (persistenceWriteRef.current) return persistenceWriteRef.current;

    const write = (async () => {
      try {
        while (pendingPersistenceRef.current !== undefined) {
          const snapshot = pendingPersistenceRef.current;
          pendingPersistenceRef.current = undefined;
          await repository.save(snapshot);
        }
        setPersistenceStatus('saved');
        return true;
      } catch {
        pendingPersistenceRef.current = latestStateRef.current;
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
  }, [repository]);

  useEffect(() => {
    let active = true;
    repository
      .load()
      .then((restored) => {
        if (!active) return;
        if (restored.status === 'ready') {
          dispatch({ type: 'reset', state: restored.state });
          setPersistenceEnabled(true);
          setHydrationIssue(undefined);
          setPersistenceStatus('saved');
        } else {
          // Preserve unknown/corrupt bytes until an explicit reset.
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
  }, [repository]);

  useEffect(() => {
    if (!isHydrated || !persistenceEnabled) return;
    pendingPersistenceRef.current = state;
    setPersistenceStatus('saving');
    void flushPersistence();
  }, [flushPersistence, isHydrated, persistenceEnabled, state]);

  const retryPersistence = useCallback(async () => {
    if (hydrationIssue && hydrationIssue.reason !== 'storage-error') return false;
    pendingPersistenceRef.current = latestStateRef.current;
    setPersistenceStatus('saving');
    const saved = await flushPersistence();
    if (saved) {
      setHydrationIssue(undefined);
      setPersistenceEnabled(true);
    }
    return saved;
  }, [flushPersistence, hydrationIssue]);

  const resetPersistedState = useCallback(
    async (nextState: AppState, beforeClear?: () => Promise<void>) => {
      setPersistenceEnabled(false);
      pendingPersistenceRef.current = undefined;
      await persistenceWriteRef.current;
      await beforeClear?.();
      await repository.clear();
      setHydrationIssue(undefined);
      setPersistenceStatus('saving');
      setPersistenceEnabled(true);
      dispatch({ type: 'reset', state: nextState });
    },
    [repository],
  );

  return {
    state,
    dispatch,
    isHydrated,
    hydrationIssue,
    persistenceStatus,
    retryPersistence,
    resetPersistedState,
  };
}
