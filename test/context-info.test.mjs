import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./typescript-extension-loader.mjs', import.meta.url));

const {
  executionBlockContextSections,
  missionContextSections,
  planContextSections,
} = await import('@/shared/presentation/context-info');
const { formatBaselineMetric, formatMetricValue, formatMissionDuration } = await import(
  '@/shared/presentation/plan-formatters'
);

test('built-in presentation uses English quantities and decimal formatting', () => {
  const mission = {
    estimatedMinutes: 10,
    execution: { kind: 'in_app', blocks: [{ kind: 'timer', sets: 1 }] },
  };
  assert.equal(formatMissionDuration(mission), '1 block · 1 record · ≈ 10 min');
  assert.equal(
    formatMissionDuration(mission, { inAppRecordLabel: 'check-ins' }),
    '1 block · 1 check-in · ≈ 10 min',
  );
  assert.equal(formatMetricValue(1, 'pages'), '1 page');
  assert.equal(formatMetricValue(2.5, 'meters'), '2.5 m');
  assert.equal(formatMetricValue(30, 'seconds'), '30 sec');
  assert.equal(formatMetricValue(90, 'seconds'), '1:30');
  assert.equal(
    formatBaselineMetric({ normalizedMetric: 'Distance', value: 2.5, unit: 'meters' }),
    'Distance · 2.5 meters',
  );
  assert.deepEqual(executionBlockContextSections({
    kind: 'timer',
    loadBasis: { percentage: 12.5, baseValue: 60, baseUnit: 'seconds', result: 7.5 },
  }), [{ heading: 'Load calculation', body: '12.5% × 60 sec = 7.5 sec' }]);
});

test('mission context keeps plan-v5 rationale but never legacy instructions', () => {
  const inAppMission = deepFreeze({
    id: 'mission-1',
    chapterId: 'chapter-1',
    sequence: 1,
    title: 'Первый день',
    description: '  Краткое объяснение роли этого дня.  ',
    type: 'practice',
    estimatedMinutes: 10,
    xp: 10,
    outcome: 'pending',
    completionCriterion: 'Старый дублирующий критерий.',
    warning: 'Остановись при дискомфорте.',
    execution: {
      kind: 'in_app',
      successCriterion: 'Все блоки дня завершены.',
      blocks: [
        {
          kind: 'timer',
          title: 'Рабочий блок',
          instruction: 'Эта исполняемая инструкция не должна попасть в контекст.',
          sets: 1,
          durationSecondsPerSet: 30,
          restSeconds: 0,
          successCriterion: 'Таймер завершён.',
        },
      ],
    },
  });

  assert.deepEqual(missionContextSections(inAppMission), [
    { heading: 'About this day', body: 'Краткое объяснение роли этого дня.' },
    { heading: 'Daily completion criterion', body: 'Все блоки дня завершены.' },
  ]);

  const legacyMission = deepFreeze({
    ...inAppMission,
    description: 'Выполни эту инструкцию.',
    completionCriterion: 'Исполняемый критерий остаётся рядом с действием.',
    execution: { kind: 'manual' },
  });
  assert.deepEqual(missionContextSections(legacyMission), []);
});

test('execution block context contains load provenance only', () => {
  const block = deepFreeze({
    kind: 'timer',
    title: 'Субмаксимальный подход',
    instruction: 'Выполняй точную технику.',
    sets: 3,
    durationSecondsPerSet: 40,
    restSeconds: 20,
    loadBasis: { percentage: 50, baseValue: 80, baseUnit: 'seconds', result: 40 },
    successCriterion: 'Завершены все три подхода.',
  });

  assert.deepEqual(executionBlockContextSections(block), [
    { heading: 'Load calculation', body: '50% × 80 sec = 40 sec' },
  ]);
  assert.equal(
    JSON.stringify(executionBlockContextSections(block)).includes(block.instruction),
    false,
  );
  assert.deepEqual(
    executionBlockContextSections({
      kind: 'checklist',
      title: 'Проверка',
      items: ['Первый пункт'],
      estimatedSeconds: 30,
      successCriterion: 'Пункт отмечен.',
    }),
    [],
  );
});

test('plan context exposes rationale and provenance without traversing executable missions', () => {
  const plan = deepFreeze({
    id: 'plan-1',
    version: 6,
    createdAt: '2026-08-04T12:00:00.000Z',
    dailyMinutes: 20,
    horizonDays: 7,
    cycleNumber: 1,
    totalCycles: 6,
    cycleGoal: 'Увеличить устойчивый результат первого месяца.',
    summary: 'Первый блок связан с долгосрочной целью.',
    baseline: {
      userStatement: 'Сейчас удерживаю 80 секунд.',
      normalizedMetric: 'Время удержания',
      value: 80,
      unit: 'seconds',
      calculationRule: 'Значение фиксируется на весь семидневный блок.',
    },
    targetTimeline: 'Шесть месяцев',
    chapters: [{ id: 'chapter-1', title: 'Старт', subtitle: 'Дни 1–7', order: 1 }],
    missions: [
      {
        id: 'mission-1',
        chapterId: 'chapter-1',
        sequence: 1,
        title: 'День 1',
        description: 'Контекст дня',
        type: 'practice',
        estimatedMinutes: 10,
        xp: 10,
        outcome: 'pending',
        execution: {
          kind: 'in_app',
          successCriterion: 'День завершён.',
          blocks: [
            {
              kind: 'timer',
              title: 'Секретная инструкция',
              instruction: 'Не переносить эту исполняемую инструкцию в плановый контекст.',
              sets: 1,
              durationSecondsPerSet: 40,
              restSeconds: 0,
              successCriterion: 'Таймер завершён.',
            },
          ],
        },
      },
    ],
    research: {
      method: 'openai-web-research-v1',
      confidence: 'medium',
      safetyNotes: ['Не выполнять под водой.'],
      assumptions: [
        'Практика проходит в безопасном месте.',
        'Доступно двадцать минут в день.',
      ],
      sourceLabels: ['Принцип субмаксимальной нагрузки'],
      sources: [{ title: 'Исследование нагрузки', url: 'https://example.com/research' }],
      request: {
        requestId: 'request-123',
        providerResponseId: 'response-123',
        model: 'gpt-test',
        promptVersion: 'plan-v5',
        durationMs: 1234,
        webSearchCount: 2,
        inputTokens: 100,
        outputTokens: 200,
      },
    },
  });

  const sections = planContextSections(plan);
  assert.deepEqual(
    sections.map((section) => section.heading),
    [
      'Plan version and method',
      'Plan rationale',
      'Current cycle',
      'Baseline and calculation',
      'Goal timeline',
      'Assumptions',
      'Methodology',
      'Sources',
      'Generation metadata',
    ],
  );
  assert.match(
    sections.find((section) => section.heading === 'Plan version and method')?.body ?? '',
    /Plan v6[\s\S]*Web research[\s\S]*medium/u,
  );
  assert.match(
    sections.find((section) => section.heading === 'Current cycle')?.body ?? '',
    /Cycle 1 of 6[\s\S]*Увеличить устойчивый результат/u,
  );
  assert.equal(JSON.stringify(sections).includes('Не выполнять под водой'), false);
  assert.equal(JSON.stringify(sections).includes('безопасном месте'), false);
  assert.match(
    sections.find((section) => section.heading === 'Sources')?.body ?? '',
    /https:\/\/example\.com\/research/u,
  );
  assert.match(
    sections.find((section) => section.heading === 'Generation metadata')?.body ?? '',
    /response-123[\s\S]*Input tokens: 100[\s\S]*Output tokens: 200/u,
  );
  assert.equal(
    JSON.stringify(sections).includes('Не переносить эту исполняемую инструкцию'),
    false,
  );

  const legacySections = planContextSections(
    { ...plan, baseline: undefined, targetTimeline: undefined },
    { baseline: plan.baseline, targetTimeline: 'Срок из сохранённой цели' },
  );
  assert.match(
    legacySections.find((section) => section.heading === 'Baseline and calculation')?.body ?? '',
    /80 сек/u,
  );
  assert.equal(
    legacySections.find((section) => section.heading === 'Goal timeline')?.body,
    'Срок из сохранённой цели',
  );
});

test('plan-v7 context presents the estimated month separately from the retry limit', () => {
  const plan = {
    id: 'plan-v7',
    version: 7,
    createdAt: '2026-09-04T12:00:00.000Z',
    dailyMinutes: 20,
    horizonDays: 30,
    cycleNumber: 1,
    totalCycles: 6,
    targetCycleNumber: 3,
    cycleGoal: 'Выполнить первый измеримый месяц.',
    summary: 'Цель достигается как можно раньше.',
    targetTimeline: 'Полгода',
    chapters: [],
    missions: [],
    research: {
      method: 'openai-responses-v1',
      confidence: 'medium',
      safetyNotes: [],
      assumptions: [],
      sourceLabels: [],
    },
  };

  const sections = planContextSections(plan);
  assert.equal(
    sections.find((section) => section.heading === 'Estimated achievement')?.body,
    'Month 3',
  );
  assert.equal(
    sections.find((section) => section.heading === 'Continuation limit')?.body,
    'Полгода',
  );
  assert.equal(
    sections.some((section) => section.heading === 'Goal timeline'),
    false,
  );
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
