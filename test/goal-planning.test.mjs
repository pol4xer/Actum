import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

process.env.TZ = 'UTC';

register(new URL('./typescript-extension-loader.mjs', import.meta.url));

const { createPlanResponseDtoSchema } = await import(
  '@/features/goal-planning/api-contract'
);
const { mapServerErrorCode } = await import('@/features/goal-planning/errors');
const { mapPlanDtoToGeneratedGoal } = await import(
  '@/features/goal-planning/generated-goal-mapper'
);
const { HttpGoalPlanner } = await import(
  '@/features/goal-planning/http-goal-planner'
);
const { shouldReuseSavedResponseForRetry } = await import(
  '@/features/goal-planning/use-goal-builder-controller'
);

test('test loader resolves public feature barrels and TSX modules like Expo', () => {
  assert.match(import.meta.resolve('@/features/goal-planning'), /\/goal-planning\/index\.ts$/u);
  assert.match(import.meta.resolve('@/features/goal-planning/goal-builder'), /goal-builder\.tsx$/u);
});

const input = {
  prompt: '  Прочитать книгу  ',
  currentLevel: 'some-experience',
  baseline: 'Сейчас читаю 8 страниц',
  targetTimeline: 'За два месяца',
  dailyMinutes: 20,
  horizonDays: 7,
  researchMode: 'web',
};

test('plan-v5 API DTO remains strict and trims contract text', () => {
  const raw = createResponseFixture();
  raw.plan.title = '  Прочитать книгу  ';

  const parsed = createPlanResponseDtoSchema(input).parse(raw);
  assert.equal(parsed.plan.title, 'Прочитать книгу');

  const wrongContract = structuredClone(raw);
  wrongContract.meta.contractVersion = 'plan-v4';
  assert.equal(createPlanResponseDtoSchema(input).safeParse(wrongContract).success, false);

  const fractionalDiscreteCounter = structuredClone(raw);
  fractionalDiscreteCounter.plan.days[1].execution.blocks[0].targetPerSet = 2.5;
  const rejected = createPlanResponseDtoSchema(input).safeParse(fractionalDiscreteCounter);
  assert.equal(rejected.success, false);
  assert.ok(
    rejected.error.issues.some(
      (issue) => issue.path.join('.') === 'plan.days.1.execution.blocks.0.targetPerSet',
    ),
  );
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
  assert.equal(generated.goal.id, 'goal-11');
  assert.equal(generated.plan.id, 'plan-12');
  assert.deepEqual(
    generated.plan.chapters.map((chapter) => chapter.id),
    ['chapter-1', 'chapter-2', 'chapter-3'],
  );
  assert.equal(generated.goal.rawPrompt, 'Прочитать книгу');
  assert.equal(generated.goal.createdAt, '2026-01-31T12:00:00.000Z');
  assert.equal(generated.goal.targetDate, '2026-02-06T12:00:00.000Z');
  assert.equal(generated.plan.missions[0].scheduledDate, '2026-01-31');
  assert.equal(generated.plan.missions[1].scheduledDate, '2026-02-01');
  assert.equal(generated.plan.missions[6].scheduledDate, '2026-02-06');
  assert.equal(generated.plan.missions[0].chapterId, 'chapter-1');
  assert.equal(generated.plan.missions[3].chapterId, 'chapter-2');
  assert.equal(generated.plan.missions[6].chapterId, 'chapter-3');
  assert.equal(generated.plan.missions[0].execution.blocks[0].loadBasis, undefined);
  assert.equal(generated.plan.missions[1].execution.blocks[0].unitLabel, undefined);
  assert.equal(generated.plan.research.method, 'openai-web-research-v1');
  assert.equal(generated.plan.research.request.requestId, 'request-123');
  assert.equal(generated.plan.version, 5);
});

test('server error mapping preserves free reuse-only and retry semantics', () => {
  assert.equal(
    mapServerErrorCode({ code: 'saved_response_unavailable' }, 409),
    'SAVED_RESPONSE_UNAVAILABLE',
  );
  assert.equal(
    mapServerErrorCode({ code: 'upstream_invalid_plan_contract' }, 502),
    'INVALID_RESPONSE',
  );
  assert.equal(mapServerErrorCode({ code: 'upstream_timeout' }, 504), 'UPSTREAM_TIMEOUT');
  assert.equal(mapServerErrorCode({ code: 'refusal' }, 500), 'REFUSAL');
  assert.equal(mapServerErrorCode({}, 400), 'INVALID_REQUEST');
  assert.equal(mapServerErrorCode({}, 500), 'UPSTREAM_ERROR');
  assert.equal(shouldReuseSavedResponseForRetry('INVALID_RESPONSE'), true);
  assert.equal(shouldReuseSavedResponseForRetry('UPSTREAM_TIMEOUT'), false);
  assert.equal(shouldReuseSavedResponseForRetry('SAVED_RESPONSE_UNAVAILABLE'), false);
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
      title: 'Прочитать книгу',
      domain: 'read',
      targetMetric: 'Закончить одну книгу',
      targetTimeline: 'За два месяца',
      summary: 'Семь дней последовательного чтения и заметок.',
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
      phases: [
        { title: 'Старт', subtitle: 'Дни один и два', startDay: 1, endDay: 2 },
        { title: 'Ритм', subtitle: 'Дни три — пять', startDay: 3, endDay: 5 },
        { title: 'Итог', subtitle: 'Дни шесть и семь', startDay: 6, endDay: 7 },
      ],
      days: Array.from({ length: 7 }, (_, index) => ({
        dayNumber: index + 1,
        phaseIndex: index < 2 ? 1 : index < 5 ? 2 : 3,
        title: `День чтения ${index + 1}`,
        description: 'Выполните назначенный блок чтения внутри Actum.',
        type: 'read',
        estimatedMinutes: 15,
        xp: 10,
        execution: {
          kind: 'in_app',
          blocks: [structuredClone(blocks[index % blocks.length])],
          successCriterion: 'Назначенный блок выполнен полностью.',
        },
        warning: null,
      })),
    },
    meta: {
      requestId: 'request-123',
      providerResponseId: 'response-123',
      researchResponseId: 'research-123',
      model: 'gpt-test',
      promptVersion: 'prompt-v5',
      contractVersion: 'plan-v5',
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
