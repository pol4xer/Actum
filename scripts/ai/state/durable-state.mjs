import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const STATE_VERSION = 1;
export const DURABLE_STATE_TTLS = Object.freeze({
  planCacheMs: 30 * 60_000,
  // One research brief belongs to the whole program, including a 12-cycle year.
  // Keep it beyond the longest selectable duration so later monthly cycles do
  // not create another paid web-search request.
  researchCacheMs: 400 * 24 * 60 * 60_000,
  backgroundJobMs: 2 * 60 * 60_000,
  ambiguousCreateMs: 2 * 60 * 60_000,
  // Completed responses are the paid artifact. Keep them long enough for a
  // local validator fix to re-read the response without another generation.
  stageResultMs: 7 * 24 * 60 * 60_000,
});

/**
 * Owns every persisted collection for one server import. The returned API uses
 * domain operations so the composition root cannot mutate the backing Maps.
 */
export function createDurableState({
  stateFile,
  logger = console,
  now = Date.now,
  ttls = DURABLE_STATE_TTLS,
} = {}) {
  if (typeof stateFile !== 'string' || !stateFile) {
    throw new TypeError('stateFile is required');
  }

  const planCache = new Map();
  const researchCache = new Map();
  const backgroundJobs = new Map();
  const ambiguousCreates = new Map();
  const stageResults = new Map();
  let persistenceHealthy = true;

  restorePersistentState();

  return Object.freeze({
    isHealthy: () => persistenceHealthy,
    stats: () => ({
      cachedPlans: planCache.size,
      cachedResearch: researchCache.size,
      resumableJobs: backgroundJobs.size,
      guardedCreates: ambiguousCreates.size,
      cachedStageResults: stageResults.size,
    }),
    readPlan(cacheKey) {
      return readCache(planCache, cacheKey);
    },
    readResearch(cacheKey) {
      return readCache(researchCache, cacheKey);
    },
    savePlan(cacheKey, result) {
      writeCache(planCache, cacheKey, result, ttls.planCacheMs);
    },
    saveResearch(cacheKey, result) {
      writeCache(researchCache, cacheKey, result, ttls.researchCacheMs);
    },
    readStageResult(stageKey) {
      return readExpiringEntry(stageResults, stageKey);
    },
    readBackgroundJob(stageKey) {
      return readExpiringEntry(backgroundJobs, stageKey);
    },
    readCreateGuard(stageKey) {
      return readExpiringEntry(ambiguousCreates, stageKey);
    },
    armCreateGuard(stageKey, requestId, code = 'create_started') {
      writeExpiringEntry(
        ambiguousCreates,
        stageKey,
        { requestId, code },
        ttls.ambiguousCreateMs,
      );
    },
    clearCreateGuard(stageKey) {
      deletePersistedEntry(ambiguousCreates, stageKey);
    },
    recordBackgroundJob(stageKey, responseId, requestId) {
      backgroundJobs.delete(stageKey);
      backgroundJobs.set(stageKey, {
        responseId,
        requestId,
        expiresAt: now() + ttls.backgroundJobMs,
      });
      ambiguousCreates.delete(stageKey);
      persistState();
    },
    recordStageResult(stageKey, payload, requestId, inputSnapshot) {
      stageResults.delete(stageKey);
      stageResults.set(stageKey, {
        payload,
        requestId,
        inputSnapshot,
        expiresAt: now() + ttls.stageResultMs,
      });
      backgroundJobs.delete(stageKey);
      ambiguousCreates.delete(stageKey);
      persistState();
    },
    latestCompletedStage,
  });

  function readCache(cache, cacheKey) {
    const entry = cache.get(cacheKey);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      cache.delete(cacheKey);
      persistState();
      return undefined;
    }
    return entry.result;
  }

  function writeCache(cache, cacheKey, result, ttlMs) {
    cache.delete(cacheKey);
    cache.set(cacheKey, { result, expiresAt: now() + ttlMs });
    persistState();
  }

  function readExpiringEntry(cache, key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      persistState();
      return undefined;
    }
    return entry;
  }

  function writeExpiringEntry(cache, key, value, ttlMs) {
    cache.delete(key);
    cache.set(key, { ...value, expiresAt: now() + ttlMs });
    persistState();
  }

  function deletePersistedEntry(cache, key) {
    if (cache.delete(key)) persistState();
  }

  function latestCompletedStage(stage, completedBefore = Number.POSITIVE_INFINITY) {
    const prefix = `${stage}\u0000`;
    return [...stageResults]
      .filter(
        ([key, entry]) =>
          key.startsWith(prefix) &&
          entry?.payload?.status === 'completed' &&
          Number(entry.payload?.completed_at || entry.payload?.created_at || 0) <= completedBefore,
      )
      .map(([, entry]) => entry)
      .sort(
        (left, right) =>
          Number(right.payload?.completed_at || right.payload?.created_at || 0) -
          Number(left.payload?.completed_at || left.payload?.created_at || 0),
      )[0];
  }

  function restorePersistentState() {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (state?.version !== STATE_VERSION) {
        throw new Error('unsupported state version');
      }
      restoreMap(planCache, state.planCache);
      restoreMap(researchCache, state.researchCache);
      restoreMap(backgroundJobs, state.backgroundJobs);
      restoreMap(ambiguousCreates, state.ambiguousCreates);
      restoreMap(stageResults, state.stageResults, { recoverCompletedStages: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      persistenceHealthy = false;
      logger.warn('[actum-ai] durable_state_load_failed state_ignored=true paid_requests_blocked=true');
    }
  }

  function restoreMap(cache, entries, { recoverCompletedStages = false } = {}) {
    if (!Array.isArray(entries)) return;
    const currentTime = now();
    for (const pair of entries) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [key, entry] = pair;
      if (typeof key !== 'string' || key.length > 200) continue;
      if (!entry || typeof entry !== 'object') continue;
      let restoredEntry = entry;
      if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= currentTime) {
        const completedAtMs = Number(entry.payload?.completed_at) * 1000;
        const recoveredExpiresAt = completedAtMs + ttls.stageResultMs;
        if (
          !recoverCompletedStages ||
          entry.payload?.status !== 'completed' ||
          !Number.isFinite(completedAtMs) ||
          recoveredExpiresAt <= currentTime
        ) {
          continue;
        }
        restoredEntry = { ...entry, expiresAt: recoveredExpiresAt };
      }
      cache.set(key, restoredEntry);
    }
  }

  function persistState() {
    const temporaryFile = `${stateFile}.${process.pid}.${now()}.tmp`;
    try {
      pruneExpiredEntries();
      mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 });
      writeFileSync(
        temporaryFile,
        JSON.stringify(
          {
            version: STATE_VERSION,
            savedAt: new Date().toISOString(),
            planCache: [...planCache],
            researchCache: [...researchCache],
            backgroundJobs: [...backgroundJobs],
            ambiguousCreates: [...ambiguousCreates],
            stageResults: [...stageResults],
          },
          null,
          2,
        ),
        { encoding: 'utf8', mode: 0o600 },
      );
      renameSync(temporaryFile, stateFile);
      persistenceHealthy = true;
    } catch (cause) {
      persistenceHealthy = false;
      try {
        unlinkSync(temporaryFile);
      } catch {
        // The temporary file may not have been created.
      }
      throw new Error('Не удалось надёжно сохранить состояние AI-запроса.', { cause });
    }
  }

  function pruneExpiredEntries() {
    const currentTime = now();
    for (const cache of [
      planCache,
      researchCache,
      backgroundJobs,
      ambiguousCreates,
      stageResults,
    ]) {
      for (const [key, entry] of cache) {
        if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= currentTime) {
          cache.delete(key);
        }
      }
    }
  }
}
