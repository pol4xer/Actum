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

const [serverModule, { createOpenAIResponse, extractOutputText, responseMeta }] = await Promise.all([
  import('../scripts/ai-server.mjs'),
  import('../scripts/ai/providers/openai-responses.mjs'),
]);
const { createDurableState } = await import('../scripts/ai/state/durable-state.mjs');
const {
  AI_PIPELINE_CACHE_IDENTITY,
  createPlanCacheKey,
  createResearchCacheKey,
  handleRequest: initialHandleRequest,
  providerStageKey,
} = serverModule;
let gatewayHandler = initialHandleRequest;

test('research and plan-v6 identity changes invalidate only their paid stage keys', () => {
  const webInput = goalInput('Invalidate the complete pipeline');
  const quickInput = goalInput('Keep quick planning stable', 'quick');
  const changedIdentity = {
    ...AI_PIPELINE_CACHE_IDENTITY,
    researchPromptVersion: `${AI_PIPELINE_CACHE_IDENTITY.researchPromptVersion}-next`,
    researchModel: `${AI_PIPELINE_CACHE_IDENTITY.researchModel}-next`,
  };
  const changedPlanIdentity = {
    ...AI_PIPELINE_CACHE_IDENTITY,
    contractVersion: `${AI_PIPELINE_CACHE_IDENTITY.contractVersion}-next`,
    validatorVersion: `${AI_PIPELINE_CACHE_IDENTITY.validatorVersion}-next`,
  };

  const originalResearchKey = createResearchCacheKey(webInput);
  const changedResearchKey = createResearchCacheKey(webInput, changedIdentity);
  const originalPlanKey = createPlanCacheKey(webInput);
  const changedPlanKey = createPlanCacheKey(webInput, changedIdentity);

  assert.notEqual(changedResearchKey, originalResearchKey);
  assert.notEqual(changedPlanKey, originalPlanKey);
  assert.notEqual(
    providerStageKey(changedPlanKey, 'planning'),
    providerStageKey(originalPlanKey, 'planning'),
  );
  assert.equal(createPlanCacheKey(quickInput), createPlanCacheKey(quickInput, changedIdentity));
  assert.equal(
    createResearchCacheKey(webInput),
    createResearchCacheKey(webInput, changedPlanIdentity),
  );
  assert.notEqual(createPlanCacheKey(webInput), createPlanCacheKey(webInput, changedPlanIdentity));
  assert.notEqual(createPlanCacheKey(quickInput), createPlanCacheKey(quickInput, changedPlanIdentity));
});

test('web research metadata counts distinct search queries, not repeated tool calls', () => {
  const meta = responseMeta({
    output: [
      { type: 'web_search_call', action: { type: 'search', query: 'breath hold protocol' } },
      { type: 'web_search_call', action: { type: 'search', query: ' Breath   Hold Protocol ' } },
      {
        type: 'web_search_call',
        action: { type: 'search', queries: ['apnea progression', 'apnea safety evidence'] },
      },
      { type: 'web_search_call', action: { type: 'open_page', url: 'https://example.com' } },
    ],
  });

  assert.equal(meta.webSearchCallCount, 4);
  assert.equal(meta.webSearchCount, 3);
});

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
  let queuedPlanInput;
  let blockedPlanning;
  let releaseBlockedPlanning;
  let markBlockedPlanningStarted;
  const blockedPlanningStarted = new Promise((resolve) => {
    markBlockedPlanningStarted = resolve;
  });

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(options.headers.Authorization, 'Bearer test-only-openai-key');
    if (options.method === 'GET') {
      if (String(url).endsWith('/resp_terminal_plan_test')) {
        apiCalls.push({ kind: 'terminal_poll', url: String(url) });
        return jsonResponse(terminalPlanFailurePayload());
      }
      apiCalls.push({ kind: 'planning_poll', url: String(url) });
      resumePollCount += 1;
      if (resumePollCount <= 3) {
        return jsonResponse(
          { error: { message: 'temporary overload', code: 'overloaded' } },
          503,
          { 'retry-after': '0.001' },
        );
      }
      return jsonResponse(planPayload('resp_plan_resume_test', queuedPlanInput));
    }

    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.background, true);
    const kind = Array.isArray(body.tools) ? 'research' : 'planning';
    const input = JSON.parse(body.input);
    if (kind === 'planning') {
      const schema = body.text.format.schema;
      const dayProperties = schema.properties.days.items.properties;
      assert.equal(schema.properties.days.minItems, 30);
      assert.equal(schema.properties.days.maxItems, 30);
      assert.deepEqual(schema.properties.duration.enum, [input.duration]);
      assert.deepEqual(schema.properties.totalCycles.enum, [input.totalCycles]);
      assert.deepEqual(schema.properties.cycleNumber.enum, [input.cycleNumber]);
      assert.equal(dayProperties.estimatedMinutes.maximum, input.minutesPerMission);
      const blockVariants = dayProperties.execution.properties.blocks.items.anyOf;
      const block = (blockKind) =>
        blockVariants.find((variant) => variant.properties.kind.enum[0] === blockKind);
      assert.equal(dayProperties.execution.properties.kind.enum[0], 'in_app');
      assert.equal(
        block('timer').properties.durationSecondsPerSet.maximum,
        input.minutesPerMission * 60,
      );
      assert.equal(
        block('counter').properties.workSecondsPerSet.maximum,
        input.minutesPerMission * 60,
      );
      assert.equal(
        block('checklist').properties.estimatedSeconds.maximum,
        input.minutesPerMission * 60,
      );
      assert.equal(
        block('text_log').properties.estimatedSeconds.maximum,
        input.minutesPerMission * 60,
      );
      assert.equal(body.max_output_tokens, 30_000);
    }
    apiCalls.push({ kind, input });

    if (kind === 'research') return jsonResponse(researchPayload(input.goal));
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
    if (input.goal === 'Reject off-app completed output') {
      return jsonResponse(offAppPlanPayload(input));
    }
    if (input.goal === 'Reject mismatched calendar output') {
      return jsonResponse(scheduleMismatchPlanPayload(input));
    }
    if (input.goal === 'Retain terminal provider outcome') {
      return jsonResponse(terminalPlanFailurePayload());
    }
    if (input.goal === 'Join one active request') {
      markBlockedPlanningStarted();
      blockedPlanning ||= new Promise((resolve) => {
        releaseBlockedPlanning = resolve;
      });
      await blockedPlanning;
      return jsonResponse(planPayload('resp_plan_test', input));
    }
    if (
      input.goal === 'Reuse research in the next cycle' ||
      input.goal === 'Interleaved research program'
    ) {
      return jsonResponse(planPayload(`resp_cycle_${input.cycleNumber}`, input));
    }
    queuedPlanInput = input;
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
  assert.equal(health.body.baselineParserVersion, 'numeric-metric-v2');
  assert.equal(health.body.contractVersion, 'plan-v6');
  assert.equal(health.body.validatorVersion, 'plan-validator-v6');
  assert.equal(health.body.promptVersion, 'actum-plan-2026-09-04-adaptive-program-v1');
  assert.equal(health.body.researchPromptVersion, 'actum-research-2026-09-04-program-v3');
  const noSavedPlan = await getSavedPlan();
  assert.equal(noSavedPlan.status, 404);

  const callsBeforeImpossibleAssessment = apiCalls.length;
  const impossibleMonth = await postPlan(
    {
      ...goalInput('Hold a plank for 15 minutes'),
      duration: 'month',
      dailyMinutes: 10,
    },
    'actum_test_impossible_month_026',
  );
  assert.equal(impossibleMonth.status, 400);
  assert.match(impossibleMonth.body.error, /не помещается в дневной лимит/);
  assert.equal(apiCalls.length, callsBeforeImpossibleAssessment);

  const impossibleYear = await postPlan(
    {
      ...goalInput('Hold a plank for 15 minutes'),
      duration: 'year',
      dailyMinutes: 10,
    },
    'actum_test_impossible_year_027',
  );
  assert.equal(impossibleYear.status, 400);
  assert.match(impossibleYear.body.error, /не помещается в дневной лимит/);
  assert.equal(apiCalls.length, callsBeforeImpossibleAssessment);

  const impossibleKnownCycle = await postPlan(
    {
      ...goalInput('Hold a plank for 15 minutes'),
      cycleNumber: 2,
      dailyMinutes: 10,
      programContext: {
        target: {
          userStatement: 'Hold a plank for 15 minutes',
          normalizedMetric: 'Plank duration',
          value: 900,
          unit: 'seconds',
        },
        roadmap: [
          { cycleNumber: 1, title: 'Start', focus: 'Start safely', targetValue: 500, targetUnit: 'seconds' },
          { cycleNumber: 2, title: 'Next', focus: 'Continue safely', targetValue: 700, targetUnit: 'seconds' },
        ],
        completedCycles: [],
      },
    },
    'actum_test_impossible_cycle_027',
  );
  assert.equal(impossibleKnownCycle.status, 400);
  assert.match(impossibleKnownCycle.body.error, /не помещается в дневной лимит/);
  assert.equal(apiCalls.length, callsBeforeImpossibleAssessment);

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
  assert.equal(second.body.meta.contractVersion, 'plan-v6');
  assert.equal(second.body.meta.promptVersion, 'actum-plan-2026-09-04-adaptive-program-v1');
  assert.equal(second.body.meta.researchResponseId, 'resp_research_test');
  assert.equal(second.body.meta.sources[0].url, 'https://example.com/research');
  assert.deepEqual(
    apiCalls.filter((call) => call.kind !== 'planning_poll').map((call) => call.kind),
    ['research', 'planning'],
  );
  assert.equal(apiCalls[1].input.researchBrief, 'Verified research brief for the requested goal.');
  assert.equal(apiCalls[0].input.userBaseline, 'Current test baseline: 8 repetitions');
  assert.equal(apiCalls[1].input.userBaseline, 'Current test baseline: 8 repetitions');
  assert.deepEqual(apiCalls[0].input.trustedBaseline, { value: 8, unit: 'reps' });
  assert.deepEqual(apiCalls[1].input.trustedBaseline, { value: 8, unit: 'reps' });
  assert.equal(apiCalls[1].input.duration, 'year');
  assert.equal(apiCalls[1].input.totalCycles, 12);
  assert.equal(apiCalls[1].input.cycleDays, 30);
  assert.equal(
    apiCalls.filter((call) => call.kind === 'planning_poll').length,
    4,
  );

  const callsBeforeSavedRecovery = apiCalls.length;
  const savedRecovery = await getSavedPlan();
  assert.equal(savedRecovery.status, 200);
  assert.equal(savedRecovery.body.plan.title, 'Test route');
  assert.equal(savedRecovery.body.input.prompt, 'Resume paid background work');
  assert.equal(savedRecovery.body.input.researchMode, 'web');
  assert.equal(savedRecovery.body.input.dailyMinutes, 20);
  assert.equal(savedRecovery.body.input.baseline, 'Current test baseline: 8 repetitions');
  assert.equal(savedRecovery.body.input.duration, 'year');
  assert.equal(savedRecovery.body.input.cycleNumber, 1);
  assert.equal(savedRecovery.body.meta.providerResponseId, 'resp_plan_resume_test');
  assert.equal(savedRecovery.body.meta.researchResponseId, 'resp_research_test');
  assert.equal(apiCalls.length, callsBeforeSavedRecovery);

  const third = await postPlan(firstInput, 'actum_test_cache_003');
  assert.equal(third.status, 200);
  assert.deepEqual(third.body, second.body);
  assert.equal(apiCalls.filter((call) => call.kind === 'planning').length, 1);

  const cycleOneInput = goalInput('Reuse research in the next cycle');
  const cycleOne = await postPlan(cycleOneInput, 'actum_test_cycle_one_024');
  assert.equal(cycleOne.status, 200);
  assert.equal(cycleOne.body.plan.cycleNumber, 1);
  const interleaved = await postPlan(
    goalInput('Interleaved research program'),
    'actum_test_interleaved_research_028',
  );
  assert.equal(interleaved.status, 200);
  assert.equal(interleaved.body.meta.researchResponseId, 'resp_research_interleaved');
  const cycleTwoInput = {
    ...cycleOneInput,
    currentLevel: 'some-experience',
    baseline: 'Current test baseline: 12 repetitions',
    dailyMinutes: 45,
    cycleNumber: 2,
    programContext: {
      target: cycleOne.body.plan.target,
      roadmap: cycleOne.body.plan.roadmap,
      completedCycles: [
        {
          cycleNumber: 1,
          completedAt: '2026-10-04T00:00:00.000Z',
          measuredValue: 12,
          unit: 'reps',
        },
      ],
    },
  };
  const cycleTwo = await postPlan(cycleTwoInput, 'actum_test_cycle_two_025');
  assert.equal(cycleTwo.status, 200);
  assert.equal(cycleTwo.body.plan.cycleNumber, 2);
  assert.equal(cycleTwo.body.plan.baseline.value, 12);
  assert.equal(cycleTwo.body.meta.researchResponseId, cycleOne.body.meta.researchResponseId);
  assert.equal(cycleTwo.body.meta.researchResponseId, 'resp_research_cycle_program');
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'research' && call.input.goal === cycleOneInput.prompt,
    ).length,
    1,
    'cycle 2 must reuse cycle 1 web research',
  );
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'planning' && call.input.goal === cycleOneInput.prompt,
    ).length,
    2,
    'each cycle still receives its own adapted plan',
  );
  const recoveredCycleTwo = await getSavedPlan();
  assert.equal(recoveredCycleTwo.status, 200);
  assert.equal(recoveredCycleTwo.body.input.prompt, cycleOneInput.prompt);
  assert.equal(recoveredCycleTwo.body.input.cycleNumber, 2);
  assert.equal(
    recoveredCycleTwo.body.meta.researchResponseId,
    'resp_research_cycle_program',
  );
  assert.equal(recoveredCycleTwo.body.meta.sources[0].url, 'https://cycle.example/research');

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

  const callsBeforeReuseOnlyMiss = apiCalls.length;
  const reuseOnlyMiss = await postPlan(
    goalInput('Never create paid work during saved-response revalidation', 'quick'),
    'actum_test_reuse_only_miss_022',
    { reuseOnly: true },
  );
  assert.equal(reuseOnlyMiss.status, 409);
  assert.equal(reuseOnlyMiss.body.code, 'saved_response_unavailable');
  assert.match(reuseOnlyMiss.body.error, /больше недоступен/);
  assert.equal(apiCalls.length, callsBeforeReuseOnlyMiss);

  const invalidReuseOnly = await postPlan(
    invalidInput,
    'actum_test_invalid_reuse_only_023',
    { reuseOnly: true },
  );
  assert.equal(invalidReuseOnly.status, 502);
  assert.equal(invalidReuseOnly.body.code, 'upstream_invalid_plan_json');
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'planning' && call.input.goal === 'Cache invalid completed output',
    ).length,
    1,
  );

  const offAppInput = goalInput('Reject off-app completed output', 'quick');
  const offAppFirst = await postPlan(offAppInput, 'actum_test_off_app_016');
  assert.equal(offAppFirst.status, 502);
  assert.equal(offAppFirst.body.code, 'upstream_invalid_plan_contract');
  assert.match(offAppFirst.body.error, /days\.0\.execution\.blocks\.0\.instruction/);
  assert.match(offAppFirst.body.error, /внешняя зависимость/);
  const offAppSecond = await postPlan(offAppInput, 'actum_test_off_app_017');
  assert.equal(offAppSecond.status, 502);
  assert.equal(offAppSecond.body.code, 'upstream_invalid_plan_contract');
  assert.equal(
    apiCalls.filter(
      (call) => call.kind === 'planning' && call.input.goal === 'Reject off-app completed output',
    ).length,
    1,
  );

  const scheduleInput = goalInput('Reject mismatched calendar output', 'quick');
  const mismatchedSchedule = await postPlan(scheduleInput, 'actum_test_schedule_018');
  assert.equal(mismatchedSchedule.status, 502);
  assert.equal(mismatchedSchedule.body.code, 'upstream_invalid_plan_contract');
  assert.match(mismatchedSchedule.body.error, /days\.0\.dayNumber/);
  const scheduleRetry = await postPlan(scheduleInput, 'actum_test_schedule_retry_021');
  assert.equal(scheduleRetry.status, 502);
  assert.equal(scheduleRetry.body.code, 'upstream_invalid_plan_contract');
  assert.equal(
    apiCalls.filter(
      (call) =>
        call.kind === 'planning' && call.input.goal === 'Reject mismatched calendar output',
    ).length,
    1,
  );

  const terminalInput = goalInput('Retain terminal provider outcome', 'quick');
  const terminalFirst = await postPlan(terminalInput, 'actum_test_terminal_019');
  assert.equal(terminalFirst.status, 502);
  assert.equal(terminalFirst.body.code, 'terminal_test_failure');
  const terminalPostCount = apiCalls.filter(
    (call) =>
      call.kind === 'planning' && call.input.goal === 'Retain terminal provider outcome',
  ).length;
  gatewayHandler = (
    await import(`../scripts/ai-server.mjs?restart-after-terminal=${Date.now()}`)
  ).handleRequest;
  const terminalSecond = await postPlan(terminalInput, 'actum_test_terminal_retry_020');
  assert.equal(terminalSecond.status, 502);
  assert.equal(terminalSecond.body.code, 'terminal_test_failure');
  assert.equal(
    apiCalls.filter(
      (call) =>
        call.kind === 'planning' && call.input.goal === 'Retain terminal provider outcome',
    ).length,
    terminalPostCount,
  );
  assert.equal(
    apiCalls.filter((call) => call.kind === 'terminal_poll').length,
    1,
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
  assert.match(joinedLogs, /actum_test_off_app_017 stage=planning stage_result_cache_hit/);
  assert.match(joinedLogs, /contract_path=days\.0\.execution\.blocks\.0\.instruction/);
  assert.match(joinedLogs, /actum_test_cache_003 cache_hit/);
  assert.doesNotMatch(joinedLogs, /actum_test_cache_003 inflight_join/);
  assert.match(joinedLogs, /inflight_join/);
  assert.doesNotMatch(joinedLogs, /test-only-openai-key/);
  assert.doesNotMatch(joinedLogs, /Resume paid background work/);
  assert.doesNotMatch(joinedLogs, /Authorization/);
});

test('saved-plan recovery ignores an old plan-v5 artifact without deleting it', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'actum-v5-recovery-test-'));
  const stateFile = join(directory, 'ai-state.json');
  const oldHandler = gatewayHandler;
  const oldStateFile = process.env.ACTUM_AI_STATE_FILE;
  t.after(() => {
    gatewayHandler = oldHandler;
    process.env.ACTUM_AI_STATE_FILE = oldStateFile;
    rmSync(directory, { recursive: true, force: true });
  });

  const state = createDurableState({ stateFile });
  state.recordStageResult(
    providerStageKey('legacy-v5', 'planning'),
    {
      id: 'resp_legacy_v5',
      status: 'completed',
      completed_at: Date.now() / 1000,
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                title: 'Legacy plan',
                targetTimeline: '1 year',
                days: Array.from({ length: 30 }, () => ({})),
              }),
              annotations: [],
            },
          ],
        },
      ],
    },
    'actum_legacy_v5',
    { prompt: 'Legacy prompt' },
  );
  process.env.ACTUM_AI_STATE_FILE = stateFile;
  gatewayHandler = (
    await import(`../scripts/ai-server.mjs?legacy-v5=${Date.now()}`)
  ).handleRequest;

  const response = await getSavedPlan();
  assert.equal(response.status, 404);
  assert.match(response.body.error, /plan-v6 не найден/);
});

test('saved cycle recovery keeps its linked research after thirty days', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'actum-linked-research-test-'));
  const stateFile = join(directory, 'ai-state.json');
  const oldHandler = gatewayHandler;
  const oldStateFile = process.env.ACTUM_AI_STATE_FILE;
  t.after(() => {
    gatewayHandler = oldHandler;
    process.env.ACTUM_AI_STATE_FILE = oldStateFile;
    rmSync(directory, { recursive: true, force: true });
  });

  const input = goalInput('Recover a cycle with month-old research');
  const researchKey = createResearchCacheKey(input);
  const planKey = createPlanCacheKey(input);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60_000;
  const oldState = createDurableState({ stateFile, now: () => thirtyDaysAgo });
  oldState.saveResearch(researchKey, {
    brief: 'Month-old program research.',
    sources: [{ title: 'Linked source', url: 'https://linked.example/research' }],
    meta: {
      providerResponseId: 'resp_research_month_old',
      webSearchCount: 3,
      inputTokens: 20,
      outputTokens: 10,
    },
  });

  const currentState = createDurableState({ stateFile });
  const providerInput = {
    goal: input.prompt,
    startingPoint: input.currentLevel,
    userBaseline: input.baseline,
    trustedBaseline: { value: 8, unit: 'reps' },
    trustedTarget: null,
    duration: input.duration,
    totalCycles: 12,
    cycleNumber: 1,
    minutesPerMission: input.dailyMinutes,
    cycleDays: 30,
    programContext: null,
    researchCacheKey: researchKey,
    researchBrief: 'Month-old program research.',
    verifiedSources: [{ title: 'Linked source', url: 'https://linked.example/research' }],
  };
  currentState.recordStageResult(
    providerStageKey(planKey, 'planning'),
    planPayload('resp_plan_month_old_research', providerInput),
    'actum_month_old_recovery',
    {
      prompt: input.prompt,
      currentLevel: input.currentLevel,
      baseline: input.baseline,
      duration: input.duration,
      cycleNumber: 1,
      dailyMinutes: input.dailyMinutes,
      researchMode: 'web',
      researchCacheKey: researchKey,
    },
  );

  process.env.ACTUM_AI_STATE_FILE = stateFile;
  gatewayHandler = (
    await import(`../scripts/ai-server.mjs?month-old-research=${Date.now()}`)
  ).handleRequest;
  const response = await getSavedPlan();
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.researchResponseId, 'resp_research_month_old');
  assert.equal(response.body.meta.webSearchCount, 3);
  assert.equal(response.body.meta.sources[0].url, 'https://linked.example/research');
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
    currentLevel: 'starting',
    baseline: 'Current test baseline: 8 repetitions',
    duration: 'year',
    cycleNumber: 1,
    researchMode,
  };
}

function researchPayload(goal = '') {
  const interleaved = goal === 'Interleaved research program';
  const cycleProgram = goal === 'Reuse research in the next cycle';
  const responseId = interleaved
    ? 'resp_research_interleaved'
    : cycleProgram
      ? 'resp_research_cycle_program'
      : 'resp_research_test';
  const sourceUrl = interleaved
    ? 'https://interleaved.example/research'
    : cycleProgram
      ? 'https://cycle.example/research'
      : 'https://example.com/research';
  return {
    id: responseId,
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        action: { type: 'search', query: 'authoritative method evidence' },
      },
      {
        type: 'web_search_call',
        action: { type: 'search', query: 'concrete practice protocol' },
      },
      {
        type: 'web_search_call',
        action: { type: 'search', query: 'progression and measurement guidance' },
      },
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
                  url: sourceUrl,
                },
              },
              {
                type: 'url_citation',
                url_citation: {
                  title: 'Second verified source',
                  url: 'https://example.org/protocol',
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

let fakeResponseTimestamp = 2_000_000_000;

function planPayload(responseId = 'resp_plan_test', input) {
  return {
    id: responseId,
    status: 'completed',
    completed_at: ++fakeResponseTimestamp,
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(validPlan(input)), annotations: [] }],
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

function terminalPlanFailurePayload() {
  return {
    id: 'resp_terminal_plan_test',
    status: 'failed',
    error: {
      code: 'terminal_test_failure',
      message: 'Terminal provider failure used by the local no-cost integration test.',
    },
  };
}

function offAppPlanPayload(input) {
  const plan = validPlan(input);
  plan.days[0].execution.blocks[0].instruction =
    'Send the result as an email message after every set.';
  return {
    id: 'resp_off_app_plan_test',
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(plan), annotations: [] }],
      },
    ],
  };
}

function scheduleMismatchPlanPayload(input) {
  const plan = validPlan(input);
  plan.days.forEach((day) => {
    day.dayNumber = 30;
  });
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

function validPlan(input = {}) {
  const goal = input.goal || 'Resume paid background work';
  const baselineStatement = input.userBaseline || 'Current test baseline: 8 repetitions';
  const trustedBaseline = input.trustedBaseline || { value: 8, unit: 'reps' };
  const duration = input.duration || 'year';
  const totalCycles = input.totalCycles || 12;
  const cycleNumber = input.cycleNumber || 1;
  const phases = [
    { title: 'Chapter 1', subtitle: 'Test phase 1', startDay: 1, endDay: 10 },
    { title: 'Chapter 2', subtitle: 'Test phase 2', startDay: 11, endDay: 20 },
    { title: 'Chapter 3', subtitle: 'Test phase 3', startDay: 21, endDay: 30 },
  ];
  const roadmap = input.programContext?.roadmap
    ? structuredClone(input.programContext.roadmap)
    : Array.from({ length: totalCycles }, (_, index) => ({
        cycleNumber: index + 1,
        title: `Program cycle ${index + 1}`,
        focus: 'Complete the assigned measurable practice inside Actum.',
        targetValue: null,
        targetUnit: null,
      }));
  return {
    title: 'Test route',
    domain: 'practice',
    targetMetric: 'Complete thirty explicit calendar days',
    duration,
    totalCycles,
    cycleNumber,
    target: {
      userStatement: goal,
      normalizedMetric: 'Completed practice result',
      value: null,
      unit: null,
    },
    cycleGoal: 'Complete the current measurable cycle inside Actum.',
    roadmap,
    assessment: {
      dayNumber: 30,
      blockIndex: 0,
      metric: 'Completed practice result',
      targetValue: roadmap[cycleNumber - 1].targetValue,
      targetUnit: roadmap[cycleNumber - 1].targetUnit,
    },
    summary: 'A deterministic route used only by the local no-cost integration test.',
    baseline: {
      userStatement: baselineStatement,
      normalizedMetric: 'Controlled repetitions',
      value: trustedBaseline.value,
      unit: trustedBaseline.unit,
      calculationRule: 'Keep the measured baseline fixed throughout this test cycle.',
    },
    safetyNotes: ['Stop if uncomfortable.'],
    assumptions: ['The user can practice for twenty minutes.'],
    sourceLabels: ['Verified source'],
    phases,
    days: Array.from({ length: 30 }, (_, index) => {
      const dayNumber = index + 1;
      const phaseIndex = dayNumber <= 10 ? 1 : dayNumber <= 20 ? 2 : 3;
      return {
        dayNumber,
        phaseIndex,
        title: `Day ${dayNumber} controlled practice`,
        description: 'Perform a small, measurable practice step.',
        type: 'practice',
        estimatedMinutes: 10,
        xp: 20,
        execution: {
          kind: 'in_app',
          blocks: [
            {
              kind: 'counter',
              title: 'Controlled test repetitions',
              instruction: 'Complete each repetition with the same range of motion.',
              sets: 3,
              targetPerSet: trustedBaseline.value,
              unit: trustedBaseline.unit,
              unitLabel: null,
              workSecondsPerSet: 32,
              restSeconds: 30,
              tempo: 'Steady controlled tempo',
              loadBasis: {
                percentage: 100,
                baseValue: trustedBaseline.value,
                baseUnit: trustedBaseline.unit,
                result: trustedBaseline.value,
              },
              successCriterion: 'All eight repetitions keep the prescribed tempo.',
            },
          ],
          successCriterion: 'All three sets are completed with eight controlled repetitions.',
        },
        warning: null,
      };
    }),
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_test', ...headers },
  });
}

function postPlan(payload, requestId, { reuseOnly = false } = {}) {
  return invokeHandler({
    method: 'POST',
    url: '/plan',
    headers: {
      'content-type': 'application/json',
      'x-actum-request-id': requestId,
      ...(reuseOnly ? { 'x-actum-reuse-only': 'true' } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function getHealth() {
  return invokeHandler({ method: 'GET', url: '/health', headers: {}, body: '' });
}

function getSavedPlan() {
  return invokeHandler({ method: 'GET', url: '/saved-plan/latest', headers: {}, body: '' });
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
