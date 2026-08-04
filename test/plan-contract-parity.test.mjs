import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

import { toJSONSchema } from 'zod';

register(new URL('./typescript-extension-loader.mjs', import.meta.url));

const { createPlanDtoSchema } = await import(
  '@/features/goal-planning/api-contract'
);
const {
  PLAN_CONTRACT_VERSION,
  createPlanSchema,
} = await import('../scripts/ai/contracts/plan-v1.mjs');
const { validatePlanActionability } = await import(
  '../scripts/ai/contracts/validate-plan.mjs'
);

const DAILY_MINUTES = [10, 20, 30, 45, 60];
const HORIZONS = [7, 14, 30];

test('server plan-v5 schema, validator, and client DTO remain in lockstep', () => {
  assert.equal(PLAN_CONTRACT_VERSION, 'plan-v5');

  for (const dailyMinutes of DAILY_MINUTES) {
    for (const horizonDays of HORIZONS) {
      const clientSchema = canonicalizeJsonSchema(
        toJSONSchema(createPlanDtoSchema(dailyMinutes, horizonDays), {
          io: 'input',
          unrepresentable: 'any',
        }),
      );
      const serverSchema = canonicalizeJsonSchema(
        createPlanSchema(dailyMinutes, horizonDays),
      );
      assert.deepEqual(
        clientSchema,
        serverSchema,
        `plan-v5 schema drift for ${dailyMinutes} minutes / ${horizonDays} days`,
      );

      const plan = createValidatorFixture(dailyMinutes, horizonDays);
      assert.equal(createPlanDtoSchema(dailyMinutes, horizonDays).safeParse(plan).success, true);
      assert.equal(
        validatePlanActionability(
          plan,
          dailyMinutes,
          horizonDays,
          plan.baseline.userStatement,
          plan.targetTimeline,
          undefined,
        ),
        plan,
      );
    }
  }
});

function canonicalizeJsonSchema(value, parentKey = '') {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJsonSchema(item));
    return parentKey === 'required' || parentKey === 'enum'
      ? items.toSorted((left, right) => String(left).localeCompare(String(right)))
      : items;
  }
  if (!value || typeof value !== 'object') return value;

  if (
    Array.isArray(value.anyOf) &&
    value.anyOf.every(
      (variant) =>
        variant &&
        Object.hasOwn(variant, 'const') &&
        Object.keys(variant).every((key) => key === 'const' || key === 'type'),
    )
  ) {
    const values = value.anyOf.map((variant) => variant.const);
    return {
      enum: values.toSorted((left, right) => String(left).localeCompare(String(right))),
      type: values.every(Number.isInteger) ? 'integer' : typeof values[0],
    };
  }

  const entries = Object.entries(value).filter(([key]) => key !== '$schema');
  if (Object.hasOwn(value, 'const')) {
    const constIndex = entries.findIndex(([key]) => key === 'const');
    entries.splice(constIndex, 1, ['enum', [value.const]]);
  }
  return Object.fromEntries(
    entries
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalizeJsonSchema(nested, key)]),
  );
}

function createValidatorFixture(dailyMinutes, horizonDays) {
  const firstPhaseEnd = Math.floor(horizonDays / 3);
  const secondPhaseEnd = Math.floor(horizonDays * 2 / 3);
  const blocks = [
    {
      kind: 'timer',
      title: 'Таймер внимания',
      instruction: 'Сохраняйте внимание на материале до сигнала таймера.',
      sets: 1,
      durationSecondsPerSet: 60,
      restSeconds: 0,
      loadBasis: null,
      successCriterion: 'Таймер завершён без остановки.',
    },
    {
      kind: 'counter',
      title: 'Страницы',
      instruction: 'Прочитайте назначенный фрагмент и отметьте результат.',
      sets: 1,
      targetPerSet: 1,
      unit: 'pages',
      unitLabel: null,
      workSecondsPerSet: 60,
      restSeconds: 0,
      tempo: null,
      loadBasis: null,
      successCriterion: 'Назначенный объём отмечен.',
    },
    {
      kind: 'checklist',
      title: 'Проверка понимания',
      items: ['Отметить главную мысль'],
      estimatedSeconds: 60,
      successCriterion: 'Главная мысль отмечена.',
    },
    {
      kind: 'text_log',
      title: 'Вывод',
      prompt: 'Запишите главный вывод в журнал Actum.',
      minCharacters: 10,
      maxCharacters: 300,
      estimatedSeconds: 60,
      successCriterion: 'Вывод сохранён в Actum.',
    },
  ];

  return {
    title: 'Последовательное чтение',
    domain: 'read',
    targetMetric: 'Завершить выбранный материал',
    targetTimeline: 'За выбранный период',
    summary: 'Ежедневный маршрут чтения с фиксацией результата внутри Actum.',
    baseline: {
      userStatement: 'Начинаю с текущего уровня',
      normalizedMetric: 'Текущий уровень чтения',
      value: null,
      unit: null,
      calculationRule: 'Числовая исходная точка пользователем не указана.',
    },
    safetyNotes: [],
    assumptions: ['Материал уже доступен пользователю.'],
    sourceLabels: ['Последовательная практика чтения'],
    phases: [
      { title: 'Старт', subtitle: 'Начало ритма', startDay: 1, endDay: firstPhaseEnd },
      {
        title: 'Ритм',
        subtitle: 'Закрепление практики',
        startDay: firstPhaseEnd + 1,
        endDay: secondPhaseEnd,
      },
      {
        title: 'Итог',
        subtitle: 'Завершение периода',
        startDay: secondPhaseEnd + 1,
        endDay: horizonDays,
      },
    ],
    days: Array.from({ length: horizonDays }, (_, index) => ({
      dayNumber: index + 1,
      phaseIndex:
        index + 1 <= firstPhaseEnd ? 1 : index + 1 <= secondPhaseEnd ? 2 : 3,
      title: `Практика чтения ${index + 1}`,
      description: 'Выполните назначенный блок и сохраните результат внутри Actum.',
      type: 'read',
      estimatedMinutes: Math.min(dailyMinutes, 5),
      xp: 10,
      execution: {
        kind: 'in_app',
        blocks: [structuredClone(blocks[index % blocks.length])],
        successCriterion: 'Назначенный блок выполнен полностью.',
      },
      warning: null,
    })),
  };
}
