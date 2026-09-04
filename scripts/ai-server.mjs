import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  createPlanCacheKey as createPlanCacheKeyForIdentity,
  createResearchCacheKey as createResearchCacheKeyForIdentity,
  providerStageKey,
} from './ai/cache/keys.mjs';
import {
  createRuntimeConfig,
  MAX_CONCURRENT_PLANS,
  PLANNING_TIMEOUT_MS,
  RESEARCH_TIMEOUT_MS,
} from './ai/config/runtime.mjs';
import { createPlanSchema, PLAN_CONTRACT_VERSION } from './ai/contracts/plan-v1.mjs';
import {
  BASELINE_PARSER_VERSION,
  parseTrustedBaseline,
  parseTrustedTarget,
} from './ai/contracts/parse-baseline.mjs';
import { programDurationConfig } from './ai/contracts/program-duration.mjs';
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
import {
  readJson,
  requestIdFromRequest,
  sendJson,
  setCors,
  validateInput,
} from './ai/http/helpers.mjs';
import { createDurableState } from './ai/state/durable-state.mjs';

const runtime = createRuntimeConfig({ serverModuleUrl: import.meta.url });
const {
  port: PORT,
  host: HOST,
  model: MODEL,
  researchModel: RESEARCH_MODEL,
  openAIApiKey: OPENAI_API_KEY,
} = runtime;
export const AI_PIPELINE_CACHE_IDENTITY = runtime.cacheIdentity;
const durableState = createDurableState({ stateFile: runtime.stateFile });
const inFlightPlans = new Map();

export { providerStageKey };

export function createPlanCacheKey(input, identity = AI_PIPELINE_CACHE_IDENTITY) {
  return createPlanCacheKeyForIdentity(input, identity);
}

export function createResearchCacheKey(input, identity = AI_PIPELINE_CACHE_IDENTITY) {
  return createResearchCacheKeyForIdentity(input, identity);
}

export async function handleRequest(request, response) {
  setCors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  const pathname = new URL(request.url || '/', `http://${HOST}:${PORT}`).pathname;
  if (request.method === 'GET' && pathname === '/health') {
    const stateStats = durableState.stats();
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
      cachedPlans: stateStats.cachedPlans,
      cachedResearch: stateStats.cachedResearch,
      resumableJobs: stateStats.resumableJobs,
      guardedCreates: stateStats.guardedCreates,
      cachedStageResults: stateStats.cachedStageResults,
      durableState: durableState.isHealthy(),
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/saved-plan/latest') {
    if (!durableState.isHealthy()) {
      sendJson(response, 503, {
        error: 'Локальное состояние сохранённых AI-ответов недоступно.',
        code: 'durable_state_unavailable',
      });
      return;
    }
    try {
      const saved = readLatestSavedPlan();
      if (!saved) {
        sendJson(response, 404, { error: 'Сохранённый plan-v6 не найден.' });
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
  if (!durableState.isHealthy()) {
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
    const cached = durableState.readPlan(cacheKey);
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
          durableState.savePlan(cacheKey, result);
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
      researchCacheKey && durableState.readResearch(researchCacheKey),
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
      `[actum-ai] prompt=${PROMPT_VERSION} research_prompt=${RESEARCH_PROMPT_VERSION} contract=${PLAN_CONTRACT_VERSION} validator=${PLAN_VALIDATOR_VERSION} baseline_parser=${BASELINE_PARSER_VERSION} transport=background-polling durable_state=${durableState.isHealthy() ? 'ready' : 'error'}`,
    );
  });
}

async function createPlan(input, requestId, startedAt, cacheKey, researchCacheKey, reuseOnly) {
  const researchMode = input.researchMode === 'quick' ? 'quick' : 'web';
  const trustedBaseline = parseTrustedBaseline(input.baseline);
  const normalizedGoal = input.prompt.trim();
  const trustedTarget = parseTrustedTarget(normalizedGoal);
  let research = {
    brief: '',
    sources: [],
    meta: { webSearchCount: 0 },
  };

  if (researchMode === 'web') {
    const cachedResearch = durableState.readResearch(researchCacheKey);
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
      durableState.saveResearch(researchCacheKey, research);
      console.log(
        `[actum-ai] ${requestId} researched response=${research.meta.providerResponseId || 'unknown'} searches=${research.meta.webSearchCount} sources=${research.sources.length} preserved=true`,
      );
    }
  }

  console.log(`[actum-ai] ${requestId} planning model=${MODEL}`);
  const planResponse = await requestStructuredPlan(
    input,
    trustedBaseline,
    trustedTarget,
    research,
    requestId,
    providerStageKey(cacheKey, 'planning'),
    researchCacheKey,
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
    validatePlanActionability(plan, {
      dailyMinutes: input.dailyMinutes,
      duration: input.duration,
      cycleNumber: input.cycleNumber ?? 1,
      expectedBaselineStatement: input.baseline,
      expectedTargetStatement: normalizedGoal,
      trustedBaseline,
      trustedTarget,
      programContext: input.programContext,
    });
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
  const durationConfig = programDurationConfig(input.duration);
  const trustedTarget = parseTrustedTarget(input.prompt.trim());
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
        trustedTarget,
        duration: input.duration,
        totalCycles: durationConfig.totalCycles,
        totalDays: durationConfig.totalDays,
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
  trustedTarget,
  research,
  requestId,
  stageKey,
  researchCacheKey,
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
        trustedTarget,
        duration: input.duration,
        totalCycles: programDurationConfig(input.duration).totalCycles,
        cycleNumber: input.cycleNumber ?? 1,
        minutesPerMission: input.dailyMinutes,
        cycleDays: 30,
        programContext: input.programContext ?? null,
        researchCacheKey,
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
          schema: createPlanSchema(
            input.dailyMinutes,
            input.duration,
            input.cycleNumber ?? 1,
          ),
        },
      },
    },
  });
}

async function executeProviderStage({ stageKey, stage, timeoutMs, requestId, reuseOnly, body }) {
  const completed = durableState.readStageResult(stageKey);
  if (completed) {
    console.log(
      `[actum-ai] ${requestId} stage=${stage} stage_result_cache_hit original_request=${completed.requestId}`,
    );
    return completed.payload;
  }

  const resumable = durableState.readBackgroundJob(stageKey);
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
    const guarded = durableState.readCreateGuard(stageKey);
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
    durableState.armCreateGuard(stageKey, requestId);
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
        durableState.recordBackgroundJob(stageKey, event.responseId, requestId);
      },
      onProgress: progressLogger,
    });
    durableState.recordStageResult(
      stageKey,
      payload,
      requestId,
      createStageInputSnapshot(body.input),
    );
    return payload;
  } catch (error) {
    if (error instanceof OpenAIRequestError) {
      if (error.providerResponseId) {
        durableState.recordBackgroundJob(stageKey, error.providerResponseId, requestId);
      }
      if (isAmbiguousCreateFailure(error)) {
        durableState.armCreateGuard(stageKey, requestId, error.code);
        error.retryGuarded = true;
      } else if (error.operation === 'create' && !error.providerResponseId) {
        durableState.clearCreateGuard(stageKey);
      }
      // Keep a known response ID even for a terminal provider outcome. A retry can
      // retrieve the same response without creating and billing a second POST.
    }
    throw error;
  }
}

function sumNumbers(...values) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : undefined;
}

function readLatestSavedPlan() {
  const planning = durableState.latestCompletedStage('planning');
  if (!planning) return undefined;
  const outputText = extractOutputText(planning.payload);
  if (!outputText) return undefined;
  const plan = JSON.parse(outputText);
  // `/saved-plan/latest` is a recovery path, not a legacy migration layer.
  // A completed plan-v5 response stays on disk but must never masquerade as v6.
  if (
    !plan ||
    !programDurationConfig(plan.duration) ||
    !Object.hasOwn(plan, 'target') ||
    !Object.hasOwn(plan, 'roadmap') ||
    !Object.hasOwn(plan, 'assessment')
  ) {
    return undefined;
  }
  const input = inferSavedPlanInput(plan, planning.inputSnapshot);
  const linkedResearchKey =
    planning.inputSnapshot?.researchCacheKey ?? createResearchCacheKey(input);
  const research =
    input.researchMode === 'web'
      ? durableState.readResearch(linkedResearchKey)
      : undefined;
  const trustedBaseline = parseTrustedBaseline(input.baseline);
  const trustedTarget = parseTrustedTarget(input.prompt);
  validatePlanActionability(plan, {
    dailyMinutes: input.dailyMinutes,
    duration: input.duration,
    cycleNumber: input.cycleNumber ?? 1,
    expectedBaselineStatement: input.baseline,
    expectedTargetStatement: input.prompt,
    trustedBaseline,
    trustedTarget,
    programContext: input.programContext,
  });

  const planMeta = responseMeta(planning.payload);
  return {
    input,
    plan,
    meta: {
      requestId: planning.requestId || 'actum_saved_plan',
      providerResponseId: planMeta.providerResponseId,
      researchResponseId: research?.meta?.providerResponseId,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      contractVersion: PLAN_CONTRACT_VERSION,
      durationMs: 0,
      webSearchCount: research?.meta?.webSearchCount || 0,
      inputTokens: sumNumbers(research?.meta?.inputTokens, planMeta.inputTokens),
      outputTokens: sumNumbers(research?.meta?.outputTokens, planMeta.outputTokens),
      sources: research?.sources?.slice(0, 8) ?? [],
    },
  };
}

function inferSavedPlanInput(plan, inputSnapshot) {
  if (inputSnapshot && typeof inputSnapshot === 'object') {
    const recovered = {
      prompt: inputSnapshot.prompt,
      currentLevel: inputSnapshot.currentLevel,
      baseline: inputSnapshot.baseline,
      duration: inputSnapshot.duration,
      cycleNumber: inputSnapshot.cycleNumber,
      dailyMinutes: inputSnapshot.dailyMinutes,
      researchMode: inputSnapshot.researchMode,
      programContext: inputSnapshot.programContext,
    };
    validateInput(recovered);
    return recovered;
  }
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.days)) {
    throw new Error('saved plan has no calendar');
  }
  if (plan.days.length !== 30) throw new Error('unsupported saved cycle');
  const maximumDayMinutes = Math.max(
    1,
    ...plan.days.map((day) => Number(day?.estimatedMinutes) || 0),
  );
  const dailyMinutes = [10, 20, 30, 45, 60].find((value) => value >= maximumDayMinutes);
  if (!dailyMinutes) throw new Error('saved plan exceeds supported daily limit');
  const baseline = plan.baseline?.userStatement;
  const prompt = plan.target?.userStatement;
  if (typeof baseline !== 'string' || typeof prompt !== 'string') {
    throw new Error('saved plan has no baseline or target');
  }
  const trustedBaseline = parseTrustedBaseline(baseline);
  const recovered = {
    prompt,
    currentLevel: trustedBaseline ? 'some-experience' : 'starting',
    baseline,
    duration: plan.duration,
    cycleNumber: plan.cycleNumber,
    dailyMinutes,
    researchMode: 'web',
  };
  return durableState.readResearch(createResearchCacheKey(recovered))
    ? recovered
    : { ...recovered, researchMode: 'quick' };
}

function createStageInputSnapshot(serializedInput) {
  try {
    const input = JSON.parse(serializedInput);
    if (!input || typeof input !== 'object') return undefined;
    return {
      prompt: input.goal,
      currentLevel: input.startingPoint,
      baseline: input.userBaseline,
      duration: input.duration,
      cycleNumber: input.cycleNumber,
      dailyMinutes: input.minutesPerMission,
      researchMode: input.researchBrief ? 'web' : 'quick',
      programContext: input.programContext ?? undefined,
      researchCacheKey: input.researchCacheKey,
    };
  } catch {
    return undefined;
  }
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

function isDirectRun() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}
