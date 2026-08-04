import type { AppState } from '@/domain/types';

import {
  APP_STATE_STORAGE_KEY,
  restoreAppState,
  type RestoreAppStateResult,
} from './app-state-codec';

export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type AppStateRepository = {
  load(): Promise<RestoreAppStateResult>;
  save(state: AppState): Promise<void>;
  clear(): Promise<void>;
};

/** Platform-neutral persistence boundary for the versioned application aggregate. */
export function createAppStateRepository(
  storage: KeyValueStorage,
  storageKey = APP_STATE_STORAGE_KEY,
): AppStateRepository {
  return {
    async load() {
      return restoreAppState(await storage.getItem(storageKey));
    },
    async save(state) {
      await storage.setItem(storageKey, JSON.stringify(state));
    },
    async clear() {
      await storage.removeItem(storageKey);
    },
  };
}
