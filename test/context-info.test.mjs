import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./typescript-extension-loader.mjs', import.meta.url));

const {
  executionBlockContextSections,
  missionContextSections,
  planContextSections,
} = await import('@/shared/presentation/context-info');

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
    { heading: 'О дне', body: 'Краткое объяснение роли этого дня.' },
    { heading: 'Критерий дня', body: 'Все блоки дня завершены.' },
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
    { heading: 'Расчёт нагрузки', body: '50% × 80 сек = 40 сек' },
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
      'Версия и метод',
      'Логика плана',
      'Текущий цикл',
      'Исходная точка и расчёт',
      'Срок большой цели',
      'Допущения',
      'Основа методики',
      'Источники',
      'Метаданные генерации',
    ],
  );
  assert.match(
    sections.find((section) => section.heading === 'Версия и метод')?.body ?? '',
    /План v6[\s\S]*Web research[\s\S]*средняя/u,
  );
  assert.match(
    sections.find((section) => section.heading === 'Текущий цикл')?.body ?? '',
    /Цикл 1 из 6[\s\S]*Увеличить устойчивый результат/u,
  );
  assert.equal(JSON.stringify(sections).includes('Не выполнять под водой'), false);
  assert.equal(JSON.stringify(sections).includes('безопасном месте'), false);
  assert.match(
    sections.find((section) => section.heading === 'Источники')?.body ?? '',
    /https:\/\/example\.com\/research/u,
  );
  assert.match(
    sections.find((section) => section.heading === 'Метаданные генерации')?.body ?? '',
    /response-123[\s\S]*Входных токенов: 100[\s\S]*Выходных токенов: 200/u,
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
    legacySections.find((section) => section.heading === 'Исходная точка и расчёт')?.body ?? '',
    /80 сек/u,
  );
  assert.equal(
    legacySections.find((section) => section.heading === 'Срок большой цели')?.body,
    'Срок из сохранённой цели',
  );
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
