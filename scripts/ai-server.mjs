import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

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
} from './ai/providers/openai-responses.mjs';

const PORT = Number(process.env.ACTUM_AI_PORT || 8787);
const HOST = process.env.ACTUM_AI_HOST || '127.0.0.1';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const server = createServer(async (request, response) => {
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
    });
    return;
  }

  if (request.method !== 'POST' || pathname !== '/plan') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const requestId = `actum_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  if (!OPENAI_API_KEY) {
    sendJson(response, 503, {
      requestId,
      error: 'Добавь OPENAI_API_KEY в файл .env.local и перезапусти AI-сервер.',
    });
    return;
  }

  const startedAt = Date.now();
  console.log(`[actum-ai] ${requestId} received`);

  try {
    const input = await readJson(request);
    validateInput(input);
    const result = await createPlan(input, requestId, startedAt);
    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка AI-сервера.';
    const providerCode = error instanceof OpenAIRequestError ? error.code : undefined;
    console.error(
      `[actum-ai] ${requestId} failed duration_ms=${Date.now() - startedAt} code=${providerCode || 'local'} message=${JSON.stringify(message)}`,
    );
    sendJson(response, error instanceof OpenAIRequestError ? 502 : 400, {
      requestId,
      error: message,
      code: providerCode,
    });
  }
});

server.listen(PORT, HOST, () => {
  const status = OPENAI_API_KEY ? 'OpenAI key loaded' : 'OPENAI_API_KEY is missing';
  console.log(`Actum AI server: http://${HOST}:${PORT} · ${MODEL} · ${status}`);
  console.log(`[actum-ai] prompt=${PROMPT_VERSION} contract=${PLAN_CONTRACT_VERSION}`);
});

async function createPlan(input, requestId, startedAt) {
  const researchMode = input.researchMode === 'quick' ? 'quick' : 'web';
  let research = {
    brief: '',
    sources: [],
    meta: { webSearchCount: 0 },
  };

  if (researchMode === 'web') {
    console.log(`[actum-ai] ${requestId} researching model=${RESEARCH_MODEL}`);
    research = await requestResearch(input);
    console.log(
      `[actum-ai] ${requestId} researched response=${research.meta.providerResponseId || 'unknown'} searches=${research.meta.webSearchCount} sources=${research.sources.length}`,
    );
  }

  console.log(`[actum-ai] ${requestId} planning model=${MODEL}`);
  const planResponse = await requestStructuredPlan(input, research);
  const outputText = extractOutputText(planResponse);
  if (!outputText) throw new Error('OpenAI не вернул структурированный план.');

  let plan;
  try {
    plan = JSON.parse(outputText);
  } catch {
    throw new Error('OpenAI вернул нечитаемый JSON-план.');
  }
  validateMissionExecution(plan, input.dailyMinutes);

  const planMeta = responseMeta(planResponse);
  const durationMs = Date.now() - startedAt;
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

async function requestResearch(input) {
  const payload = await createOpenAIResponse({
    apiKey: OPENAI_API_KEY,
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
  if (!brief) throw new Error('Web-research завершился без итогового брифа.');

  return {
    brief,
    sources: extractWebSources(payload),
    meta: responseMeta(payload),
  };
}

async function requestStructuredPlan(input, research) {
  return createOpenAIResponse({
    apiKey: OPENAI_API_KEY,
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
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sumNumbers(...values) {
  const numbers = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : undefined;
}
