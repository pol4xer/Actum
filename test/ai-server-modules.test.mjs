import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  createPlanCacheKey,
  createResearchCacheKey,
  providerStageKey,
} from '../scripts/ai/cache/keys.mjs';
import { createRuntimeConfig } from '../scripts/ai/config/runtime.mjs';
import {
  CYCLE_DAYS,
  PROGRAM_DURATIONS,
  programDurationConfig,
} from '../scripts/ai/contracts/program-duration.mjs';
import {
  readJson,
  requestIdFromRequest,
  sendJson,
  setCors,
  validateInput,
} from '../scripts/ai/http/helpers.mjs';
import {
  createDurableState,
  DURABLE_STATE_TTLS,
  STATE_VERSION,
} from '../scripts/ai/state/durable-state.mjs';

const fixedIdentity = Object.freeze({
  promptVersion: 'p',
  researchPromptVersion: 'r',
  contractVersion: 'c',
  validatorVersion: 'v',
  baselineParserVersion: 'b',
  model: 'm',
  researchModel: 'rm',
});
const webInput = Object.freeze({
  prompt: '  Learn a skill  ',
  currentLevel: 'starting',
  baseline: '  8 reps  ',
  duration: 'year',
  cycleNumber: 1,
  dailyMinutes: 20,
  researchMode: 'web',
});

test('fixed duration choices map to one, six, or twelve 30-day cycles', () => {
  assert.equal(CYCLE_DAYS, 30);
  assert.deepEqual(PROGRAM_DURATIONS, {
    month: { totalCycles: 1, totalDays: 30 },
    'half-year': { totalCycles: 6, totalDays: 180 },
    year: { totalCycles: 12, totalDays: 365 },
  });
  assert.equal(programDurationConfig('custom'), undefined);
});

test('cache helpers separate cycle planning while reusing one program research result', () => {
  assert.equal(
    createPlanCacheKey(webInput, fixedIdentity),
    '8df61d7b559678bf3764ccea8b5bd17cd8821c43b17f1408a43fd4a45be08915',
  );
  assert.equal(
    createResearchCacheKey(webInput, fixedIdentity),
    '0fb40534572a34483c21db991fc495b76bee7daaca923e2e862517a12a746237',
  );
  assert.equal(
    createPlanCacheKey({ ...webInput, researchMode: 'quick' }, fixedIdentity),
    'be798da4ded5a07a1412586d21a5326384128c39ee6be4bfa3efa809150cd8ec',
  );
  assert.equal(
    createResearchCacheKey({ ...webInput, researchMode: 'quick' }, fixedIdentity),
    'd008e6041a59da5d579300fcad53e1b3105bff221b3088484d3632d02f0cc14c',
  );
  assert.equal(providerStageKey('abc', 'planning'), 'planning\u0000abc');

  const nextCycle = {
    ...webInput,
    currentLevel: 'some-experience',
    baseline: 'Current result: 12 reps',
    dailyMinutes: 45,
    cycleNumber: 2,
    programContext: {
      roadmap: [{ cycleNumber: 1, title: 'Done' }],
    },
  };
  assert.equal(
    createResearchCacheKey(nextCycle, fixedIdentity),
    createResearchCacheKey(webInput, fixedIdentity),
    'later cycles must reuse the paid research despite a new baseline, level, and time budget',
  );
  assert.notEqual(
    createPlanCacheKey(nextCycle, fixedIdentity),
    createPlanCacheKey(webInput, fixedIdentity),
  );
});

test('runtime config is rebuilt from each server import environment', () => {
  const serverModuleUrl = new URL('../scripts/ai-server.mjs?restart=test', import.meta.url).href;
  const first = createRuntimeConfig({
    serverModuleUrl,
    env: {
      ACTUM_AI_PORT: '9001',
      ACTUM_AI_HOST: '0.0.0.0',
      ACTUM_AI_STATE_FILE: '/tmp/actum-one.json',
      OPENAI_API_KEY: 'test-only-key-one',
      OPENAI_MODEL: 'model-one',
      OPENAI_RESEARCH_MODEL: 'research-one',
    },
  });
  const second = createRuntimeConfig({
    serverModuleUrl,
    env: {
      ACTUM_AI_STATE_FILE: '/tmp/actum-two.json',
      OPENAI_API_KEY: 'test-only-key-two',
      OPENAI_MODEL: 'model-two',
    },
  });

  assert.deepEqual(
    {
      port: first.port,
      host: first.host,
      stateFile: first.stateFile,
      model: first.model,
      researchModel: first.researchModel,
    },
    {
      port: 9001,
      host: '0.0.0.0',
      stateFile: '/tmp/actum-one.json',
      model: 'model-one',
      researchModel: 'research-one',
    },
  );
  assert.equal(second.stateFile, '/tmp/actum-two.json');
  assert.equal(second.model, 'model-two');
  assert.equal(second.researchModel, 'model-two');
  assert.notEqual(first.cacheIdentity.model, second.cacheIdentity.model);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.cacheIdentity));

  const defaults = createRuntimeConfig({ serverModuleUrl, env: {} });
  assert.equal(defaults.port, 8787);
  assert.equal(defaults.host, '127.0.0.1');
  assert.equal(defaults.model, 'gpt-5.6');
  assert.equal(
    defaults.stateFile,
    join(dirname(fileURLToPath(serverModuleUrl)), '..', '.actum', 'ai-state.json'),
  );
});

test('HTTP helpers retain validation, request-size, CORS, JSON, and request-ID contracts', async () => {
  assert.doesNotThrow(() => validateInput(webInput));
  assert.throws(
    () => validateInput({ ...webInput, dailyMinutes: 15 }),
    /Некорректный лимит времени\./,
  );
  assert.throws(
    () => validateInput({ ...webInput, duration: 'two-years' }),
    /Некорректный срок программы\./,
  );
  assert.throws(
    () => validateInput({ ...webInput, cycleNumber: 13 }),
    /Некорректный номер цикла\./,
  );
  assert.throws(
    () => validateInput({ ...webInput, horizonDays: 30 }),
    /Устаревший формат запроса\./,
  );
  assert.throws(
    () => validateInput({ ...webInput, programContext: { roadmap: [] } }),
    /Контекст программы неполный\./,
  );
  assert.throws(
    () =>
      validateInput({
        ...webInput,
        prompt: 'Hold a plank for 15 minutes',
        duration: 'month',
        dailyMinutes: 10,
      }),
    /Контрольный замер 900 сек\. не помещается в дневной лимит 600 сек\./,
  );
  assert.throws(
    () => validateInput({
      ...webInput,
      prompt: 'Hold a plank for 15 minutes',
      duration: 'year',
      dailyMinutes: 10,
    }),
    /Контрольный замер 900 сек\. не помещается в дневной лимит 600 сек\./,
  );
  const laterCycleContext = {
    target: {
      userStatement: 'Hold a plank for 15 minutes',
      normalizedMetric: 'Plank duration',
      value: 900,
      unit: 'seconds',
    },
    roadmap: [
      { cycleNumber: 1, title: 'Start', focus: 'Start', targetValue: 500, targetUnit: 'seconds' },
      { cycleNumber: 2, title: 'Next', focus: 'Next', targetValue: 700, targetUnit: 'seconds' },
    ],
    completedCycles: [],
  };
  assert.throws(
    () => validateInput({
      ...webInput,
      prompt: 'Hold a plank for 15 minutes',
      cycleNumber: 2,
      dailyMinutes: 10,
      programContext: laterCycleContext,
    }),
    /Контрольный замер 700 сек\. не помещается в дневной лимит 600 сек\./,
  );
  assert.equal(
    requestIdFromRequest({ headers: { 'x-actum-request-id': 'actum_12345678' } }),
    'actum_12345678',
  );
  assert.match(
    requestIdFromRequest({ headers: { 'x-actum-request-id': 'invalid' } }),
    /^actum_[a-f0-9]{16}$/,
  );

  const parsedRequest = Readable.from(['{"ok":true}']);
  assert.deepEqual(await readJson(parsedRequest), { ok: true });
  await assert.rejects(readJson(Readable.from(['{broken'])), /Некорректный JSON\./);
  await assert.rejects(readJson(Readable.from(['x'.repeat(20_001)])), /Запрос слишком большой\./);

  const response = new FakeResponse();
  setCors(response);
  sendJson(response, 201, { ok: true });
  assert.equal(response.statusCode, 201);
  assert.equal(response.body, '{"ok":true}');
  assert.deepEqual(response.headers, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers':
      'Content-Type, X-Actum-Request-Id, X-Actum-Reuse-Only',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
  });
});

test('durable state preserves the v1 shape, TTLs, transitions, and per-factory isolation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'actum-state-module-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'ai-state.json');
  const timestamp = 1_900_000_000_000;
  const now = () => timestamp;
  const planningKey = providerStageKey('plan-key', 'planning');
  const state = createDurableState({ stateFile, now });

  state.savePlan('plan-key', { meta: { requestId: 'actum_plan' } });
  state.saveResearch('research-key', { brief: 'saved research' });
  state.armCreateGuard(planningKey, 'actum_guard');
  let persisted = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.deepEqual(Object.keys(persisted), [
    'version',
    'savedAt',
    'planCache',
    'researchCache',
    'backgroundJobs',
    'ambiguousCreates',
    'stageResults',
  ]);
  assert.equal(persisted.version, STATE_VERSION);
  assert.equal(persisted.planCache[0][1].expiresAt, timestamp + DURABLE_STATE_TTLS.planCacheMs);
  assert.equal(
    persisted.researchCache[0][1].expiresAt,
    timestamp + DURABLE_STATE_TTLS.researchCacheMs,
  );
  assert.equal(
    persisted.ambiguousCreates[0][1].expiresAt,
    timestamp + DURABLE_STATE_TTLS.ambiguousCreateMs,
  );
  assert.equal(statSync(stateFile).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), ['ai-state.json']);

  const restartedBeforeTransition = createDurableState({ stateFile, now });
  assert.equal(restartedBeforeTransition.readCreateGuard(planningKey).requestId, 'actum_guard');
  assert.equal(restartedBeforeTransition.readPlan('plan-key').meta.requestId, 'actum_plan');

  state.recordBackgroundJob(planningKey, 'resp_123', 'actum_guard');
  assert.equal(state.readCreateGuard(planningKey), undefined);
  assert.equal(state.readBackgroundJob(planningKey).responseId, 'resp_123');
  state.recordStageResult(
    planningKey,
    { id: 'resp_123', status: 'completed', completed_at: timestamp / 1000 },
    'actum_guard',
    { prompt: 'Recovered prompt' },
  );
  assert.equal(state.readBackgroundJob(planningKey), undefined);
  assert.equal(state.readStageResult(planningKey).payload.id, 'resp_123');
  assert.equal(state.latestCompletedStage('planning').inputSnapshot.prompt, 'Recovered prompt');

  persisted = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(persisted.backgroundJobs.length, 0);
  assert.equal(persisted.ambiguousCreates.length, 0);
  assert.equal(persisted.stageResults[0][1].expiresAt, timestamp + DURABLE_STATE_TTLS.stageResultMs);
  assert.deepEqual(state.stats(), {
    cachedPlans: 1,
    cachedResearch: 1,
    resumableJobs: 0,
    guardedCreates: 0,
    cachedStageResults: 1,
  });

  // A factory is a process-import snapshot, not a hidden shared singleton.
  assert.equal(restartedBeforeTransition.readStageResult(planningKey), undefined);
  const restartedAfterTransition = createDurableState({ stateFile, now });
  assert.equal(restartedAfterTransition.readStageResult(planningKey).payload.id, 'resp_123');
});

test('program research remains reusable after a monthly cycle', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'actum-research-lifetime-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'ai-state.json');
  const startedAt = 1_900_000_000_000;
  let timestamp = startedAt;
  const state = createDurableState({ stateFile, now: () => timestamp });

  assert.ok(DURABLE_STATE_TTLS.researchCacheMs >= 400 * 24 * 60 * 60_000);
  state.saveResearch('annual-program', { brief: 'program-level research' });
  timestamp += 30 * 24 * 60 * 60_000;

  const restartedAfterCycle = createDurableState({ stateFile, now: () => timestamp });
  assert.equal(
    restartedAfterCycle.readResearch('annual-program').brief,
    'program-level research',
  );
});

test('durable state recovers recent completed paid stages and fails closed on corrupt JSON', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'actum-state-recovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'ai-state.json');
  const timestamp = 1_900_000_000_000;
  const planningKey = providerStageKey('recoverable', 'planning');
  writeFileSync(
    stateFile,
    JSON.stringify({
      version: STATE_VERSION,
      savedAt: new Date(timestamp).toISOString(),
      planCache: [],
      researchCache: [],
      backgroundJobs: [],
      ambiguousCreates: [],
      stageResults: [
        [
          planningKey,
          {
            requestId: 'actum_recovered',
            expiresAt: timestamp - 1,
            payload: {
              id: 'resp_recovered',
              status: 'completed',
              completed_at: timestamp / 1000 - 60,
            },
          },
        ],
        [
          providerStageKey('expired-incomplete', 'planning'),
          {
            requestId: 'actum_incomplete',
            expiresAt: timestamp - 1,
            payload: { id: 'resp_incomplete', status: 'in_progress' },
          },
        ],
      ],
    }),
    'utf8',
  );

  const recovered = createDurableState({ stateFile, now: () => timestamp });
  assert.equal(recovered.isHealthy(), true);
  assert.equal(recovered.readStageResult(planningKey).payload.id, 'resp_recovered');
  assert.equal(recovered.stats().cachedStageResults, 1);

  writeFileSync(stateFile, '{broken-json', 'utf8');
  const warnings = [];
  const corrupt = createDurableState({
    stateFile,
    now: () => timestamp,
    logger: { warn: (message) => warnings.push(message) },
  });
  assert.equal(corrupt.isHealthy(), false);
  assert.equal(corrupt.readStageResult(planningKey), undefined);
  assert.deepEqual(warnings, [
    '[actum-ai] durable_state_load_failed state_ignored=true paid_requests_blocked=true',
  ]);
});

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.body = '';
    this.destroyed = false;
    this.headers = {};
    this.statusCode = 200;
    this.writableEnded = false;
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    return this;
  }

  end(chunk = '') {
    this.body += chunk;
    this.writableEnded = true;
    this.emit('close');
    return this;
  }
}
