import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PLAN_CONTRACT_VERSION, PLAN_SCHEMA } from './ai/contracts/plan-v1.mjs';
import {
  buildPlanInstructions,
  PROMPT_VERSION,
  RESEARCH_INSTRUCTIONS,
} from './ai/prompts/plan-v1.mjs';
import {
  createOpenAIResponse,
  extractOutputText,
  extractWebSources,
  OpenAIRequestError,
  responseMeta,
  safeErrorDetails,
} from './ai/providers/openai-responses.mjs';

const PORT = Number(process.env.ACTUM_AI_PORT || 8787);
const HOST = process.env.ACTUM_AI_HOST || '127.0.0.1';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PLAN_CACHE_TTL_MS = 30 * 60_000;
const RESEARCH_CACHE_TTL_MS = 2 * 60 * 60_000;
const BACKGROUND_JOB_TTL_MS = 2 * 60 * 60_000;
const AMBIGUOUS_CREATE_TTL_MS = 2 * 60 * 60_000;
const STAGE_RESULT_TTL_MS = 2 * 60 * 60_000;
const MAX_CONCURRENT_PLANS = 2;
const RESEARCH_TIMEOUT_MS = 9 * 60_000;
const PLANNING_TIMEOUT_MS = 9 * 60_000;
const STATE_VERSION = 1;
const STATE_FILE =
  process.env.ACTUM_AI_STATE_FILE ||
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '.actum', 'ai-state.json');
const planCache = new Map();
const researchCache = new Map();
const backgroundJobs = new Map();
const ambiguousCreates = new Map();
const stageResults = new Map();
const inFlightPlans = new Map();
let statePersistenceHealthy = true;

restorePersistentState();

export async function handleRequest(request, response) {
  setCors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  const pathname = new URL(request.url || '/', `http://${HOST}:${PORT}`).pathname;
  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      configured: Boolean(OPENAI_API_KEY),
      model: MODEL,
      researchModel: RESEARCH_MODEL,
      promptVersion: PROMPT_VERSION,
      contractVersion: PLAN_CONTRACT_VERSION,
      transport: 'background-polling',
      inFlightRequests: inFlightPlans.size,
      cachedPlans: planCache.size,
      cachedResearch: researchCache.size,
      resumableJobs: backgroundJobs.size,
      guardedCreates: ambiguousCreates.size,
      cachedStageResults: stageResults.size,
      durableState: statePersistenceHealthy,
    });
    return;
  }

  if (request.method !== 'POST' || pathname !== '/plan') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const requestId = requestIdFromRequest(request);
  if (!statePersistenceHealthy) {
    sendJson(response, 503, {
      requestId,
      error:
        'Actum заблокировал платный запрос: локальное состояние защиты `.actum/ai-state.json` не удалось прочитать или надёжно сохранить.',
      code: 'durable_state_unavailable',
    });
    return;
  }
  if (!OPENAI_API_KEY) {
    sendJson(response, 503, {
      requestId,
      error: 'Добавь OPENAI_API_KEY в файл .env.local и перезапусти AI-сервер.',
    });
    return;
  }

  const startedAt = Date.now();
  console.log(`[actum-ai] ${requestId} received`);
  response.once('close', () => {
    if (!response.writableEnded) {
      console.warn(`[actum-ai] ${requestId} client_disconnected work_continues=true`);
    }
  });

  let cacheKey;
  try {
    const input = await readJson(request);
    validateInput(input);
    cacheKey = createPlanCacheKey(input);
    const cached = readCachedPlan(cacheKey);
    if (cached) {
      console.log(
        `[actum-ai] ${requestId} cache_hit original_request=${cached.meta.requestId || 'unknown'}`,
      );
      sendJson(response, 200, cached);
      return;
    }

    let active = inFlightPlans.get(cacheKey);
    if (active) {
      console.log(
        `[actum-ai] ${requestId} inflight_join original_request=${active.requestId}`,
      );
    } else {
      if (inFlightPlans.size >= MAX_CONCURRENT_PLANS) {
        sendJson(response, 429, {
          requestId,
          error: 'AI-сервер уже собирает два плана. Дождись завершения одного из них.',
          code: 'gateway_busy',
        });
        return;
      }
      const promise = createPlan(input, requestId, startedAt, cacheKey)
        .then((result) => {
          cachePlan(cacheKey, result);
          return result;
        })
        .finally(() => {
          if (inFlightPlans.get(cacheKey)?.promise === promise) {
            inFlightPlans.delete(cacheKey);
          }
        });
      active = { requestId, promise };
      inFlightPlans.set(cacheKey, active);
    }

    const result = await active.promise;
    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка AI-сервера.';
    const providerCode = error instanceof OpenAIRequestError ? error.code : undefined;
    const researchPreserved = Boolean(cacheKey && readCachedResearch(cacheKey));
    const retryGuarded = Boolean(error?.retryGuarded || error?.code === 'ambiguous_create');
    const diagnostics = safeErrorDetails(error);
    console.error(
      [
        `[actum-ai] ${requestId} failed`,
        `duration_ms=${Math.max(0, Date.now() - startedAt)}`,
        `stage=${safeLogToken(error?.stage) || 'local'}`,
        `operation=${safeLogToken(error?.operation) || 'local'}`,
        `stage_duration_ms=${nonNegativeLogNumber(error?.durationMs)}`,
        `status=${nonNegativeLogNumber(error?.status)}`,
        `code=${safeLogToken(providerCode) || 'local_error'}`,
        `response=${safeLogToken(error?.providerResponseId) || 'unknown'}`,
        `openai_request=${safeLogToken(error?.providerRequestId) || 'unknown'}`,
        `cause=${formatDiagnostics(diagnostics)}`,
        `research_preserved=${researchPreserved}`,
        `retry_guarded=${retryGuarded}`,
        `message=${
          error instanceof OpenAIRequestError ? 'provider_error' : JSON.stringify(message)
        }`,
      ].join(' '),
    );
    const publicMessage =
      retryGuarded
        ? `${message} Actum не создаст такой же OpenAI response в течение 2 часов, чтобы исключить двойное списание.`
        : researchPreserved && error?.stage === 'planning'
          ? `${message} Web-research сохранён: повтор не запустит новый поиск.`
          : message;
    sendJson(response, providerHttpStatus(error), {
      requestId,
      error: publicMessage,
      code: providerCode,
      stage: error instanceof OpenAIRequestError ? error.stage : undefined,
      researchPreserved,
      retryGuarded,
    });
  }
}

export const server = createServer(handleRequest);

if (isDirectRun()) {
  server.listen(PORT, HOST, () => {
    const status = OPENAI_API_KEY ? 'OpenAI key loaded' : 'OPENAI_API_KEY is missing';
    console.log(`Actum AI server: http://${HOST}:${PORT} · ${MODEL} · ${status}`);
    console.log(
      `[actum-ai] prompt=${PROMPT_VERSION} contract=${PLAN_CONTRACT_VERSION} transport=background-polling durable_state=${statePersistenceHealthy ? 'ready' : 'error'}`,
    );
  });
}

async function createPlan(input, requestId, startedAt, cacheKey) {
  const researchMode = input.researchMode === 'quick' ? 'quick' : 'web';
  let research = {
    brief: '',
    sources: [],
    meta: { webSearchCount: 0 },
  };

  if (researchMode === 'web') {
    const cachedResearch = readCachedResearch(cacheKey);
    if (cachedResearch) {
      research = cachedResearch;
      console.log(
        `[actum-ai] ${requestId} research_cache_hit response=${research.meta.providerResponseId || 'unknown'} searches=${research.meta.webSearchCount} sources=${research.sources.length}`,
      );
    } else {
      console.log(`[actum-ai] ${requestId} researching model=${RESEARCH_MODEL}`);
      research = await requestResearch(input, requestId, providerStageKey(cacheKey, 'research'));
      cacheResearch(cacheKey, research);
      console.log(
        `[actum-ai] ${requestId} researched response=${research.meta.providerResponseId || 'unknown'} searches=${research.meta.webSearchCount} sources=${research.sources.length} preserved=true`,
      );
    }
  }

  console.log(`[actum-ai] ${requestId} planning model=${MODEL}`);
  const planResponse = await requestStructuredPlan(
    input,
    research,
    requestId,
    providerStageKey(cacheKey, 'planning'),
  );
  const outputText = extractOutputText(planResponse);
  if (!outputText) {
    throw invalidProviderOutput(
      'OpenAI завершил запрос без структурированного плана.',
      'upstream_missing_plan',
      'planning',
      planResponse,
    );
  }

  let plan;
  try {
    plan = JSON.parse(outputText);
  } catch (cause) {
    throw invalidProviderOutput(
      'OpenAI завершил запрос, но вернул нечитаемый JSON-план.',
      'upstream_invalid_plan_json',
      'planning',
      planResponse,
      cause,
    );
  }
  try {
    validateMissionExecution(plan, input.dailyMinutes);
  } catch (cause) {
    throw invalidProviderOutput(
      cause instanceof Error ? cause.message : 'План не прошёл локальную проверку.',
      'upstream_invalid_plan_contract',
      'planning',
      planResponse,
      cause,
    );
  }

  const planMeta = responseMeta(planResponse);
  const durationMs = Math.max(0, Date.now() - startedAt);
  const inputTokens = sumNumbers(research.meta.inputTokens, planMeta.inputTokens);
  const outputTokens = sumNumbers(research.meta.outputTokens, planMeta.outputTokens);
  const webSearchCount = research.meta.webSearchCount || 0;

  console.log(
    `[actum-ai] ${requestId} completed response=${planMeta.providerResponseId || 'unknown'} model=${MODEL} duration_ms=${durationMs} searches=${webSearchCount} input_tokens=${inputTokens || 0} output_tokens=${outputTokens || 0}`,
  );

  return {
    plan,
    meta: {
      requestId,
      providerResponseId: planMeta.providerResponseId,
      researchResponseId: research.meta.providerResponseId,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      contractVersion: PLAN_CONTRACT_VERSION,
      durationMs,
      webSearchCount,
      inputTokens,
      outputTokens,
      sources: research.sources,
    },
  };
}

async function requestResearch(input, requestId, stageKey) {
  const payload = await executeProviderStage({
    stageKey,
    stage: 'research',
    timeoutMs: RESEARCH_TIMEOUT_MS,
    requestId,
    body: {
      model: RESEARCH_MODEL,
      reasoning: { effort: 'medium' },
      store: false,
      safety_identifier: 'actum-local-mvp',
      instructions: RESEARCH_INSTRUCTIONS,
      input: JSON.stringify({
        goal: input.prompt.trim(),
        startingPoint: input.currentLevel,
        minutesPerMission: input.dailyMinutes,
        horizonDays: input.horizonDays,
      }),
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      tool_choice: 'required',
      max_tool_calls: 4,
      text: { verbosity: 'medium' },
    },
  });

  const brief = extractOutputText(payload);
  if (!brief) {
    throw invalidProviderOutput(
      'Web-research завершился без итогового брифа.',
      'upstream_missing_research_brief',
      'research',
      payload,
    );
  }

  return {
    brief,
    sources: extractWebSources(payload),
    meta: responseMeta(payload),
  };
}

async function requestStructuredPlan(input, research, requestId, stageKey) {
  return executeProviderStage({
    stageKey,
    stage: 'planning',
    timeoutMs: PLANNING_TIMEOUT_MS,
    requestId,
    body: {
      model: MODEL,
      reasoning: { effort: research.brief ? 'medium' : 'low' },
      store: false,
      safety_identifier: 'actum-local-mvp',
      instructions: buildPlanInstructions({ hasResearch: Boolean(research.brief) }),
      input: JSON.stringify({
        goal: input.prompt.trim(),
        startingPoint: input.currentLevel,
        minutesPerMission: input.dailyMinutes,
        horizonDays: input.horizonDays,
        researchBrief: research.brief || null,
        verifiedSources: research.sources,
      }),
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'actum_goal_plan',
          strict: true,
          schema: PLAN_SCHEMA,
        },
      },
    },
  });
}

async function executeProviderStage({ stageKey, stage, timeoutMs, requestId, body }) {
  const completed = readExpiringEntry(stageResults, stageKey);
  if (completed) {
    console.log(
      `[actum-ai] ${requestId} stage=${stage} stage_result_cache_hit original_request=${completed.requestId}`,
    );
    return completed.payload;
  }

  const resumable = readExpiringEntry(backgroundJobs, stageKey);
  if (resumable) {
    console.log(
      `[actum-ai] ${requestId} stage=${stage} resume_pending response=${resumable.responseId} original_request=${resumable.requestId}`,
    );
  } else {
    const guarded = readExpiringEntry(ambiguousCreates, stageKey);
    if (guarded) {
      throw new OpenAIRequestError(
        'Предыдущий POST к OpenAI оборвался до получения response ID, поэтому его платный статус неизвестен.',
        {
          status: 409,
          code: 'ambiguous_create',
          stage,
          operation: 'guard',
          durationMs: 0,
        },
      );
    }

    // Arm the guard before the paid POST so a process kill cannot erase uncertainty.
    writeExpiringEntry(
      ambiguousCreates,
      stageKey,
      { requestId, code: 'create_started' },
      AMBIGUOUS_CREATE_TTL_MS,
    );
  }
  const progressLogger = createProgressLogger(requestId);

  try {
    const payload = await createOpenAIResponse({
      apiKey: OPENAI_API_KEY,
      body,
      stage,
      timeoutMs,
      resumeResponseId: resumable?.responseId,
      onResponseId: (event) => {
        recordBackgroundJob(stageKey, event.responseId, requestId);
      },
      onProgress: progressLogger,
    });
    recordStageResult(stageKey, payload, requestId);
    return payload;
  } catch (error) {
    if (error instanceof OpenAIRequestError) {
      if (error.providerResponseId) {
        recordBackgroundJob(stageKey, error.providerResponseId, requestId);
      }
      if (isAmbiguousCreateFailure(error)) {
        writeExpiringEntry(
          ambiguousCreates,
          stageKey,
          { requestId, code: error.code },
          AMBIGUOUS_CREATE_TTL_MS,
        );
        error.retryGuarded = true;
      } else if (error.operation === 'create' && !error.providerResponseId) {
        deletePersistedEntry(ambiguousCreates, stageKey);
      }
      if (isTerminalProviderFailure(error)) {
        deletePersistedEntry(backgroundJobs, stageKey);
      }
    }
    throw error;
  }
}

function validateMissionExecution(plan, dailyMinutes) {
  if (!Array.isArray(plan?.chapters)) throw new Error('План не содержит главы.');
  for (const chapter of plan.chapters) {
    if (!Array.isArray(chapter?.missions)) throw new Error('Глава не содержит миссии.');
    for (const mission of chapter.missions) {
      const execution = mission?.execution;
      if (execution?.kind === 'timer') {
        if (!Number.isInteger(execution.durationSeconds) || execution.durationSeconds < 1) {
          throw new Error('Таймерная миссия пришла без корректной длительности.');
        }
        if (execution.durationSeconds > dailyMinutes * 60) {
          throw new Error('Таймерная миссия превышает выбранный дневной лимит.');
        }
      } else if (execution?.kind === 'manual') {
        execution.durationSeconds = null;
      } else {
        throw new Error('Миссия пришла с неизвестным способом выполнения.');
      }
    }
  }
}

function validateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Некорректный запрос.');
  if (typeof input.prompt !== 'string' || input.prompt.trim().length < 5) {
    throw new Error('Цель слишком короткая.');
  }
  if (![10, 20, 30].includes(input.dailyMinutes)) throw new Error('Некорректный лимит времени.');
  if (![7, 14, 28].includes(input.horizonDays)) throw new Error('Некорректный горизонт.');
  if (!['starting', 'some-experience', 'returning'].includes(input.currentLevel)) {
    throw new Error('Некорректная точка старта.');
  }
  if (input.researchMode != null && !['quick', 'web'].includes(input.researchMode)) {
    throw new Error('Некорректный режим исследования.');
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > 20_000) {
        settled = true;
        reject(new Error('Запрос слишком большой.'));
      }
    });
    request.on('end', () => {
      if (settled) return;
      try {
        settled = true;
        resolve(JSON.parse(body));
      } catch {
        settled = true;
        reject(new Error('Некорректный JSON.'));
      }
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Actum-Request-Id');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sumNumbers(...values) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : undefined;
}

function createPlanCacheKey(input) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        promptVersion: PROMPT_VERSION,
        contractVersion: PLAN_CONTRACT_VERSION,
        model: MODEL,
        researchModel: RESEARCH_MODEL,
        prompt: input.prompt.trim(),
        currentLevel: input.currentLevel,
        dailyMinutes: input.dailyMinutes,
        horizonDays: input.horizonDays,
        researchMode: input.researchMode === 'quick' ? 'quick' : 'web',
      }),
    )
    .digest('hex');
}

function providerStageKey(cacheKey, stage) {
  return `${stage}\u0000${cacheKey}`;
}

function readCachedPlan(cacheKey) {
  return readCache(planCache, cacheKey);
}

function readCachedResearch(cacheKey) {
  return readCache(researchCache, cacheKey);
}

function readCache(cache, cacheKey) {
  const entry = cache.get(cacheKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    persistState();
    return undefined;
  }
  return entry.result;
}

function cachePlan(cacheKey, result) {
  writeCache(planCache, cacheKey, result, PLAN_CACHE_TTL_MS);
}

function cacheResearch(cacheKey, result) {
  writeCache(researchCache, cacheKey, result, RESEARCH_CACHE_TTL_MS);
}

function writeCache(cache, cacheKey, result, ttlMs) {
  cache.delete(cacheKey);
  cache.set(cacheKey, { result, expiresAt: Date.now() + ttlMs });
  persistState();
}

function readExpiringEntry(cache, key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    persistState();
    return undefined;
  }
  return entry;
}

function writeExpiringEntry(cache, key, value, ttlMs) {
  cache.delete(key);
  cache.set(key, { ...value, expiresAt: Date.now() + ttlMs });
  persistState();
}

function recordBackgroundJob(stageKey, responseId, requestId) {
  backgroundJobs.delete(stageKey);
  backgroundJobs.set(stageKey, {
    responseId,
    requestId,
    expiresAt: Date.now() + BACKGROUND_JOB_TTL_MS,
  });
  ambiguousCreates.delete(stageKey);
  persistState();
}

function recordStageResult(stageKey, payload, requestId) {
  stageResults.delete(stageKey);
  stageResults.set(stageKey, {
    payload,
    requestId,
    expiresAt: Date.now() + STAGE_RESULT_TTL_MS,
  });
  backgroundJobs.delete(stageKey);
  ambiguousCreates.delete(stageKey);
  persistState();
}

function deletePersistedEntry(cache, key) {
  if (cache.delete(key)) persistState();
}

function isAmbiguousCreateFailure(error) {
  return (
    error.operation === 'create' &&
    !error.providerResponseId &&
    [
      'upstream_network_error',
      'upstream_timeout',
      'upstream_read_error',
      'upstream_invalid_json',
      'upstream_invalid_response',
    ].includes(error.code)
  );
}

function isTerminalProviderFailure(error) {
  return (
    error.terminal === true ||
    error.status === 404 ||
    error.code === 'refusal' ||
    error.code === 'openai_http_404' ||
    error.code === 'upstream_invalid_response_id' ||
    /^response_(failed|cancelled|incomplete)$/.test(error.code || '')
  );
}

function invalidProviderOutput(message, code, stage, payload, cause) {
  const meta = responseMeta(payload);
  return new OpenAIRequestError(message, {
    status: 502,
    code,
    stage,
    operation: 'validate',
    durationMs: 0,
    providerResponseId: meta.providerResponseId,
    cause,
  });
}

function requestIdFromRequest(request) {
  const rawHeader = request.headers?.['x-actum-request-id'];
  const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof candidate === 'string' && /^actum_[A-Za-z0-9_-]{8,80}$/.test(candidate)) {
    return candidate;
  }
  return `actum_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

function createProgressLogger(requestId) {
  return (event) => {
    const base = [
      `[actum-ai] ${requestId}`,
      `stage=${safeLogToken(event.stage) || 'unknown'}`,
      `response=${safeLogToken(event.responseId) || 'unknown'}`,
      `status=${safeLogToken(event.status) || 'unknown'}`,
      `elapsed_ms=${nonNegativeLogNumber(event.elapsedMs)}`,
    ];
    if (event.type === 'poll_retry') {
      base.push(
        `poll_retry=${nonNegativeLogNumber(event.attempt)}`,
        `retry_in_ms=${nonNegativeLogNumber(event.retryDelayMs)}`,
        `cause=${formatDiagnostics(event.error)}`,
      );
      if (event.providerRequestId) {
        base.push(`openai_request=${safeLogToken(event.providerRequestId) || 'unknown'}`);
      }
      console.warn(base.join(' '));
      return;
    }
    if (event.providerRequestId) {
      base.push(`openai_request=${safeLogToken(event.providerRequestId) || 'unknown'}`);
    }
    console.log(base.join(' '));
  };
}

function providerHttpStatus(error) {
  if (!(error instanceof OpenAIRequestError)) return 400;
  if (error.code === 'ambiguous_create') return 409;
  if (error.code === 'refusal') return 422;
  if (error.code === 'upstream_timeout') return 504;
  return 502;
}

function formatDiagnostics(details) {
  if (!details || typeof details !== 'object') return 'none';
  return [
    details.name,
    details.code,
    details.causeName,
    details.causeCode,
    details.rootCauseName,
    details.rootCauseCode,
  ]
    .map(safeLogToken)
    .filter(Boolean)
    .join('>') || 'none';
}

function safeLogToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:_-]{1,180}$/.test(value)
    ? value
    : undefined;
}

function nonNegativeLogNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function restorePersistentState() {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (state?.version !== STATE_VERSION) {
      throw new Error('unsupported state version');
    }
    restoreMap(planCache, state.planCache);
    restoreMap(researchCache, state.researchCache);
    restoreMap(backgroundJobs, state.backgroundJobs);
    restoreMap(ambiguousCreates, state.ambiguousCreates);
    restoreMap(stageResults, state.stageResults);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    statePersistenceHealthy = false;
    console.warn(
      '[actum-ai] durable_state_load_failed state_ignored=true paid_requests_blocked=true',
    );
  }
}

function restoreMap(cache, entries) {
  if (!Array.isArray(entries)) return;
  const now = Date.now();
  for (const pair of entries) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [key, entry] = pair;
    if (typeof key !== 'string' || key.length > 200) continue;
    if (!entry || typeof entry !== 'object') continue;
    if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) continue;
    cache.set(key, entry);
  }
}

function persistState() {
  const temporaryFile = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    pruneExpiredEntries();
    mkdirSync(dirname(STATE_FILE), { recursive: true, mode: 0o700 });
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
    renameSync(temporaryFile, STATE_FILE);
    statePersistenceHealthy = true;
  } catch (cause) {
    statePersistenceHealthy = false;
    try {
      unlinkSync(temporaryFile);
    } catch {
      // The temporary file may not have been created.
    }
    throw new Error('Не удалось надёжно сохранить состояние AI-запроса.', { cause });
  }
}

function pruneExpiredEntries() {
  const now = Date.now();
  for (const cache of [
    planCache,
    researchCache,
    backgroundJobs,
    ambiguousCreates,
    stageResults,
  ]) {
    for (const [key, entry] of cache) {
      if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
        cache.delete(key);
      }
    }
  }
}

function isDirectRun() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}
