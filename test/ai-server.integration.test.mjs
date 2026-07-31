import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test, { after } from 'node:test';

process.env.OPENAI_API_KEY = 'test-only-openai-key';
process.env.OPENAI_MODEL = 'test-model';
process.env.OPENAI_RESEARCH_MODEL = 'test-research-model';
const testStateDirectory = mkdtempSync(join(tmpdir(), 'actum-ai-state-test-'));
const testStateFile = join(testStateDirectory, 'ai-state.json');
process.env.ACTUM_AI_STATE_FILE = testStateFile;
after(() => rmSync(testStateDirectory, { recursive: true, force: true }));

const [{ handleRequest: initialHandleRequest }, { createOpenAIResponse, extractOutputText }] = await Promise.all([
  import('../scripts/ai-server.mjs'),
  import('../scripts/ai/providers/openai-responses.mjs'),
]);
let gatewayHandler = initialHandleRequest;

test('AI gateway preserves paid work across failure, restart, cache, and concurrent joins', { timeout: 10_000 }, async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const logs = [];
  console.log = (...values) => logs.push(values.join(' '));
  console.warn = (...values) => logs.push(values.join(' '));
  console.error = (...values) => logs.push(values.join(' '));

  const apiCalls = [];
  let resumePollCount = 0;
  let blockedPlanning;
  let releaseBlockedPlanning;
  let markBlockedPlanningStarted;
  const blockedPlanningStarted = new Promise((resolve) => {
    markBlockedPlanningStarted = resolve;
  });

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(options.headers.Authorization, 'Bearer test-only-openai-key');
    if (options.method === 'GET') {
      apiCalls.push({ kind: 'planning_poll', url: String(url) });
      resumePollCount += 1;
      if (resumePollCount <= 3) {
        return jsonResponse(
          { error: { message: 'temporary overload', code: 'overloaded' } },
          503,
          { 'retry-after': '0.001' },
        );
      }
      return jsonResponse(planPayload('resp_plan_resume_test'));
    }

    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.background, true);
    const kind = Array.isArray(body.tools) ? 'research' : 'planning';
    if (kind === 'planning') {
      const missionProperties =
        body.text.format.schema.properties.chapters.items.properties.missions.items.properties;
      assert.equal(missionProperties.estimatedMinutes.maximum, 20);
      assert.equal(
        missionProperties.execution.anyOf[1].properties.durationSeconds.maximum,
        1200,
      );
    }
    const input = JSON.parse(body.input);
    apiCalls.push({ kind, input });

    if (kind === 'research') return jsonResponse(researchPayload());
    if (
      input.goal === 'Guard an ambiguous create' ||
      input.goal.startsWith('Retain ambiguous guard')
    ) {
      const rootCause = Object.assign(new Error('Headers Timeout Error'), {
        name: 'HeadersTimeoutError',
        code: 'UND_ERR_HEADERS_TIMEOUT',
      });
      throw new TypeError('fetch failed', { cause: rootCause });
    }
    if (input.goal === 'Cache invalid completed output') {
      return jsonResponse(invalidPlanPayload());
    }
    if (input.goal === 'Reject vague completed output') {
      return jsonResponse(vaguePlanPayload());
    }
    if (input.goal === 'Normalize schedule completed output') {
      return jsonResponse(scheduleMismatchPlanPayload());
    }
    if (input.goal === 'Join one active request') {
      markBlockedPlanningStarted();
      blockedPlanning ||= new Promise((resolve) => {
        releaseBlockedPlanning = resolve;
      });
      await blockedPlanning;
      return jsonResponse(planPayload());
    }
    return jsonResponse({ id: 'resp_plan_resume_test', status: 'queued' });
  };

  t.after(async () => {
    releaseBlockedPlanning?.();
    globalThis.fetch = originalFetch;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });
  const health = await getHealth();
  assert.equal(health.status, 200);
  assert.equal(health.body.transport, 'background-polling');
  assert.equal(health.body.configured, true);

  const firstInput = goalInput('Resume paid background work');
  const first = await postPlan(firstInput, 'actum_test_failure_001');
  assert.equal(first.status, 502);
  assert.equal(first.body.code, 'overloaded');
  assert.equal(first.body.stage, 'planning');
  assert.equal(first.body.researchPreserved, true);
  assert.match(first.body.error, /Web-research сохранён/);
  assert.deepEqual(
    apiCalls.map((call) => call.kind),
    ['research', 'planning', 'planning_poll', 'planning_poll', 'planning_poll'],
  );

  gatewayHandler = (
    await import(`../scripts/ai-server.mjs?restart-after-poll=${Date.now()}`)
  ).handleRequest;
  const second = await postPlan(firstInput, 'actum_test_retry_002');
  assert.equal(second.status, 200);
  assert.equal(second.body.meta.researchResponseId, 'resp_research_test');
  assert.equal(second.body.meta.sources[0].url, 'https://example.com/research');
  assert.deepEqual(
    apiCalls.filter((call) => call.kind !== 'planning_poll').map((call) => call.kind),
    ['research', 'planning'],
  );
  assert.equal(apiCalls[1].input.researchBrief, 'Verified research brief for the requested goal.');
  assert.equal(
    apiCalls.filter((call) => call.kind === 'planning_poll').length,
    4,
  );

  const third = await postPlan(firstInput, 'actum_test_cache_003');
  assert.equal(third.status, 200);
  assert.deepEqual(third.body, second.body);
  assert.equal(apiCalls.filter((call) => call.kind === 'planning').length, 1);

  const guardedInput = goalInput('Guard an ambiguous create', 'quick');
  const guardedFirst = await postPlan(guardedInput, 'actum_test_guard_006');
  assert.equal(guardedFirst.status, 502);
  assert.equal(guardedFirst.body.code, 'upstream_network_error');
  assert.equal(guardedFirst.body.retryGuarded, true);
  assert.match(guardedFirst.body.error, /двойное списание/);
  const guardedCallCount = apiCalls.filter(
    (call) => call.kind === 'planning' && call.input.goal === 'Guard an ambiguous create',
  ).length;
  const guardedSecond = await postPlan(guardedInput, 'actum_test_guard_007');
  assert.equal(guardedSecond.status, 409);
  assert.equal(guardedSecond.body.code, 'ambiguous_create');
  assert.equal(guardedSecond.body.retryGuarded, true);
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'planning' && call.input.goal === 'Guard an ambiguous create',
    ).length,
    guardedCallCount,
  );

  const retainedGuardInputs = Array.from({ length: 21 }, (_, index) =>
    goalInput(`Retain ambiguous guard ${index + 1}`, 'quick'),
  );
  for (const [index, retainedInput] of retainedGuardInputs.entries()) {
    const result = await postPlan(retainedInput, `actum_test_many_guards_${index + 1}`);
    assert.equal(result.status, 502);
    assert.equal(result.body.retryGuarded, true);
  }
  const retainedPostCount = apiCalls.filter(
    (call) =>
      call.kind === 'planning' && call.input.goal.startsWith('Retain ambiguous guard'),
  ).length;
  gatewayHandler = (
    await import(`../scripts/ai-server.mjs?restart-after-many-guards=${Date.now()}`)
  ).handleRequest;
  const oldestRetainedGuard = await postPlan(
    retainedGuardInputs[0],
    'actum_test_oldest_guard_after_restart_014',
  );
  assert.equal(oldestRetainedGuard.status, 409);
  assert.equal(oldestRetainedGuard.body.code, 'ambiguous_create');
  assert.equal(
    apiCalls.filter(
      (call) =>
        call.kind === 'planning' && call.input.goal.startsWith('Retain ambiguous guard'),
    ).length,
    retainedPostCount,
  );

  const invalidInput = goalInput('Cache invalid completed output', 'quick');
  const invalidFirst = await postPlan(invalidInput, 'actum_test_invalid_008');
  assert.equal(invalidFirst.status, 502);
  assert.equal(invalidFirst.body.code, 'upstream_invalid_plan_json');
  const invalidSecond = await postPlan(invalidInput, 'actum_test_invalid_009');
  assert.equal(invalidSecond.status, 502);
  assert.equal(invalidSecond.body.code, 'upstream_invalid_plan_json');
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'planning' && call.input.goal === 'Cache invalid completed output',
    ).length,
    1,
  );

  const vagueInput = goalInput('Reject vague completed output', 'quick');
  const vagueFirst = await postPlan(vagueInput, 'actum_test_vague_016');
  assert.equal(vagueFirst.status, 502);
  assert.equal(vagueFirst.body.code, 'upstream_invalid_plan_contract');
  assert.match(vagueFirst.body.error, /chapters\.0\.missions\.0\.steps/);
  const vagueSecond = await postPlan(vagueInput, 'actum_test_vague_017');
  assert.equal(vagueSecond.status, 502);
  assert.equal(vagueSecond.body.code, 'upstream_invalid_plan_contract');
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'planning' && call.input.goal === 'Reject vague completed output',
    ).length,
    1,
  );

  const scheduleInput = goalInput('Normalize schedule completed output', 'quick');
  const normalizedSchedule = await postPlan(scheduleInput, 'actum_test_schedule_018');
  assert.equal(normalizedSchedule.status, 200);
  assert.equal(
    normalizedSchedule.body.plan.chapters
      .flatMap((chapter) => chapter.missions)
      .reduce((sum, mission) => sum + mission.repeatCount, 0),
    14,
  );
  const normalizedAction =
    normalizedSchedule.body.plan.chapters[0].missions[0].execution.actions[0];
  assert.ok(
    normalizedAction.sets * normalizedAction.quantity +
      (normalizedAction.sets - 1) * normalizedAction.restSeconds <=
      1200,
  );

  const concurrentInput = goalInput('Join one active request');
  const handlerBeforeInterruptedRestart = gatewayHandler;
  const activeRequest = postPlan(concurrentInput, 'actum_test_active_004');
  await withTimeout(blockedPlanningStarted, 1_000, 'planning did not start');
  const joinedRequest = postPlan(concurrentInput, 'actum_test_joined_005');
  await waitFor(() => logs.some((line) => line.includes('actum_test_joined_005 inflight_join')));
  gatewayHandler = (
    await import(`../scripts/ai-server.mjs?restart-during-create=${Date.now()}`)
  ).handleRequest;
  const guardedAfterRestart = await postPlan(
    concurrentInput,
    'actum_test_restart_during_create_013',
  );
  assert.equal(guardedAfterRestart.status, 409);
  assert.equal(guardedAfterRestart.body.code, 'ambiguous_create');
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'planning' && call.input.goal === 'Join one active request',
    ).length,
    1,
  );
  gatewayHandler = handlerBeforeInterruptedRestart;
  releaseBlockedPlanning();
  const [activeResult, joinedResult] = await Promise.all([activeRequest, joinedRequest]);
  assert.equal(activeResult.status, 200);
  assert.equal(joinedResult.status, 200);
  assert.deepEqual(joinedResult.body, activeResult.body);
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'research' && call.input.goal === 'Join one active request',
    ).length,
    1,
  );
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'planning' && call.input.goal === 'Join one active request',
    ).length,
    1,
  );

  const callsBeforeFinalRestart = apiCalls.length;
  gatewayHandler = (
    await import(`../scripts/ai-server.mjs?restart-after-all=${Date.now()}`)
  ).handleRequest;
  const restartCached = await postPlan(firstInput, 'actum_test_restart_cache_010');
  assert.equal(restartCached.status, 200);
  const restartGuarded = await postPlan(guardedInput, 'actum_test_restart_guard_011');
  assert.equal(restartGuarded.status, 409);
  assert.equal(restartGuarded.body.code, 'ambiguous_create');
  const restartInvalid = await postPlan(invalidInput, 'actum_test_restart_invalid_012');
  assert.equal(restartInvalid.status, 502);
  assert.equal(restartInvalid.body.code, 'upstream_invalid_plan_json');
  assert.equal(apiCalls.length, callsBeforeFinalRestart);

  const corruptStateFile = join(testStateDirectory, 'corrupt-state.json');
  writeFileSync(corruptStateFile, '{broken-json', 'utf8');
  process.env.ACTUM_AI_STATE_FILE = corruptStateFile;
  gatewayHandler = (
    await import(`../scripts/ai-server.mjs?restart-with-corrupt-state=${Date.now()}`)
  ).handleRequest;
  const callsBeforeCorruptStateRequest = apiCalls.length;
  const blockedByCorruptState = await postPlan(
    goalInput('Paid work must fail closed', 'quick'),
    'actum_test_corrupt_state_015',
  );
  assert.equal(blockedByCorruptState.status, 503);
  assert.equal(blockedByCorruptState.body.code, 'durable_state_unavailable');
  assert.equal(apiCalls.length, callsBeforeCorruptStateRequest);
  process.env.ACTUM_AI_STATE_FILE = testStateFile;

  const joinedLogs = logs.join('\n');
  assert.match(joinedLogs, /stage=planning/);
  assert.match(joinedLogs, /code=upstream_network_error/);
  assert.match(joinedLogs, /UND_ERR_HEADERS_TIMEOUT/);
  assert.match(joinedLogs, /research_preserved=true/);
  assert.match(joinedLogs, /research_cache_hit/);
  assert.match(joinedLogs, /resume_pending response=resp_plan_resume_test/);
  assert.match(joinedLogs, /retry_guarded=true/);
  assert.match(joinedLogs, /actum_test_invalid_009 stage=planning stage_result_cache_hit/);
  assert.match(joinedLogs, /actum_test_vague_017 stage=planning stage_result_cache_hit/);
  assert.match(joinedLogs, /contract_path=chapters\.0\.missions\.0\.steps/);
  assert.match(joinedLogs, /actum_test_schedule_018 plan_normalized duration_missions=1/);
  assert.match(joinedLogs, /actum_test_cache_003 cache_hit/);
  assert.doesNotMatch(joinedLogs, /actum_test_cache_003 inflight_join/);
  assert.match(joinedLogs, /inflight_join/);
  assert.doesNotMatch(joinedLogs, /test-only-openai-key/);
  assert.doesNotMatch(joinedLogs, /Resume paid background work/);
  assert.doesNotMatch(joinedLogs, /Authorization/);
});

test('OpenAI background transport polls safely without repeating the paid POST', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let pollCount = 0;

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method });
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.background, true);
      return jsonResponse({ id: 'resp_background_test', status: 'queued' });
    }

    pollCount += 1;
    if (pollCount === 1) {
      const rootCause = Object.assign(new Error('Headers Timeout Error'), {
        name: 'HeadersTimeoutError',
        code: 'UND_ERR_HEADERS_TIMEOUT',
      });
      throw new TypeError('fetch failed', { cause: rootCause });
    }
    if (pollCount === 2) {
      return jsonResponse({ error: { message: 'temporary overload', code: 'overloaded' } }, 503, {
        'retry-after': '0.001',
      });
    }
    if (pollCount === 3) {
      return jsonResponse({ id: 'resp_background_test', status: 'in_progress' });
    }
    return jsonResponse({
      id: 'resp_background_test',
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'background completed', annotations: [] }],
        },
      ],
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const payload = await createOpenAIResponse({
    apiKey: 'test-key',
    stage: 'planning',
    timeoutMs: 2_000,
    httpTimeoutMs: 500,
    pollIntervalMs: 1,
    body: { model: 'test-model', input: 'test', store: false },
  });

  assert.equal(extractOutputText(payload), 'background completed');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(calls.filter((call) => call.method === 'GET').length, 4);
  assert.ok(calls.filter((call) => call.method === 'GET').every((call) => call.url.endsWith('/resp_background_test')));
});

function goalInput(prompt, researchMode = 'web') {
  return {
    prompt,
    dailyMinutes: 20,
    horizonDays: 14,
    currentLevel: 'starting',
    researchMode,
  };
}

function researchPayload() {
  return {
    id: 'resp_research_test',
    status: 'completed',
    output: [
      { type: 'web_search_call' },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Verified research brief for the requested goal.',
            annotations: [
              {
                type: 'url_citation',
                url_citation: {
                  title: 'Verified source',
                  url: 'https://example.com/research',
                },
              },
            ],
          },
        ],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  };
}

function planPayload(responseId = 'resp_plan_test') {
  return {
    id: responseId,
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(validPlan()), annotations: [] }],
      },
    ],
    usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
  };
}

function invalidPlanPayload() {
  return {
    id: 'resp_invalid_plan_test',
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: '{not-json', annotations: [] }],
      },
    ],
  };
}

function vaguePlanPayload() {
  const plan = validPlan();
  plan.chapters[0].missions[0].steps = ['Подготовься.'];
  plan.chapters[0].missions[0].execution = {
    kind: 'manual',
    durationSeconds: null,
    successCriterion: 'Подготовка якобы завершена.',
  };
  return {
    id: 'resp_vague_plan_test',
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(plan), annotations: [] }],
      },
    ],
  };
}

function scheduleMismatchPlanPayload() {
  const plan = validPlan();
  plan.chapters[0].missions[0].repeatCount += 1;
  const action = plan.chapters[0].missions[0].execution.actions[0];
  action.sets = 3;
  action.quantity = 600;
  action.unit = 'seconds';
  action.restSeconds = 60;
  return {
    id: 'resp_schedule_plan_test',
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(plan), annotations: [] }],
      },
    ],
  };
}

function validPlan() {
  return {
    title: 'Test route',
    domain: 'practice',
    targetMetric: 'Complete six test missions',
    summary: 'A deterministic route used only by the local no-cost integration test.',
    safetyNotes: ['Stop if uncomfortable.'],
    assumptions: ['The user can practice for twenty minutes.'],
    sourceLabels: ['Verified source'],
    chapters: Array.from({ length: 3 }, (_, chapterIndex) => ({
      title: `Chapter ${chapterIndex + 1}`,
      subtitle: `Test phase ${chapterIndex + 1}`,
      missions: Array.from({ length: 2 }, (_, missionIndex) => ({
        title: `Mission ${chapterIndex + 1}.${missionIndex + 1}`,
        description: 'Perform a small, measurable practice step.',
        type: 'practice',
        estimatedMinutes: 10,
        repeatCount: chapterIndex === 0 ? 3 : 2,
        xp: 20,
        steps: [
          'Place a mat on a flat surface and keep the test counter visible.',
          'Keep the prescribed tempo for every repetition.',
        ],
        execution: {
          kind: 'routine',
          actions: [
            {
              title: 'Controlled test repetitions',
              instruction: 'Complete each repetition with the same range of motion.',
              sets: 3,
              quantity: 8,
              unit: 'reps',
              unitLabel: null,
              restSeconds: 30,
              tempo: '2 seconds out, 2 seconds back',
              successCriterion: 'All eight repetitions keep the prescribed tempo.',
            },
          ],
          successCriterion: 'All three sets are completed with eight controlled repetitions.',
        },
        progressionRule:
          'If all sets meet the criterion, add 1 repetition next time; otherwise repeat 3 sets of 8.',
        warning: null,
      })),
    })),
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_test', ...headers },
  });
}

function postPlan(payload, requestId) {
  return invokeHandler({
    method: 'POST',
    url: '/plan',
    headers: { 'content-type': 'application/json', 'x-actum-request-id': requestId },
    body: JSON.stringify(payload),
  });
}

function getHealth() {
  return invokeHandler({ method: 'GET', url: '/health', headers: {}, body: '' });
}

async function invokeHandler({ method, url, headers, body }) {
  const request = Readable.from(body ? [body] : []);
  request.method = method;
  request.url = url;
  request.headers = headers;
  const response = new FakeResponse();
  await gatewayHandler(request, response);
  return {
    status: response.statusCode,
    body: response.body ? JSON.parse(response.body) : undefined,
  };
}

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

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
