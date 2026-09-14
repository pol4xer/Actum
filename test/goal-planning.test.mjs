import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

process.env.TZ = 'UTC';

register(new URL('./typescript-extension-loader.mjs', import.meta.url));

const { createPlanResponseDtoSchema, savedPlanEnvelopeDtoSchema } = await import(
  '@/features/goal-planning/api-contract'
);
const {
  AIPlannerError,
  GOAL_NOT_FEASIBLE_MESSAGE,
  RETRY_CAP_TOO_SHORT_MESSAGE,
  SAVED_RESPONSE_RETRY_LABEL,
  SAVED_RESPONSE_REVIEW_MESSAGE,
  mapServerErrorCode,
  RESEARCH_CACHE_UNAVAILABLE_MESSAGE,
  isFeasibilityPlannerError,
  shouldOfferPlannerRetry,
} = await import(
  '@/features/goal-planning/errors'
);
const { mapPlanDtoToGeneratedGoal } = await import(
  '@/features/goal-planning/generated-goal-mapper'
);
const { HttpGoalPlanner } = await import(
  '@/features/goal-planning/http-goal-planner'
);
const { recoveredCurrentLevel, shouldReuseSavedResponseForRetry } = await import(
  '@/features/goal-planning/use-goal-builder-controller'
);
const { createNextCycleInput, reusableResearchAnchor } = await import(
  '@/features/goal-planning/next-cycle-input'
);
const {
  RETRY_LIMIT_HELP,
  RETRY_LIMIT_OPTIONS,
  RETRY_LIMIT_QUESTION,
  estimatedTargetCycleLabel,
  retryLimitLabel,
} = await import('@/features/goal-planning/program-labels');
const { createProgramRoadmapPresentation, roadmapMilestoneMetricLabel } = await import(
  '@/features/goal-planning/program-roadmap-model'
);

test('test loader resolves public feature barrels and TSX modules like Expo', () => {
  assert.match(import.meta.resolve('@/features/goal-planning'), /\/goal-planning\/index\.ts$/u);
  assert.match(import.meta.resolve('@/features/goal-planning/goal-builder'), /goal-builder\.tsx$/u);
});

const input = {
  prompt: '  Прочитать 120 страниц  ',
  currentLevel: 'some-experience',
  baseline: 'Сейчас читаю 8 страниц',
  duration: 'half-year',
  dailyMinutes: 20,
  researchMode: 'web',
};
const RESEARCH_ANCHOR = 'a'.repeat(64);

test('retry-cap copy keeps ASAP target separate from the required limit choice', () => {
  assert.equal(RETRY_LIMIT_QUESTION, 'What if one month is not enough?');
  assert.deepEqual(RETRY_LIMIT_OPTIONS, [
    { value: 'month', label: 'Stop after one month' },
    { value: 'half-year', label: 'Continue for up to 6 months' },
    { value: 'year', label: 'Continue for up to a year' },
  ]);
  assert.match(RETRY_LIMIT_HELP, /earliest realistic month/u);
  assert.match(RETRY_LIMIT_HELP, /does not stretch out the plan/u);
  assert.equal(retryLimitLabel('month'), '1 month');
  assert.equal(retryLimitLabel('half-year'), 'up to 6 months');
  assert.equal(retryLimitLabel('year'), 'up to a year');
  assert.equal(estimatedTargetCycleLabel(2), 'Month 2');
  assert.equal(estimatedTargetCycleLabel(undefined), undefined);
});

test('roadmap progress ends at the estimated target and keeps later retries in reserve', () => {
  const roadmap = Array.from({ length: 12 }, (_, index) => ({
    cycleNumber: index + 1,
    title: `Месяц ${index + 1}`,
    focus: `Фокус ${index + 1}`,
    targetValue: index >= 2 ? 600 : (index + 1) * 200,
    targetUnit: 'seconds',
  }));
  const program = {
    duration: 'year',
    totalDays: 365,
    totalCycles: 12,
    activeCycle: 2,
    target: {
      userStatement: 'Задерживать дыхание 10 минут',
      normalizedMetric: 'Длительность задержки',
      value: 600,
      unit: 'seconds',
    },
    roadmap,
    completedCycles: [
      {
        cycleNumber: 1,
        completedAt: '2026-10-03T12:00:00.000Z',
        measuredValue: 180,
        unit: 'seconds',
      },
    ],
  };

  const direct = createProgramRoadmapPresentation(program, 3);
  assert.equal(direct.progress, 1 / 3);
  assert.equal(direct.plannedCycles, 3);
  assert.deepEqual(
    direct.primaryMilestones.map(({ milestone }) => milestone.cycleNumber),
    [1, 2, 3],
  );
  assert.deepEqual(
    direct.reserveMilestones.map(({ milestone }) => milestone.cycleNumber),
    [4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(direct.primaryMilestones[0].result.measuredValue, 180);
  assert.equal(
    roadmapMilestoneMetricLabel(direct.primaryMilestones[0]),
    'Actual 3 min · target 3:20',
  );
  assert.equal(
    roadmapMilestoneMetricLabel(direct.primaryMilestones[1]),
    'Target 6:40',
  );

  const legacy = createProgramRoadmapPresentation(program, undefined);
  assert.equal(legacy.progress, 1 / 12);
  assert.equal(legacy.plannedCycles, 12);
  assert.equal(legacy.primaryMilestones.length, 12);
  assert.deepEqual(legacy.reserveMilestones, []);

  const achieved = createProgramRoadmapPresentation(
    {
      ...program,
      achievement: {
        cycleNumber: 2,
        completedAt: '2026-10-20T12:00:00.000Z',
        measuredValue: 600,
        unit: 'seconds',
      },
    },
    3,
  );
  assert.equal(achieved.progress, 1);
  assert.equal(achieved.plannedCycles, 2);
  assert.equal(achieved.primaryMilestones.length, 2);
  assert.equal(achieved.reserveMilestones.length, 0);
  assert.equal(achieved.primaryMilestones[1].achievement.measuredValue, 600);
  assert.equal(
    roadmapMilestoneMetricLabel(achieved.primaryMilestones[1]),
    'Actual 10 min · target 6:40',
  );
});

test('plan-v7 API DTO remains strict and trims contract text', () => {
  const raw = createResponseFixture();
  raw.plan.title = '  Прочитать 120 страниц  ';

  const parsed = createPlanResponseDtoSchema(input).parse(raw);
  assert.equal(parsed.plan.title, 'Прочитать 120 страниц');

  const wrongContract = structuredClone(raw);
  wrongContract.meta.contractVersion = 'plan-v6';
  assert.equal(createPlanResponseDtoSchema(input).safeParse(wrongContract).success, false);

  const malformedResearchAnchor = structuredClone(raw);
  malformedResearchAnchor.meta.researchAnchor = 'ABC123';
  assert.equal(
    createPlanResponseDtoSchema(input).safeParse(malformedResearchAnchor).success,
    false,
  );

  const fractionalDiscreteCounter = structuredClone(raw);
  fractionalDiscreteCounter.plan.days[1].execution.blocks[0].targetPerSet = 2.5;
  const rejected = createPlanResponseDtoSchema(input).safeParse(fractionalDiscreteCounter);
  assert.equal(rejected.success, false);
  assert.ok(
    rejected.error.issues.some(
      (issue) => issue.path.join('.') === 'plan.days.1.execution.blocks.0.targetPerSet',
    ),
  );

  const missingPrimaryIndex = structuredClone(raw);
  delete missingPrimaryIndex.plan.days[0].execution.primaryBlockIndex;
  assert.equal(
    createPlanResponseDtoSchema(input).safeParse(missingPrimaryIndex).success,
    false,
  );

  const invalidPrimaryBlock = structuredClone(raw);
  invalidPrimaryBlock.plan.days[0].execution.blocks = [
    invalidPrimaryBlock.plan.days[0].execution.blocks[0],
    {
      kind: 'checklist',
      title: 'Проверка главы',
      items: ['Назвать главную мысль'],
      estimatedSeconds: 60,
      successCriterion: 'Главная мысль названа.',
    },
  ];
  invalidPrimaryBlock.plan.days[0].execution.primaryBlockIndex = 1;
  assert.equal(
    createPlanResponseDtoSchema(input).safeParse(invalidPrimaryBlock).success,
    false,
  );
});

test('saved plan recovery accepts an optional valid research anchor only', () => {
  const response = createResponseFixture();
  const recoveryInput = {
    ...input,
    cycleNumber: 2,
    programContext: {
      target: response.plan.target,
      roadmap: response.plan.roadmap,
      completedCycles: [],
      researchAnchor: RESEARCH_ANCHOR,
      targetCycleNumber: 3,
    },
  };
  const envelope = {
    input: recoveryInput,
    plan: response.plan,
    meta: response.meta,
  };

  assert.equal(savedPlanEnvelopeDtoSchema.safeParse(envelope).success, true);

  const legacyWithoutAnchor = structuredClone(envelope);
  delete legacyWithoutAnchor.input.programContext.researchAnchor;
  assert.equal(savedPlanEnvelopeDtoSchema.safeParse(legacyWithoutAnchor).success, true);

  const malformedAnchor = structuredClone(envelope);
  malformedAnchor.input.programContext.researchAnchor = 'abc';
  assert.equal(savedPlanEnvelopeDtoSchema.safeParse(malformedAnchor).success, false);

  const malformedTargetCycle = structuredClone(envelope);
  malformedTargetCycle.input.programContext.targetCycleNumber = 13;
  assert.equal(savedPlanEnvelopeDtoSchema.safeParse(malformedTargetCycle).success, false);
});

test('DTO mapper is deterministic with injected clock and ID factory', () => {
  const parsed = createPlanResponseDtoSchema(input).parse(createResponseFixture());
  deepFreeze(parsed);

  let clockCalls = 0;
  let idFactoryCalls = 0;
  let sequence = 0;
  const generated = mapPlanDtoToGeneratedGoal(input, parsed.plan, parsed.meta, {
    clock: () => {
      clockCalls += 1;
      return new Date('2026-01-31T12:00:00.000Z');
    },
    idFactory: () => {
      idFactoryCalls += 1;
      return (prefix) => `${prefix}-${++sequence}`;
    },
  });

  assert.equal(clockCalls, 1);
  assert.equal(idFactoryCalls, 1);
  assert.equal(generated.goal.id, 'goal-34');
  assert.equal(generated.plan.id, 'plan-35');
  assert.deepEqual(
    generated.plan.chapters.map((chapter) => chapter.id),
    ['chapter-1', 'chapter-2', 'chapter-3'],
  );
  assert.equal(generated.goal.rawPrompt, 'Прочитать 120 страниц');
  assert.equal(generated.goal.createdAt, '2026-01-31T12:00:00.000Z');
  assert.equal(generated.goal.targetDate, '2026-04-30T12:00:00.000Z');
  assert.equal(generated.plan.missions[0].scheduledDate, '2026-01-31');
  assert.equal(generated.plan.missions[1].scheduledDate, '2026-02-01');
  assert.equal(generated.plan.missions[29].scheduledDate, '2026-03-01');
  assert.equal(generated.plan.missions[0].chapterId, 'chapter-1');
  assert.equal(generated.plan.missions[10].chapterId, 'chapter-2');
  assert.equal(generated.plan.missions[29].chapterId, 'chapter-3');
  assert.equal(generated.plan.missions[0].execution.blocks[0].loadBasis, undefined);
  assert.equal(generated.plan.missions[29].execution.blocks[0].unitLabel, undefined);
  assert.equal(generated.plan.research.method, 'openai-web-research-v1');
  assert.equal(generated.plan.research.request.requestId, 'request-123');
  assert.equal(generated.plan.research.researchAnchor, RESEARCH_ANCHOR);
  assert.equal(generated.plan.version, 7);
  assert.equal(generated.plan.currentLevel, 'some-experience');
  assert.equal(generated.goal.program.duration, 'half-year');
  assert.equal(generated.goal.program.totalCycles, 6);
  assert.equal(generated.goal.program.target.value, 120);
  assert.equal(generated.plan.cycleNumber, 1);
  assert.equal(generated.plan.targetCycleNumber, 3);
  assert.equal(generated.plan.assessment.dayNumber, 30);
  assert.equal(generated.plan.missions[0].execution.primaryBlockIndex, 0);
});

test('saved plan recovery preserves the exact current-level research identity', () => {
  const returningInput = { ...input, currentLevel: 'returning' };
  const parsed = createPlanResponseDtoSchema(returningInput).parse(
    createResponseFixture(),
  );
  const generated = mapPlanDtoToGeneratedGoal(
    returningInput,
    parsed.plan,
    parsed.meta,
  );

  assert.equal(generated.plan.currentLevel, 'returning');
  assert.equal(recoveredCurrentLevel(generated.plan), 'returning');

  const legacy = structuredClone(generated.plan);
  delete legacy.currentLevel;
  assert.equal(recoveredCurrentLevel(legacy), 'some-experience');
});

test('server error mapping preserves free reuse-only and retry semantics', () => {
  assert.equal(
    mapServerErrorCode({ code: 'saved_response_unavailable' }, 409),
    'SAVED_RESPONSE_UNAVAILABLE',
  );
  assert.equal(
    mapServerErrorCode({ code: 'research_cache_unavailable' }, 409),
    'RESEARCH_CACHE_UNAVAILABLE',
  );
  assert.equal(
    mapServerErrorCode({ code: 'research_target_exceeds_retry_cap' }, 422),
    'RETRY_CAP_TOO_SHORT',
  );
  assert.equal(
    mapServerErrorCode({ code: 'research_target_not_feasible' }, 422),
    'GOAL_NOT_FEASIBLE',
  );
  assert.equal(
    RESEARCH_CACHE_UNAVAILABLE_MESSAGE,
    'Saved research is unavailable. No new search was started.',
  );
  assert.equal(
    mapServerErrorCode({ code: 'upstream_invalid_plan_contract' }, 502),
    'INVALID_RESPONSE',
  );
  assert.equal(
    mapServerErrorCode({ code: 'upstream_invalid_research_json' }, 502),
    'INVALID_RESPONSE',
  );
  assert.equal(
    mapServerErrorCode({ code: 'upstream_invalid_research_contract' }, 502),
    'INVALID_RESPONSE',
  );
  assert.equal(mapServerErrorCode({ code: 'upstream_timeout' }, 504), 'UPSTREAM_TIMEOUT');
  assert.equal(mapServerErrorCode({ code: 'refusal' }, 500), 'REFUSAL');
  assert.equal(mapServerErrorCode({}, 400), 'INVALID_REQUEST');
  assert.equal(mapServerErrorCode({}, 500), 'UPSTREAM_ERROR');
  assert.equal(shouldReuseSavedResponseForRetry('INVALID_RESPONSE'), true);
  assert.equal(shouldReuseSavedResponseForRetry('UPSTREAM_TIMEOUT'), false);
  assert.equal(shouldReuseSavedResponseForRetry('SAVED_RESPONSE_UNAVAILABLE'), false);
  assert.equal(shouldReuseSavedResponseForRetry('RESEARCH_CACHE_UNAVAILABLE'), false);
  assert.equal(isFeasibilityPlannerError('RETRY_CAP_TOO_SHORT'), true);
  assert.equal(isFeasibilityPlannerError('GOAL_NOT_FEASIBLE'), true);
  assert.equal(RETRY_CAP_TOO_SHORT_MESSAGE, 'Choose a longer time limit.');
  assert.equal(
    GOAL_NOT_FEASIBLE_MESSAGE,
    'Research could not confirm that this goal is achievable within a year.',
  );
  assert.equal(shouldOfferPlannerRetry('RETRY_CAP_TOO_SHORT'), false);
  assert.equal(shouldOfferPlannerRetry('GOAL_NOT_FEASIBLE'), false);
  assert.equal(shouldOfferPlannerRetry('RESEARCH_CACHE_UNAVAILABLE'), false);
  assert.equal(shouldOfferPlannerRetry('UPSTREAM_TIMEOUT'), true);
  assert.equal(
    SAVED_RESPONSE_REVIEW_MESSAGE,
    'The response is saved and ready for another validation attempt',
  );
  assert.equal(
    SAVED_RESPONSE_RETRY_LABEL,
    'Validate saved response · no GPT request',
  );
});

test('next cycle input reuses program research context but keeps the execution journal local', () => {
  const parsed = createPlanResponseDtoSchema(input).parse(createResponseFixture());
  const generated = mapPlanDtoToGeneratedGoal(input, parsed.plan, parsed.meta, {
    clock: () => new Date('2026-01-31T12:00:00.000Z'),
    idFactory: () => {
      let sequence = 0;
      return (prefix) => `${prefix}-${++sequence}`;
    },
  });
  generated.goal.program.completedCycles = [
    {
      cycleNumber: 1,
      completedAt: '2026-03-01T12:00:00.000Z',
      measuredValue: 24,
      unit: 'pages',
    },
  ];

  const next = createNextCycleInput(generated.goal, generated.plan, '  24 страницы  ');
  assert.equal(next.cycleNumber, 2);
  assert.equal(next.baseline, '24 страницы');
  assert.equal(next.duration, 'half-year');
  assert.equal(next.researchMode, 'web');
  assert.deepEqual(next.programContext.target, generated.goal.program.target);
  assert.deepEqual(next.programContext.roadmap, generated.goal.program.roadmap);
  assert.deepEqual(
    next.programContext.completedCycles,
    generated.goal.program.completedCycles,
  );
  assert.equal(next.programContext.researchAnchor, RESEARCH_ANCHOR);
  assert.equal(next.programContext.targetCycleNumber, 3);
  assert.equal(reusableResearchAnchor(generated.plan), RESEARCH_ANCHOR);
  assert.equal('missionRuns' in next, false);

  generated.plan.version = 6;
  assert.equal(
    createNextCycleInput(generated.goal, generated.plan, '24 страницы').researchMode,
    'quick',
  );

  generated.plan.version = 7;
  generated.plan.research.researchAnchor = undefined;
  const missingAnchor = createNextCycleInput(
    generated.goal,
    generated.plan,
    '24 страницы',
  );
  assert.equal(missingAnchor.researchMode, 'quick');
  assert.equal('researchAnchor' in missingAnchor.programContext, false);
  assert.equal(reusableResearchAnchor(generated.plan), undefined);

  generated.plan.research.researchAnchor = 'not-a-valid-anchor';
  const malformedAnchor = createNextCycleInput(
    generated.goal,
    generated.plan,
    '24 страницы',
  );
  assert.equal(malformedAnchor.researchMode, 'quick');
  assert.equal('researchAnchor' in malformedAnchor.programContext, false);
  assert.equal(reusableResearchAnchor(generated.plan), undefined);

  generated.goal.program.activeCycle = generated.goal.program.totalCycles;
  assert.throws(
    () => createNextCycleInput(generated.goal, generated.plan, '24 страницы'),
    /no next cycle/u,
  );
});

test('HTTP adapter marks reuse-only validation and never rebills saved-plan recovery', async () => {
  const response = createResponseFixture();
  const mapped = { marker: 'mapped goal' };
  const generationCalls = [];
  const generationPlanner = new HttpGoalPlanner({
    baseUrl: 'https://planner.test/',
    requestIdFactory: () => 'client-request-123',
    mapper: () => mapped,
    fetch: async (url, init) => {
      generationCalls.push({ url, init });
      return Response.json(response);
    },
  });

  assert.equal(await generationPlanner.generateGoal(input, { reuseOnly: true }), mapped);
  assert.equal(generationCalls.length, 1);
  assert.equal(generationCalls[0].url, 'https://planner.test/plan');
  assert.equal(generationCalls[0].init.method, 'POST');
  assert.equal(generationCalls[0].init.headers['X-Actum-Request-Id'], 'client-request-123');
  assert.equal(generationCalls[0].init.headers['X-Actum-Reuse-Only'], 'true');
  assert.deepEqual(JSON.parse(generationCalls[0].init.body), input);

  const recoveryCalls = [];
  const recoveryPlanner = new HttpGoalPlanner({
    baseUrl: 'https://planner.test',
    mapper: () => mapped,
    fetch: async (url, init) => {
      recoveryCalls.push({ url, init });
      return Response.json({ input, plan: response.plan, meta: response.meta });
    },
  });

  assert.equal(await recoveryPlanner.recoverLatestSavedGoal(), mapped);
  assert.equal(recoveryCalls.length, 1);
  assert.equal(recoveryCalls[0].url, 'https://planner.test/saved-plan/latest');
  assert.equal(recoveryCalls[0].init.method, 'GET');
  assert.equal(recoveryCalls[0].init.body, undefined);
});

test('HTTP adapter exposes a research-cache miss without a hidden retry', async () => {
  let calls = 0;
  const planner = new HttpGoalPlanner({
    baseUrl: 'https://planner.test',
    requestIdFactory: () => 'client-request-cache-miss',
    fetch: async () => {
      calls += 1;
      return Response.json(
        {
          code: 'research_cache_unavailable',
          error:
            'Сохранённое исследование для следующего цикла недоступно. Actum не запустил новый web-поиск, чтобы избежать повторного списания.',
        },
        { status: 409 },
      );
    },
  });

  await assert.rejects(
    planner.generateGoal(input),
    (error) =>
      error instanceof AIPlannerError &&
      error.code === 'RESEARCH_CACHE_UNAVAILABLE' &&
      /не запустил новый web-поиск/u.test(error.message),
  );
  assert.equal(calls, 1);
});

function createResponseFixture() {
  const blocks = [
    {
      kind: 'timer',
      title: 'Чтение по таймеру',
      instruction: 'Читайте выбранную главу без отвлечений.',
      sets: 1,
      durationSecondsPerSet: 600,
      loadBasis: null,
      restSeconds: 0,
      successCriterion: 'Таймер завершён полностью.',
    },
    {
      kind: 'counter',
      title: 'Страницы',
      instruction: 'Прочитайте страницы и отметьте результат.',
      sets: 1,
      targetPerSet: 8,
      unit: 'pages',
      unitLabel: null,
      workSecondsPerSet: 600,
      restSeconds: 0,
      tempo: null,
      loadBasis: null,
      successCriterion: 'Прочитано восемь страниц.',
    },
    {
      kind: 'checklist',
      title: 'Проверка главы',
      items: ['Назвать главную мысль', 'Отметить новую идею'],
      estimatedSeconds: 180,
      successCriterion: 'Оба пункта отмечены.',
    },
    {
      kind: 'text_log',
      title: 'Короткий вывод',
      prompt: 'Запишите основной вывод прочитанного.',
      minCharacters: 20,
      maxCharacters: 300,
      estimatedSeconds: 180,
      successCriterion: 'Вывод сохранён в журнале.',
    },
  ];

  return {
    plan: {
      title: 'Прочитать 120 страниц',
      domain: 'read',
      duration: 'half-year',
      totalCycles: 6,
      cycleNumber: 1,
      targetCycleNumber: 3,
      target: {
        userStatement: 'Прочитать 120 страниц',
        normalizedMetric: 'Прочитанные страницы',
        value: 120,
        unit: 'pages',
      },
      targetMetric: 'Прочитать 120 страниц',
      cycleGoal: 'Дойти до устойчивого чтения 24 страниц за контрольную сессию.',
      summary: 'Полугодовой маршрут с подробным первым циклом на тридцать дней.',
      baseline: {
        userStatement: 'Сейчас читаю 8 страниц',
        normalizedMetric: 'Страниц за сессию',
        value: 8,
        unit: 'pages',
        calculationRule: 'Используется явно указанное число страниц.',
      },
      safetyNotes: [],
      assumptions: ['Книга уже выбрана пользователем.'],
      sourceLabels: ['Метод последовательного чтения'],
      roadmap: Array.from({ length: 6 }, (_, index) => ({
        cycleNumber: index + 1,
        title: `Месяц ${index + 1}`,
        focus: `Последовательный этап чтения ${index + 1}.`,
        targetValue: index >= 2 ? 120 : 24 + index * 48,
        targetUnit: 'pages',
      })),
      assessment: {
        dayNumber: 30,
        blockIndex: 0,
        metric: 'Прочитанные страницы за контрольную сессию',
        targetValue: 24,
        targetUnit: 'pages',
      },
      phases: [
        { title: 'Старт', subtitle: 'Дни один — десять', startDay: 1, endDay: 10 },
        { title: 'Ритм', subtitle: 'Дни одиннадцать — двадцать', startDay: 11, endDay: 20 },
        { title: 'Итог', subtitle: 'Дни двадцать один — тридцать', startDay: 21, endDay: 30 },
      ],
      days: Array.from({ length: 30 }, (_, index) => ({
        dayNumber: index + 1,
        phaseIndex: index < 10 ? 1 : index < 20 ? 2 : 3,
        title: `День чтения ${index + 1}`,
        description: 'Выполните назначенный блок чтения внутри Actum.',
        type: 'read',
        estimatedMinutes: 15,
        xp: 10,
        execution: {
          kind: 'in_app',
          primaryBlockIndex: 0,
          blocks: [
            structuredClone(
              index === 29
                ? {
                    ...blocks[1],
                    targetPerSet: 24,
                    successCriterion: 'Фактическое число страниц записано.',
                  }
                : blocks[index % 2],
            ),
            structuredClone(blocks[2 + (index % 2)]),
          ],
          successCriterion: 'Назначенный блок выполнен полностью.',
        },
        warning: null,
      })),
    },
    meta: {
      requestId: 'request-123',
      providerResponseId: 'response-123',
      researchResponseId: 'research-123',
      researchAnchor: RESEARCH_ANCHOR,
      model: 'gpt-test',
      promptVersion: 'prompt-v7',
      contractVersion: 'plan-v7',
      durationMs: 1234,
      webSearchCount: 2,
      inputTokens: 100,
      outputTokens: 200,
      sources: [{ title: 'Источник', url: 'https://example.com/reading' }],
    },
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
