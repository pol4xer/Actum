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
  createResearchAnchor,
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
  MAX_RESEARCH_CYCLES,
  parseResearchConclusion,
  RESEARCH_SCHEMA,
} from '../scripts/ai/contracts/research-v1.mjs';
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

test('retry-cap choices map to one, six, or twelve 30-day cycles', () => {
  assert.equal(CYCLE_DAYS, 30);
  assert.deepEqual(PROGRAM_DURATIONS, {
    month: { totalCycles: 1, totalDays: 30 },
    'half-year': { totalCycles: 6, totalDays: 180 },
    year: { totalCycles: 12, totalDays: 365 },
  });
  assert.equal(programDurationConfig('custom'), undefined);
});

test('structured research keeps one bounded feasibility conclusion', () => {
  const conclusion = {
    brief: 'Проверенная основа и конкретные протоколы для первого цикла. '.repeat(2),
    earliestTargetCycleNumber: 3,
    feasibilityReason: 'Три цикла — самый ранний обоснованный тренировочный ориентир.',
  };
  assert.equal(MAX_RESEARCH_CYCLES, 12);
  assert.deepEqual(parseResearchConclusion(JSON.stringify(conclusion)), conclusion);
  assert.deepEqual(RESEARCH_SCHEMA.required, [
    'brief',
    'earliestTargetCycleNumber',
    'feasibilityReason',
  ]);
  assert.throws(
    () => parseResearchConclusion(JSON.stringify({ ...conclusion, earliestTargetCycleNumber: 13 })),
    /expected an integer cycle number from 1 to 12 or null/,
  );
  assert.throws(
    () => parseResearchConclusion(JSON.stringify({ ...conclusion, unknown: true })),
    /research\.unknown: field is not supported/,
  );
  assert.throws(() => parseResearchConclusion('{broken'), /unreadable JSON/);
});

test('cache helpers separate cycle planning while reusing one program research result', () => {
  assert.equal(
    createPlanCacheKey(webInput, fixedIdentity),
    '8df61d7b559678bf3764ccea8b5bd17cd8821c43b17f1408a43fd4a45be08915',
  );
  assert.equal(
    createResearchCacheKey(webInput, fixedIdentity),
    'f54a46fe26bf2786c664d328fb3d888887d246a635c2c26bbdb7e0cf183fe14c',
  );
  assert.equal(
    createPlanCacheKey({ ...webInput, researchMode: 'quick' }, fixedIdentity),
    'be798da4ded5a07a1412586d21a5326384128c39ee6be4bfa3efa809150cd8ec',
  );
  assert.equal(
    createResearchCacheKey({ ...webInput, researchMode: 'quick' }, fixedIdentity),
    '94b0e01adec096e70b1b61dee3d9e81c75573e067f9b3e50c9e47a495477b89b',
  );
  assert.equal(providerStageKey('abc', 'planning'), 'planning\u0000abc');

  assert.notEqual(
    createResearchCacheKey(
      { ...webInput, baseline: 'Current result: 12 reps' },
      fixedIdentity,
    ),
    createResearchCacheKey(webInput, fixedIdentity),
    'fresh programs with different baselines must never share research',
  );
  assert.notEqual(
    createResearchCacheKey(
      { ...webInput, currentLevel: 'some-experience' },
      fixedIdentity,
    ),
    createResearchCacheKey(webInput, fixedIdentity),
    'fresh programs with different experience levels must never share research',
  );
  assert.equal(
    createResearchCacheKey({ ...webInput, duration: 'month' }, fixedIdentity),
    createResearchCacheKey(webInput, fixedIdentity),
    'changing only the retry cap must reuse the same twelve-cycle research',
  );
  assert.notEqual(
    createResearchCacheKey({ ...webInput, dailyMinutes: 30 }, fixedIdentity),
    createResearchCacheKey(webInput, fixedIdentity),
    'fresh programs with different daily capacity need different feasibility research',
  );

  const researchAnchor = createResearchAnchor(webInput);
  assert.match(researchAnchor, /^[a-f0-9]{64}$/);
  const programContext = {
    researchAnchor,
    target: {
      userStatement: 'Learn a skill',
      normalizedMetric: 'Completed repetitions',
      value: 20,
      unit: 'reps',
    },
    roadmap: [{
      cycleNumber: 1,
      title: 'Done',
      focus: 'Complete measurable practice',
      targetValue: 20,
      targetUnit: 'reps',
    }],
    completedCycles: [],
  };
  const anchoredCycle = { ...webInput, programContext };
  const nextCycle = {
    ...webInput,
    currentLevel: 'some-experience',
    baseline: 'Current result: 12 reps',
    dailyMinutes: 45,
    cycleNumber: 2,
    programContext,
  };
  assert.equal(
    createResearchCacheKey(anchoredCycle, fixedIdentity),
    createResearchCacheKey(webInput, fixedIdentity),
    'the explicit program anchor must resolve the initial paid research key',
  );
  assert.equal(
    createResearchCacheKey(nextCycle, fixedIdentity),
    createResearchCacheKey(anchoredCycle, fixedIdentity),
    'later cycles must reuse the paid research despite a new baseline, level, and time budget',
  );
  assert.notEqual(
    createPlanCacheKey(nextCycle, fixedIdentity),
    createPlanCacheKey(webInput, fixedIdentity),
  );
  assert.notEqual(
    createResearchCacheKey(nextCycle, {
      ...fixedIdentity,
      researchPromptVersion: 'r-next',
    }),
    createResearchCacheKey(nextCycle, fixedIdentity),
    'the stable anchor must not bypass research identity invalidation',
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
    /Invalid time budget\./,
  );
  assert.throws(
    () => validateInput({ ...webInput, duration: 'two-years' }),
    /Invalid program continuation limit\./,
  );
  assert.throws(
    () => validateInput({ ...webInput, cycleNumber: 13 }),
    /Invalid cycle number\./,
  );
  assert.throws(
    () => validateInput({ ...webInput, prompt: 'Complete 0 repetitions' }),
    /A counter goal of 0 does not create an executable action/,
  );
  assert.throws(
    () => validateInput({
      ...webInput,
      prompt: 'Сократить время до 40 секунд',
      baseline: 'Сейчас результат 60 секунд',
    }),
    /Decreasing numeric goals are not yet supported by the built-in runner/,
  );
  assert.throws(
    () => validateInput({ ...webInput, horizonDays: 30 }),
    /Outdated request format\./,
  );
  assert.throws(
    () => validateInput({ ...webInput, programContext: { roadmap: [] } }),
    /The program context is incomplete\./,
  );
  assert.throws(
    () =>
      validateInput({
        ...webInput,
        prompt: 'Hold a plank for 15 minutes',
        duration: 'month',
        dailyMinutes: 10,
      }),
    /The 900-second assessment does not fit the 600-second daily budget\./,
  );
  assert.throws(
    () => validateInput({
      ...webInput,
      prompt: 'Hold a plank for 15 minutes',
      duration: 'year',
      dailyMinutes: 10,
    }),
    /The 900-second assessment does not fit the 600-second daily budget\./,
  );
  const laterCycleContext = {
    researchAnchor: 'a'.repeat(64),
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
      cycleNumber: 2,
      programContext: { ...laterCycleContext, researchAnchor: undefined },
    }),
    /The next cycle is blocked without its original research anchor/,
  );
  assert.throws(
    () => validateInput({
      ...webInput,
      cycleNumber: 2,
      programContext: { ...laterCycleContext, researchAnchor: 'invalid' },
    }),
    /Invalid program research anchor/,
  );
  assert.doesNotThrow(() => validateInput({
    ...webInput,
    cycleNumber: 2,
    researchMode: 'quick',
    programContext: { ...laterCycleContext, targetCycleNumber: 1 },
  }));
  assert.throws(
    () => validateInput({
      ...webInput,
      prompt: 'Reduce the result to 40 seconds',
      baseline: 'Current result is 35 seconds',
      cycleNumber: 2,
      researchMode: 'quick',
      programContext: {
        ...laterCycleContext,
        target: {
          ...laterCycleContext.target,
          userStatement: 'Reduce the result to 40 seconds',
          value: 40,
          unit: 'seconds',
        },
        roadmap: [
          { cycleNumber: 1, title: 'Start', focus: 'Start', targetValue: 50, targetUnit: 'seconds' },
          { cycleNumber: 2, title: 'Next', focus: 'Next', targetValue: 40, targetUnit: 'seconds' },
        ],
      },
    }),
    /Decreasing numeric goals are not yet supported by the built-in runner/,
  );
  assert.throws(
    () => validateInput({
      ...webInput,
      cycleNumber: 2,
      researchMode: 'quick',
      programContext: { ...laterCycleContext, targetCycleNumber: 13 },
    }),
    /Invalid target cycle in the program context/,
  );
  assert.throws(
    () => validateInput({
      ...webInput,
      prompt: 'Hold a plank for 15 minutes',
      cycleNumber: 2,
      dailyMinutes: 10,
      programContext: laterCycleContext,
    }),
    /The 700-second assessment does not fit the 600-second daily budget\./,
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
  await assert.rejects(readJson(Readable.from(['{broken'])), /Invalid JSON\./);
  await assert.rejects(readJson(Readable.from(['x'.repeat(20_001)])), /The request is too large\./);

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
