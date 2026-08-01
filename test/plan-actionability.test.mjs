import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlanSchema,
  PLAN_CONTRACT_VERSION,
  PLAN_SCHEMA,
} from '../scripts/ai/contracts/plan-v1.mjs';
import {
  validatePlanActionability,
} from '../scripts/ai/contracts/validate-plan.mjs';
import { parseTrustedBaseline } from '../scripts/ai/contracts/parse-baseline.mjs';
import {
  buildPlanInstructions,
  PROMPT_VERSION,
  RESEARCH_INSTRUCTIONS,
} from '../scripts/ai/prompts/plan-v1.mjs';

const USER_BASELINE = 'Сухая статическая задержка: рекорд 1:20';
const TARGET_TIMELINE = '1 год';
const TRUSTED_BASELINE = { value: 80, unit: 'seconds' };

function validatePlan(plan, horizonDays = 30) {
  return validatePlanActionability(
    plan,
    30,
    horizonDays,
    USER_BASELINE,
    TARGET_TIMELINE,
    TRUSTED_BASELINE,
  );
}

test('plan-v4 accepts thirty explicit days with exact baseline calculations', () => {
  const plan = actionablePlan();
  assert.equal(
    validatePlan(plan),
    plan,
  );
  assert.equal(plan.days.length, 30);
  assert.deepEqual(
    plan.days.map((day) => day.dayNumber),
    Array.from({ length: 30 }, (_, index) => index + 1),
  );
  assert.equal(plan.days[0].execution.actions[0].quantity, 36);
  assert.deepEqual(plan.days[0].execution.actions[0].loadBasis, {
    percentage: 45,
    baseValue: 80,
    baseUnit: 'seconds',
    result: 36,
  });
});

test('plan-v4 rejects a day made only of a vague placeholder', () => {
  const plan = actionablePlan();
  plan.days[0].steps = ['Подготовься.'];
  plan.days[0].execution = {
    kind: 'manual',
    durationSeconds: null,
    successCriterion: 'Подготовка отмечена как выполненная.',
  };

  assert.throws(
    () => validatePlan(plan),
    /days\.0\.steps: день не содержит конкретного указания/,
  );
});

test('plan-v4 allows concrete research work and keeps warnings outside the action', () => {
  const plan = actionablePlan();
  const day = plan.days[0];
  day.description = 'Разобрать заданный фрагмент и проверить понимание.';
  day.steps = ['Изучи страницы 10–15 и письменно ответь на 5 вопросов.'];
  day.execution = {
    kind: 'manual',
    durationSeconds: null,
    successCriterion: 'Записаны ответы на все 5 вопросов.',
  };
  day.warning = 'Предупреждение остаётся отдельно от задания.';

  assert.doesNotThrow(() => validatePlan(plan));
});

test('manual days reject a long generic training session without measurable evidence', () => {
  const plan = actionablePlan();
  const day = plan.days[0];
  day.steps = [
    'Проведи качественную тренировочную сессию с хорошей техникой и запиши ощущения.',
  ];
  day.execution = {
    kind: 'manual',
    durationSeconds: null,
    successCriterion: 'Сессия выполнена полностью.',
  };
  assert.throws(
    () => validatePlan(plan),
    /manual-день не содержит измеримого результата или проверяемого артефакта/,
  );

  const artifactPlan = actionablePlan();
  artifactPlan.days[0].steps = ['Заполни форму отчёта и отправь сохранённый документ.'];
  artifactPlan.days[0].execution = {
    kind: 'manual',
    durationSeconds: null,
    successCriterion: 'Заполненная форма сохранена и документ отправлен.',
  };
  assert.doesNotThrow(() => validatePlan(artifactPlan));

  for (const [step, criterion] of [
    [
      'Сделай всё необходимое для достижения цели и не отвлекайся на посторонние задачи.',
      'Результат готов полностью.',
    ],
    [
      'Проведи полезную практику до ощущения завершённости.',
      'Тест пройден успешно.',
    ],
    ['Проведи 1 тренировку.', 'Выполнена 1 тренировка.'],
    [
      'Выполни всю необходимую работу над задачей и действуй внимательно до полного завершения.',
      'Задача завершена полностью.',
    ],
  ]) {
    const bypassPlan = actionablePlan();
    bypassPlan.days[0].steps = [step];
    bypassPlan.days[0].execution = {
      kind: 'manual',
      durationSeconds: null,
      successCriterion: criterion,
    };
    assert.throws(
      () => validatePlan(bypassPlan),
      /manual-день не содержит измеримого результата или проверяемого артефакта/,
    );
  }
});

test('plan-v4 rejects a routine whose known timers exceed the daily limit', () => {
  const plan = actionablePlan();
  const action = plan.days[0].execution.actions[0];
  action.sets = 3;
  action.quantity = 600;
  action.workSecondsPerSet = 600;
  action.loadBasis = null;
  action.restSeconds = 60;

  assert.throws(
    () => validatePlan(plan),
    /известная длительность routine превышает заявленную длительность дня/,
  );
});

test('plan-v4 rejects vague timer instructions and non-measurable progression', () => {
  const vagueTimer = actionablePlan();
  const day = vagueTimer.days[0];
  day.steps = ['Потренируй дыхание в комфортном темпе.'];
  day.execution = {
    kind: 'timer',
    durationSeconds: 30,
    successCriterion: 'Таймер дошёл до нуля.',
  };
  assert.throws(
    () => validatePlan(vagueTimer),
    /days\.0\.steps: день не содержит конкретного указания/,
  );

  const weakProgression = actionablePlan();
  weakProgression.days[0].progressionRule = 'Постепенно увеличивай нагрузку.';
  assert.throws(
    () => validatePlan(weakProgression),
    /progressionRule: правило не содержит двух точных измеримых веток/,
  );
});

test('known timer duration must fit the day estimate', () => {
  const plan = actionablePlan();
  const day = plan.days[0];
  day.estimatedMinutes = 1;
  day.execution = {
    kind: 'timer',
    durationSeconds: 120,
    successCriterion: 'Таймер дошёл до нуля через 120 секунд.',
  };
  assert.throws(
    () => validatePlan(plan),
    /таймер превышает заявленную длительность дня/,
  );
});

test('machine-readable work duration covers discrete routine actions', () => {
  const plan = actionablePlan();
  const day = plan.days[0];
  const action = day.execution.actions[0];
  day.estimatedMinutes = 1;
  action.unit = 'reps';
  action.quantity = 1000;
  action.workSecondsPerSet = 1000;
  action.sets = 1;
  action.restSeconds = 0;
  action.loadBasis = null;
  assert.throws(
    () => validatePlan(plan),
    /известная длительность routine превышает заявленную длительность дня/,
  );
});

test('plan-v4 aligns custom units with the schema', () => {
  const plan = actionablePlan();
  const action = plan.days[0].execution.actions[0];
  action.unit = 'custom';
  action.unitLabel = null;
  action.loadBasis = null;
  assert.throws(
    () => validatePlan(plan),
    /days\.0\.execution\.actions\.0\.unitLabel/,
  );

  action.unitLabel = 'дыхательных циклов';
  assert.doesNotThrow(() => validatePlan(plan));
});

test('discrete routine units reject fractional quantities', () => {
  for (const unit of ['reps', 'pages', 'items', 'words', 'attempts']) {
    const plan = actionablePlan();
    const action = plan.days[0].execution.actions[0];
    action.unit = unit;
    action.quantity = 2.5;
    action.loadBasis = null;
    assert.throws(
      () => validatePlan(plan),
      new RegExp(`для единицы ${unit} ожидается целое число`),
    );
  }
});

test('dynamic provider schema fixes exact calendar length before the paid response', () => {
  const schema = createPlanSchema(45, 30);
  const day = schema.properties.days.items.properties;
  assert.equal(schema.properties.days.minItems, 30);
  assert.equal(schema.properties.days.maxItems, 30);
  assert.equal(day.dayNumber.maximum, 30);
  assert.equal(day.estimatedMinutes.maximum, 45);
  assert.equal(day.execution.anyOf[1].properties.durationSeconds.maximum, 2700);
  for (const routineVariant of day.execution.anyOf[2].properties.actions.items.anyOf) {
    assert.equal(routineVariant.properties.workSecondsPerSet.maximum, 2700);
    assert.equal(routineVariant.properties.restSeconds.maximum, 2700);
  }
  assert.ok(
    day.execution.anyOf[2].properties.actions.items.anyOf.every((variant) =>
      variant.required.includes('workSecondsPerSet'),
    ),
  );
  assert.equal(PLAN_SCHEMA.properties.days.maxItems, 30);
});

test('calendar day numbers must already be explicit and sequential', () => {
  const plan = actionablePlan(14);
  [plan.days[0], plan.days[1]] = [plan.days[1], plan.days[0]];
  assert.throws(
    () => validatePlan(plan, 14),
    /days\.0\.dayNumber: ожидается последовательный день 1/,
  );
});

test('baseline statement and percentage arithmetic are enforced', () => {
  const changedTimeline = actionablePlan();
  changedTimeline.targetTimeline = '3 месяца';
  assert.throws(
    () => validatePlan(changedTimeline),
    /targetTimeline: срок большой цели пользователя был изменён/,
  );

  const changedStatement = actionablePlan();
  changedStatement.baseline.userStatement = 'Другая исходная точка';
  assert.throws(
    () => validatePlan(changedStatement),
    /baseline\.userStatement: исходная точка пользователя была изменена/,
  );

  const wrongCalculation = actionablePlan();
  wrongCalculation.days[0].execution.actions[0].loadBasis.result = 44;
  wrongCalculation.days[0].execution.actions[0].quantity = 44;
  wrongCalculation.days[0].execution.actions[0].workSecondsPerSet = 44;
  assert.throws(
    () => validatePlan(wrongCalculation),
    /result 44 не соответствует 45% от baseline 80/,
  );

  const mismatchedQuantity = actionablePlan();
  mismatchedQuantity.days[0].execution.actions[0].quantity = 40;
  mismatchedQuantity.days[0].execution.actions[0].workSecondsPerSet = 40;
  assert.throws(
    () => validatePlan(mismatchedQuantity),
    /quantity 40 не совпадает с loadBasis\.result 36/,
  );

  const selfDeclaredBaseline = actionablePlan();
  selfDeclaredBaseline.baseline.value = 120;
  assert.throws(
    () => validatePlan(selfDeclaredBaseline),
    /baseline\.value: ожидается локально распознанное значение 80/,
  );

  const wrongUnit = actionablePlan();
  wrongUnit.days[0].execution.actions[0].unit = 'reps';
  assert.throws(
    () => validatePlan(wrongUnit),
    /процент от baseline нельзя записать в единице reps/,
  );

  const ignoredBaseline = actionablePlan();
  ignoredBaseline.days.forEach((day) => {
    day.execution.actions[0].loadBasis = null;
  });
  assert.throws(
    () => validatePlan(ignoredBaseline),
    /измеримая двигательная цель не использует baseline ни в одном расчёте/,
  );
});

test('calendar coverage and phase boundaries are strict', () => {
  const missingDay = actionablePlan();
  missingDay.days.pop();
  assert.throws(
    () => validatePlan(missingDay),
    /ровно 30 календарных дней/,
  );

  const phaseGap = actionablePlan();
  phaseGap.phases[1].startDay = 12;
  assert.throws(
    () => validatePlan(phaseGap),
    /ожидается день 11 без разрыва или пересечения/,
  );
});

test('local baseline parser prefers the explicit record and normalizes time', () => {
  assert.deepEqual(
    parseTrustedBaseline(
      'Обычная сухая задержка 40 секунд; рекорд — 1 минута 20 секунд.',
    ),
    { value: 80, unit: 'seconds' },
  );
  assert.deepEqual(parseTrustedBaseline('Рекорд 1:20'), TRUSTED_BASELINE);
  assert.deepEqual(parseTrustedBaseline('Рекорд — 1 минуту 20 секунд'), TRUSTED_BASELINE);
  assert.deepEqual(
    parseTrustedBaseline('Рекорд 80 секунд, обычный результат 40 секунд'),
    TRUSTED_BASELINE,
  );
  assert.deepEqual(parseTrustedBaseline('Сейчас выполняю 8 повторений'), {
    value: 8,
    unit: 'reps',
  });
  assert.equal(parseTrustedBaseline('Начинаю без измеренного результата'), null);
  assert.equal(parseTrustedBaseline('Занимаюсь 5 месяцев, результата не измерял'), null);
  assert.equal(parseTrustedBaseline('Написал 8 строк кода и прошёл 2 секции курса'), null);
  assert.equal(parseTrustedBaseline('Обычно 40 секунд, иногда 50 секунд'), null);
  assert.equal(parseTrustedBaseline('Тренируюсь каждый день в 12:30, результат не измерял'), null);
  assert.equal(parseTrustedBaseline('Масштаб текущей модели 1:20'), null);
  assert.equal(parseTrustedBaseline('Счёт последней игры 2:1'), null);
  assert.equal(parseTrustedBaseline('Соотношение сторон 3:10'), null);
  assert.equal(parseTrustedBaseline('Результат матча 2:1'), null);
  assert.equal(parseTrustedBaseline('Мой лучший счёт 3:2'), null);
  assert.equal(parseTrustedBaseline('Current score 2:1'), null);
  assert.equal(parseTrustedBaseline('Current ratio 3:10'), null);
  assert.equal(parseTrustedBaseline('Состав содержит 1:20'), null);
  assert.equal(parseTrustedBaseline('Поддерживаю пропорцию 1:20'), null);
  assert.equal(parseTrustedBaseline('Текущий результат 1:20'), null);
  assert.equal(parseTrustedBaseline('Current result 1:20'), null);
  for (const rate of ['5 м/с', '10 км/ч', '5 минут/км', '8 страниц/час', '10 повторений/мин']) {
    assert.equal(parseTrustedBaseline(rate), null);
  }
});

test('prompt and JSON contract require a calculated day-by-day calendar', () => {
  const instructions = buildPlanInstructions({ hasResearch: true });
  const execution = PLAN_SCHEMA.properties.days.items.properties.execution;

  assert.equal(PLAN_CONTRACT_VERSION, 'plan-v4');
  assert.ok(PLAN_SCHEMA.required.includes('targetTimeline'));
  assert.match(PROMPT_VERSION, /daily-calendar-v4\.1/);
  assert.match(RESEARCH_INSTRUCTIONS, /подходы, повторы\/секунды\/страницы, отдых/);
  assert.match(instructions, /days содержит ровно horizonDays объектов/);
  assert.match(instructions, /Никаких repeatCount/);
  assert.match(instructions, /"percentage": 45.*"baseValue": 80.*"result": 36/);
  assert.match(instructions, /execution\.kind = "routine"/);
  assert.match(instructions, /одиночную подводную задержку дыхания/);
  assert.ok(execution.anyOf.some((variant) => variant.properties.kind.enum.includes('routine')));
});

function actionablePlan(horizonDays = 30) {
  const firstEnd = Math.ceil(horizonDays / 3);
  const secondEnd = firstEnd + Math.ceil((horizonDays - firstEnd) / 2);
  const phases = [
    { title: 'Фаза 1', subtitle: 'Первые календарные дни', startDay: 1, endDay: firstEnd },
    {
      title: 'Фаза 2',
      subtitle: 'Основной измеримый блок',
      startDay: firstEnd + 1,
      endDay: secondEnd,
    },
    {
      title: 'Фаза 3',
      subtitle: 'Закрепление и итог',
      startDay: secondEnd + 1,
      endDay: horizonDays,
    },
  ];

  return {
    title: 'Конкретный подневный маршрут',
    domain: 'move',
    targetMetric: 'Выполнить полный календарный блок с измеримой нагрузкой',
    targetTimeline: TARGET_TIMELINE,
    summary: 'Маршрут проверяет точную ежедневную дозировку без обращения к OpenAI.',
    baseline: {
      userStatement: USER_BASELINE,
      normalizedMetric: 'Максимальная сухая статическая задержка',
      value: 80,
      unit: 'seconds',
      calculationRule: 'M фиксируется на уровне 80 секунд до контрольного дня следующего блока.',
    },
    safetyNotes: ['Предупреждение показывается отдельно от действий.'],
    assumptions: ['На один календарный день доступно тридцать минут.'],
    sourceLabels: ['Тестовый локальный источник'],
    phases,
    days: Array.from({ length: horizonDays }, (_, index) => {
      const dayNumber = index + 1;
      const phaseIndex = dayNumber <= firstEnd ? 1 : dayNumber <= secondEnd ? 2 : 3;
      return {
        dayNumber,
        phaseIndex,
        title: `День ${dayNumber}: измеримая сессия`,
        description: 'Выполнить точный комплекс и записать наблюдаемый результат.',
        type: 'practice',
        estimatedMinutes: 10,
        xp: 20,
        steps: ['Ляг на устойчивую поверхность и держи таймер в поле зрения.'],
        execution: {
          kind: 'routine',
          actions: [
            {
              title: 'Субмаксимальный таймер',
              instruction: 'Сохраняй неподвижное положение до окончания назначенного таймера.',
              sets: 3,
              quantity: 36,
              workSecondsPerSet: 36,
              unit: 'seconds',
              unitLabel: null,
              loadBasis: {
                percentage: 45,
                baseValue: 80,
                baseUnit: 'seconds',
                result: 36,
              },
              restSeconds: 60,
              tempo: null,
              successCriterion: 'Положение сохраняется все 36 секунд.',
            },
          ],
          successCriterion: 'Завершены 3 подхода по 36 секунд.',
        },
        progressionRule:
          'Если завершены все 3 подхода при сложности до 6 из 10 — следуй следующему дню с изменением 0; если нет — уменьши следующую подобную нагрузку на 10%.',
        warning: null,
      };
    }),
  };
}
