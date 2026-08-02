import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createPlanSchema, PLAN_CONTRACT_VERSION } from './ai/contracts/plan-v1.mjs';
import {
  BASELINE_PARSER_VERSION,
  parseTrustedBaseline,
} from './ai/contracts/parse-baseline.mjs';
import {
  PLAN_VALIDATOR_VERSION,
  validatePlanActionability,
} from './ai/contracts/validate-plan.mjs';
import {
  buildPlanInstructions,
  PROMPT_VERSION,
  RESEARCH_PROMPT_VERSION,
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
export const AI_PIPELINE_CACHE_IDENTITY = Object.freeze({
  promptVersion: PROMPT_VERSION,
  researchPromptVersion: RESEARCH_PROMPT_VERSION,
  contractVersion: PLAN_CONTRACT_VERSION,
  validatorVersion: PLAN_VALIDATOR_VERSION,
  baselineParserVersion: BASELINE_PARSER_VERSION,
  model: MODEL,
  researchModel: RESEARCH_MODEL,
});
const PLAN_CACHE_TTL_MS = 30 * 60_000;
const RESEARCH_CACHE_TTL_MS = 2 * 60 * 60_000;
const BACKGROUND_JOB_TTL_MS = 2 * 60 * 60_000;
const AMBIGUOUS_CREATE_TTL_MS = 2 * 60 * 60_000;
// Completed provider responses are the paid artifact. Keep them substantially
// longer than the derived research/plan caches so a local validator fix can
// re-read the same response instead of forcing another paid generation.
const STAGE_RESULT_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_CONCURRENT_PLANS = 2;
const RESEARCH_TIMEOUT_MS = 12 * 60_000;
const PLANNING_TIMEOUT_MS = 12 * 60_000;
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
      researchPromptVersion: RESEARCH_PROMPT_VERSION,
      contractVersion: PLAN_CONTRACT_VERSION,
      validatorVersion: PLAN_VALIDATOR_VERSION,
      baselineParserVersion: BASELINE_PARSER_VERSION,
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

  if (request.method === 'GET' && pathname === '/saved-plan/latest') {
    if (!statePersistenceHealthy) {
      sendJson(response, 503, {
        error: 'Локальное состояние сохранённых AI-ответов недоступно.',
        code: 'durable_state_unavailable',
      });
      return;
    }
    try {
      const saved = readLatestSavedPlan();
      if (!saved) {
        sendJson(response, 404, { error: 'Сохранённый plan-v5 не найден.' });
        return;
      }
      sendJson(response, 200, saved);
    } catch (error) {
      console.error(
        `[actum-ai] saved_plan_recovery_failed message=${JSON.stringify(error instanceof Error ? error.message : 'unknown')}`,
      );
      sendJson(response, 422, {
        error: 'Последний сохранённый ответ не прошёл локальную проверку.',
        code: 'saved_plan_invalid',
      });
    }
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
  let researchCacheKey;
  try {
    const input = await readJson(request);
    validateInput(input);
    const reuseOnly = request.headers?.['x-actum-reuse-only'] === 'true';
    cacheKey = createPlanCacheKey(input);
    researchCacheKey = createResearchCacheKey(input);
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
      const promise = createPlan(
        input,
        requestId,
        startedAt,
        cacheKey,
        researchCacheKey,
        reuseOnly,
      )
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
    const researchPreserved = Boolean(
      researchCacheKey && readCachedResearch(researchCacheKey),
    );
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
        `contract_path=${safeLogToken(error?.validationPath) || 'none'}`,
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
      `[actum-ai] prompt=${PROMPT_VERSION} research_prompt=${RESEARCH_PROMPT_VERSION} contract=${PLAN_CONTRACT_VERSION} validator=${PLAN_VALIDATOR_VERSION} baseline_parser=${BASELINE_PARSER_VERSION} transport=background-polling durable_state=${statePersistenceHealthy ? 'ready' : 'error'}`,
    );
  });
}

async function createPlan(input, requestId, startedAt, cacheKey, researchCacheKey, reuseOnly) {
  const researchMode = input.researchMode === 'quick' ? 'quick' : 'web';
  const trustedBaseline = parseTrustedBaseline(input.baseline);
  let research = {
    brief: '',
    sources: [],
    meta: { webSearchCount: 0 },
  };

  if (researchMode === 'web') {
    const cachedResearch = readCachedResearch(researchCacheKey);
    if (cachedResearch) {
      research = cachedResearch;
      console.log(
        `[actum-ai] ${requestId} research_cache_hit response=${research.meta.providerResponseId || 'unknown'} searches=${research.meta.webSearchCount} sources=${research.sources.length}`,
      );
    } else {
      console.log(`[actum-ai] ${requestId} researching model=${RESEARCH_MODEL}`);
      research = await requestResearch(
        input,
        trustedBaseline,
        requestId,
        providerStageKey(researchCacheKey, 'research'),
        reuseOnly,
      );
      cacheResearch(researchCacheKey, research);
      console.log(
        `[actum-ai] ${requestId} researched response=${research.meta.providerResponseId || 'unknown'} searches=${research.meta.webSearchCount} sources=${research.sources.length} preserved=true`,
      );
    }
  }

  console.log(`[actum-ai] ${requestId} planning model=${MODEL}`);
  const planResponse = await requestStructuredPlan(
    input,
    trustedBaseline,
    research,
    requestId,
    providerStageKey(cacheKey, 'planning'),
    reuseOnly,
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
    validatePlanActionability(
      plan,
      input.dailyMinutes,
      input.horizonDays,
      input.baseline,
      input.targetTimeline,
      trustedBaseline,
    );
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

async function requestResearch(input, trustedBaseline, requestId, stageKey, reuseOnly) {
  const payload = await executeProviderStage({
    stageKey,
    stage: 'research',
    timeoutMs: RESEARCH_TIMEOUT_MS,
    requestId,
    reuseOnly,
    body: {
      model: RESEARCH_MODEL,
      reasoning: { effort: 'medium' },
      store: false,
      safety_identifier: 'actum-local-mvp',
      instructions: RESEARCH_INSTRUCTIONS,
      input: JSON.stringify({
        goal: input.prompt.trim(),
        startingPoint: input.currentLevel,
        userBaseline: input.baseline.trim(),
        trustedBaseline,
        targetTimeline: input.targetTimeline.trim(),
        minutesPerMission: input.dailyMinutes,
        horizonDays: input.horizonDays,
      }),
      tools: [{ type: 'web_search', search_context_size: 'high' }],
      tool_choice: 'required',
      max_tool_calls: 6,
      text: { verbosity: 'high' },
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

  const sources = extractWebSources(payload);
  const meta = responseMeta(payload);
  if ((meta.webSearchCount || 0) < 3) {
    throw invalidProviderOutput(
      'Web-research выполнил меньше трёх независимых поисков.',
      'upstream_insufficient_research_searches',
      'research',
      payload,
    );
  }
  if (sources.length < 2) {
    throw invalidProviderOutput(
      'Web-research завершился без двух проверяемых URL-источников.',
      'upstream_missing_research_sources',
      'research',
      payload,
    );
  }

  return {
    brief,
    sources,
    meta,
  };
}

async function requestStructuredPlan(
  input,
  trustedBaseline,
  research,
  requestId,
  stageKey,
  reuseOnly,
) {
  return executeProviderStage({
    stageKey,
    stage: 'planning',
    timeoutMs: PLANNING_TIMEOUT_MS,
    requestId,
    reuseOnly,
    body: {
      model: MODEL,
      reasoning: { effort: research.brief ? 'medium' : 'low' },
      store: false,
      safety_identifier: 'actum-local-mvp',
      instructions: buildPlanInstructions({ hasResearch: Boolean(research.brief) }),
      input: JSON.stringify({
        goal: input.prompt.trim(),
        startingPoint: input.currentLevel,
        userBaseline: input.baseline.trim(),
        trustedBaseline,
        targetTimeline: input.targetTimeline.trim(),
        minutesPerMission: input.dailyMinutes,
        horizonDays: input.horizonDays,
        researchBrief: research.brief || null,
        verifiedSources: research.sources,
      }),
      max_output_tokens: 30_000,
      text: {
        verbosity: 'high',
        format: {
          type: 'json_schema',
          name: 'actum_goal_plan',
          strict: true,
          schema: createPlanSchema(input.dailyMinutes, input.horizonDays),
        },
      },
    },
  });
}

async function executeProviderStage({ stageKey, stage, timeoutMs, requestId, reuseOnly, body }) {
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
    if (reuseOnly) {
      throw new OpenAIRequestError(
        'Сохранённый ответ для бесплатной повторной проверки больше недоступен.',
        {
          status: 409,
          code: 'saved_response_unavailable',
          stage,
          operation: 'guard',
          durationMs: 0,
        },
      );
    }
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
    recordStageResult(stageKey, payload, requestId, createStageInputSnapshot(body.input));
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
      // Keep a known response ID even for a terminal provider outcome. A retry can
      // retrieve the same response without creating and billing a second POST.
    }
    throw error;
  }
}

function validateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Некорректный запрос.');
  if (typeof input.prompt !== 'string' || input.prompt.trim().length < 5) {
    throw new Error('Цель слишком короткая.');
  }
  if (![10, 20, 30, 45, 60].includes(input.dailyMinutes)) {
    throw new Error('Некорректный лимит времени.');
  }
  if (![7, 14, 30].includes(input.horizonDays)) throw new Error('Некорректный горизонт.');
  if (!['starting', 'some-experience', 'returning'].includes(input.currentLevel)) {
    throw new Error('Некорректная точка старта.');
  }
  if (typeof input.baseline !== 'string' || input.baseline.trim().length < 2) {
    throw new Error('Опиши текущую измеренную точку старта.');
  }
  if (input.baseline.trim().length > 500) {
    throw new Error('Описание точки старта слишком длинное.');
  }
  if (typeof input.targetTimeline !== 'string' || input.targetTimeline.trim().length < 2) {
    throw new Error('Укажи желаемый срок большой цели.');
  }
  if (input.targetTimeline.trim().length > 80) {
    throw new Error('Описание срока слишком длинное.');
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
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Actum-Request-Id, X-Actum-Reuse-Only',
  );
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

function readLatestSavedPlan() {
  const planning = latestCompletedStage('planning');
  if (!planning) return undefined;
  const outputText = extractOutputText(planning.payload);
  if (!outputText) return undefined;
  const plan = JSON.parse(outputText);
  const research = latestCompletedStage(
    'research',
    Number(planning.payload?.created_at || planning.payload?.completed_at || Number.POSITIVE_INFINITY),
  );
  const input = inferSavedPlanInput(plan, Boolean(research), planning.inputSnapshot);
  const trustedBaseline = parseTrustedBaseline(input.baseline);
  validatePlanActionability(
    plan,
    input.dailyMinutes,
    input.horizonDays,
    input.baseline,
    input.targetTimeline,
    trustedBaseline,
  );

  const planMeta = responseMeta(planning.payload);
  const researchMeta = research ? responseMeta(research.payload) : {};
  return {
    input,
    plan,
    meta: {
      requestId: planning.requestId || 'actum_saved_plan',
      providerResponseId: planMeta.providerResponseId,
      researchResponseId: researchMeta.providerResponseId,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      contractVersion: PLAN_CONTRACT_VERSION,
      durationMs: 0,
      webSearchCount: researchMeta.webSearchCount || 0,
      inputTokens: sumNumbers(researchMeta.inputTokens, planMeta.inputTokens),
      outputTokens: sumNumbers(researchMeta.outputTokens, planMeta.outputTokens),
      sources: research ? extractWebSources(research.payload).slice(0, 8) : [],
    },
  };
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

function inferSavedPlanInput(plan, hasResearch, inputSnapshot) {
  if (inputSnapshot && typeof inputSnapshot === 'object') {
    const recovered = {
      prompt: inputSnapshot.prompt,
      currentLevel: inputSnapshot.currentLevel,
      baseline: inputSnapshot.baseline,
      targetTimeline: inputSnapshot.targetTimeline,
      dailyMinutes: inputSnapshot.dailyMinutes,
      horizonDays: inputSnapshot.horizonDays,
      researchMode: inputSnapshot.researchMode,
    };
    validateInput(recovered);
    return recovered;
  }
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.days)) {
    throw new Error('saved plan has no calendar');
  }
  const horizonDays = plan.days.length;
  if (![7, 14, 30].includes(horizonDays)) throw new Error('unsupported saved horizon');
  const maximumDayMinutes = Math.max(
    1,
    ...plan.days.map((day) => Number(day?.estimatedMinutes) || 0),
  );
  const dailyMinutes = [10, 20, 30, 45, 60].find((value) => value >= maximumDayMinutes);
  if (!dailyMinutes) throw new Error('saved plan exceeds supported daily limit');
  const baseline = plan.baseline?.userStatement;
  const targetTimeline = plan.targetTimeline;
  if (typeof baseline !== 'string' || typeof targetTimeline !== 'string') {
    throw new Error('saved plan has no baseline or target timeline');
  }
  const narrative = `${plan.title || ''} ${plan.targetMetric || ''} ${plan.summary || ''}`;
  const prompt =
    /задержк[\p{L}\p{M}]*\s+дыхан/iu.test(narrative) && /10\s*мин/iu.test(narrative)
      ? 'Научиться задерживать дыхание на 10 минут'
      : String(plan.title || plan.targetMetric || 'Восстановленная цель Actum');
  const trustedBaseline = parseTrustedBaseline(baseline);
  return {
    prompt,
    currentLevel: trustedBaseline ? 'some-experience' : 'starting',
    baseline,
    targetTimeline,
    dailyMinutes,
    horizonDays,
    researchMode: hasResearch ? 'web' : 'quick',
  };
}

function createStageInputSnapshot(serializedInput) {
  try {
    const input = JSON.parse(serializedInput);
    if (!input || typeof input !== 'object') return undefined;
    return {
      prompt: input.goal,
      currentLevel: input.startingPoint,
      baseline: input.userBaseline,
      targetTimeline: input.targetTimeline,
      dailyMinutes: input.minutesPerMission,
      horizonDays: input.horizonDays,
      researchMode: input.researchBrief ? 'web' : 'quick',
    };
  } catch {
    return undefined;
  }
}

export function createPlanCacheKey(input, identity = AI_PIPELINE_CACHE_IDENTITY) {
  const usesWebResearch = input.researchMode !== 'quick';
  return createHash('sha256')
    .update(
      JSON.stringify({
        promptVersion: identity.promptVersion,
        researchPromptVersion: usesWebResearch ? identity.researchPromptVersion : 'not-used',
        contractVersion: identity.contractVersion,
        validatorVersion: identity.validatorVersion,
        baselineParserVersion: identity.baselineParserVersion,
        model: identity.model,
        researchModel: usesWebResearch ? identity.researchModel : 'not-used',
        prompt: input.prompt.trim(),
        currentLevel: input.currentLevel,
        baseline: input.baseline.trim(),
        targetTimeline: input.targetTimeline.trim(),
        dailyMinutes: input.dailyMinutes,
        horizonDays: input.horizonDays,
        researchMode: input.researchMode === 'quick' ? 'quick' : 'web',
      }),
    )
    .digest('hex');
}

export function createResearchCacheKey(input, identity = AI_PIPELINE_CACHE_IDENTITY) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        researchPromptVersion: identity.researchPromptVersion,
        baselineParserVersion: identity.baselineParserVersion,
        researchModel: identity.researchModel,
        prompt: input.prompt.trim(),
        currentLevel: input.currentLevel,
        baseline: input.baseline.trim(),
        targetTimeline: input.targetTimeline.trim(),
        dailyMinutes: input.dailyMinutes,
        horizonDays: input.horizonDays,
        researchMode: input.researchMode === 'quick' ? 'quick' : 'web',
      }),
    )
    .digest('hex');
}

export function providerStageKey(cacheKey, stage) {
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

function recordStageResult(stageKey, payload, requestId, inputSnapshot) {
  stageResults.delete(stageKey);
  stageResults.set(stageKey, {
    payload,
    requestId,
    inputSnapshot,
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

function invalidProviderOutput(message, code, stage, payload, cause) {
  const meta = responseMeta(payload);
  const error = new OpenAIRequestError(message, {
    status: 502,
    code,
    stage,
    operation: 'validate',
    durationMs: 0,
    providerResponseId: meta.providerResponseId,
    cause,
  });
  if (code === 'upstream_invalid_plan_contract') {
    error.validationPath = /^([A-Za-z0-9.]+):/.exec(message)?.[1];
  }
  return error;
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
  if (error.code === 'ambiguous_create' || error.code === 'saved_response_unavailable') {
    return 409;
  }
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
    restoreMap(stageResults, state.stageResults, { recoverCompletedStages: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    statePersistenceHealthy = false;
    console.warn(
      '[actum-ai] durable_state_load_failed state_ignored=true paid_requests_blocked=true',
    );
  }
}

function restoreMap(cache, entries, { recoverCompletedStages = false } = {}) {
  if (!Array.isArray(entries)) return;
  const now = Date.now();
  for (const pair of entries) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [key, entry] = pair;
    if (typeof key !== 'string' || key.length > 200) continue;
    if (!entry || typeof entry !== 'object') continue;
    let restoredEntry = entry;
    if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
      const completedAtMs = Number(entry.payload?.completed_at) * 1000;
      const recoveredExpiresAt = completedAtMs + STAGE_RESULT_TTL_MS;
      if (
        !recoverCompletedStages ||
        entry.payload?.status !== 'completed' ||
        !Number.isFinite(completedAtMs) ||
        recoveredExpiresAt <= now
      ) {
        continue;
      }
      restoredEntry = { ...entry, expiresAt: recoveredExpiresAt };
    }
    cache.set(key, restoredEntry);
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
