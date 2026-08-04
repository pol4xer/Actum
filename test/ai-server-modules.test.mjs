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
  targetTimeline: ' 12 months ',
  dailyMinutes: 20,
  horizonDays: 14,
  researchMode: 'web',
});

test('extracted cache helpers preserve the original byte-for-byte keys', () => {
  assert.equal(
    createPlanCacheKey(webInput, fixedIdentity),
    '51fb006e009a3b83e1cc0516d9ab016c2457ebaafbf79aa54331f214e443bee5',
  );
  assert.equal(
    createResearchCacheKey(webInput, fixedIdentity),
    'cd836710c0f68143eb9ad1450aaadd6fb49c7da0ee98e8a59d6a3bffa685d116',
  );
  assert.equal(
    createPlanCacheKey({ ...webInput, researchMode: 'quick' }, fixedIdentity),
    '22770f22c9a0f82c03bf88dd971b82704496e4e3e98f227e60f575c6739d3c64',
  );
  assert.equal(
    createResearchCacheKey({ ...webInput, researchMode: 'quick' }, fixedIdentity),
    '44486c584132ebb17dbfc0fd806edf754be382193cbbefb05a39ad4dfd472bf6',
  );
  assert.equal(providerStageKey('abc', 'planning'), 'planning\u0000abc');
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
