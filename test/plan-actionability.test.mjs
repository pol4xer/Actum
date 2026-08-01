import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlanSchema,
  PLAN_CONTRACT_VERSION,
  PLAN_SCHEMA,
} from '../scripts/ai/contracts/plan-v1.mjs';
import {
  PLAN_VALIDATOR_VERSION,
  validatePlanActionability,
} from '../scripts/ai/contracts/validate-plan.mjs';
import { parseTrustedBaseline } from '../scripts/ai/contracts/parse-baseline.mjs';
import {
  buildPlanInstructions,
  PROMPT_VERSION,
  RESEARCH_INSTRUCTIONS,
  RESEARCH_PROMPT_VERSION,
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

test('plan-v5 accepts thirty explicit in-app days with exact timer baseline calculations', () => {
  const plan = actionablePlan();
  assert.equal(validatePlan(plan), plan);
  assert.equal(plan.days.length, 30);
  assert.deepEqual(
    plan.days.map((day) => day.dayNumber),
    Array.from({ length: 30 }, (_, index) => index + 1),
  );
  const block = plan.days[0].execution.blocks[0];
  assert.equal(block.kind, 'timer');
  assert.equal(block.durationSecondsPerSet, 36);
  assert.deepEqual(block.loadBasis, {
    percentage: 45,
    baseValue: 80,
    baseUnit: 'seconds',
    result: 36,
  });
  assert.equal('steps' in plan.days[0], false);
  assert.equal('progressionRule' in plan.days[0], false);
});

test('all four closed-loop block primitives validate inside one Actum execution', () => {
  const plan = actionablePlan();
  plan.days[1].execution = {
    kind: 'in_app',
    blocks: [
      {
        kind: 'timer',
        title: 'Ровное дыхание',
        instruction: 'Сохраняй спокойный ритм и неподвижное положение до конца интервала.',
        sets: 1,
        durationSecondsPerSet: 30,
        restSeconds: 0,
        loadBasis: null,
        successCriterion: 'Интервал полностью завершён без паузы.',
      },
      {
        kind: 'counter',
        title: 'Встроенный счётчик циклов',
        instruction: 'Выполняй каждый цикл с одинаковой плавной амплитудой.',
        sets: 2,
        targetPerSet: 4,
        unit: 'reps',
        unitLabel: null,
        workSecondsPerSet: 24,
        restSeconds: 20,
        tempo: 'Ровный контролируемый темп',
        loadBasis: null,
        successCriterion: 'В каждом подходе выполнено ровно четыре цикла.',
      },
      {
        kind: 'checklist',
        title: 'Чек-лист техники',
        items: [
          'Плечи остаются расслабленными весь интервал.',
          'Дыхание возвращается к обычному ритму после подхода.',
        ],
        estimatedSeconds: 30,
        successCriterion: 'Оба пункта отмечены внутри Actum.',
      },
      {
        kind: 'text_log',
        title: 'Короткая рефлексия',
        prompt: 'Опиши ощущаемую сложность и качество техники после сессии.',
        minCharacters: 40,
        maxCharacters: 240,
        estimatedSeconds: 60,
        successCriterion: 'В Actum сохранено не менее сорока символов.',
      },
    ],
    successCriterion: 'Все четыре встроенных блока завершены.',
  };

  assert.doesNotThrow(() => validatePlan(plan));
});

test('plan-v5 rejects legacy day fields and non-exact block shapes', () => {
  const legacySteps = actionablePlan();
  legacySteps.days[0].steps = ['Старое свободное указание.'];
  assert.throws(
    () => validatePlan(legacySteps),
    /days\.0\.steps: поле не поддерживается контрактом plan-v5/,
  );

  const legacyProgression = actionablePlan();
  legacyProgression.days[0].progressionRule = 'Если готово, увеличь; иначе повтори.';
  assert.throws(
    () => validatePlan(legacyProgression),
    /days\.0\.progressionRule: поле не поддерживается контрактом plan-v5/,
  );

  const extraTimerField = actionablePlan();
  extraTimerField.days[0].execution.blocks[0].workSecondsPerSet = 36;
  assert.throws(
    () => validatePlan(extraTimerField),
    /execution\.blocks\.0\.workSecondsPerSet: поле не поддерживается контрактом plan-v5/,
  );

  const wrongExecutionKind = actionablePlan();
  wrongExecutionKind.days[0].execution.kind = 'routine';
  assert.throws(
    () => validatePlan(wrongExecutionKind),
    /execution\.kind: для plan-v5 ожидается только in_app/,
  );
});

test('numeric and estimated block durations must fit the declared day', () => {
  const timerPlan = actionablePlan();
  const timerDay = timerPlan.days[0];
  timerDay.estimatedMinutes = 1;
  timerDay.execution.blocks[0].sets = 2;
  timerDay.execution.blocks[0].durationSecondsPerSet = 20;
  timerDay.execution.blocks[0].restSeconds = 30;
  timerDay.execution.blocks[0].loadBasis = null;
  assert.throws(
    () => validatePlan(timerPlan),
    /известная длительность блоков превышает заявленную длительность дня/,
  );

  const counterPlan = actionablePlan();
  const counterDay = counterPlan.days[0];
  counterDay.estimatedMinutes = 1;
  counterDay.execution.blocks = [counterBlock({ workSecondsPerSet: 61 })];
  assert.throws(
    () => validatePlan(counterPlan),
    /известная длительность блоков превышает заявленную длительность дня/,
  );

  const estimatedPlan = actionablePlan();
  const estimatedDay = estimatedPlan.days[0];
  estimatedDay.estimatedMinutes = 1;
  estimatedDay.execution.blocks = [
    checklistBlock({ estimatedSeconds: 35 }),
    textLogBlock({ estimatedSeconds: 30 }),
  ];
  assert.throws(
    () => validatePlan(estimatedPlan),
    /известная длительность блоков превышает заявленную длительность дня/,
  );

});

test('vague block instructions and delegated choices are rejected', () => {
  const vague = actionablePlan();
  vague.days[0].execution.blocks[0].instruction = 'Подготовься.';
  assert.throws(
    () => validatePlan(vague),
    /execution\.blocks\.0\.instruction: инструкция подменена общей фразой/,
  );

  const delegated = actionablePlan();
  delegated.days[0].execution.blocks[0].instruction =
    'Choose a suitable exercise and calculate the duration yourself.';
  assert.throws(
    () => validatePlan(delegated),
    /пользователь не должен сам выбирать или рассчитывать действие/,
  );
});

test('generated instructional text rejects Russian and English off-app dependencies', () => {
  const forbiddenInstructions = [
    'Запиши результат в блокнот после каждого подхода.',
    'Сохрани результат в заметках после каждого подхода.',
    'Открой файл перед началом следующего подхода.',
    'Открой документ и заполни таблицу с результатами.',
    'Заполни форму отчёта после завершения интервала.',
    'Отметь итог на бумажном листе после интервала.',
    'Добавь выполненную сессию в календарь.',
    'Открой трекер после завершения интервала.',
    'Продолжи выполнение в другом приложении.',
    'Загрузи готовый ответ после завершения интервала.',
    'Отправь тренеру сообщение с итоговым результатом.',
    'Отправь файл с результатом после сессии.',
    'Позвони специалисту и обсуди результат этой сессии.',
    'Напиши другу после завершения этого интервала.',
    'Посети тренера после завершения этой сессии.',
    'Найди человека для проверки этого результата.',
    'Найди инструкцию для следующего упражнения.',
    'Посмотри внешний ролик с техникой упражнения.',
    'Используй телефон и секундомер для каждого интервала.',
    'Используй часы и установи будильник на конец подхода.',
    'Держи внешний таймер и счётчик перед собой.',
    'Держи счётчик перед собой во время каждого подхода.',
    'Фиксируй результат в другом приложении после подхода.',
    'Write progress in your notes after every set.',
    'Open a file and complete the form after every set.',
    'Mark the result on a sheet or spreadsheet.',
    'Add the session to a calendar and open a tracker.',
    'Continue the task in another app after this block.',
    'Upload the completed answer after the final set.',
    'Send the result as an email message after every set.',
    'Send a file with the result after every set.',
    'Call a friend and contact a specialist after the session.',
    'Write to a person and visit a coach after the session.',
    'Use your watch as an external timer for every set.',
    'Keep your watch visible during every interval.',
    'Start a stopwatch, set an alarm, and keep a counter visible.',
    'Keep a counter visible during every set.',
    'Find a coach and write to that person after the session.',
    'Track the result elsewhere outside the app.',
  ];

  for (const instruction of forbiddenInstructions) {
    const plan = actionablePlan();
    plan.days[0].execution.blocks[0].instruction = instruction;
    assert.throws(
      () => validatePlan(plan),
      /внешняя зависимость: действие должно выполняться внутри Actum/,
      instruction,
    );
  }
});

test('in-app text_log is valid and source URLs or verbatim baseline are not scanned', () => {
  const baselineStatement = 'Мои заметки и файл: рекорд 1:20';
  const plan = actionablePlan();
  plan.baseline.userStatement = baselineStatement;
  plan.sourceLabels = ['https://example.com/files/protocol.pdf'];
  plan.days[0].execution.blocks = [
    textLogBlock({
      title: 'Session notes',
      prompt: 'Write notes about how the built-in session felt.',
      successCriterion: 'The note is saved in the built-in text log.',
    }),
  ];

  assert.doesNotThrow(() =>
    validatePlanActionability(
      plan,
      30,
      30,
      baselineStatement,
      TARGET_TIMELINE,
      TRUSTED_BASELINE,
    ),
  );
});

test('text_log permits in-app notes but still rejects named or explicit external note apps', () => {
  for (const prompt of [
    'Open your Notes app and write how the session felt.',
    'Сохрани заметку в Google Keep после завершения сессии.',
    'Write the note in another app after this session.',
  ]) {
    const plan = actionablePlan();
    plan.days[0].execution.blocks = [textLogBlock({ prompt })];
    assert.throws(
      () => validatePlan(plan),
      /внешняя зависимость: действие должно выполняться внутри Actum/,
      prompt,
    );
  }
});

test('text_log bounds and checklist item counts are enforced', () => {
  const invalidLog = actionablePlan();
  invalidLog.days[0].execution.blocks = [
    textLogBlock({ minCharacters: 200, maxCharacters: 100 }),
  ];
  assert.throws(
    () => validatePlan(invalidLog),
    /maxCharacters должен быть не меньше minCharacters/,
  );

  const invalidChecklist = actionablePlan();
  invalidChecklist.days[0].execution.blocks = [checklistBlock({ items: [] })];
  assert.throws(
    () => validatePlan(invalidChecklist),
    /checklist должен содержать от одного до восьми пунктов/,
  );
});

test('all user-visible narrative fields reject off-app dependencies', () => {
  const cases = [
    ['summary', (plan) => { plan.summary = 'Подробный план, затем обратитесь к врачу для проверки результата.'; }],
    ['safetyNotes', (plan) => { plan.safetyNotes = ['Посетите специалиста перед следующим днём.']; }],
    ['assumptions', (plan) => { plan.assumptions = ['Используйте внешний секундомер для каждого подхода.']; }],
    ['warning', (plan) => { plan.days[0].warning = 'Напишите тренеру после выполнения.'; }],
    ['phase subtitle', (plan) => { plan.phases[0].subtitle = 'Свяжитесь с инструктором и запишите результат.'; }],
  ];

  for (const [label, mutate] of cases) {
    const plan = actionablePlan();
    mutate(plan);
    assert.throws(
      () => validatePlan(plan),
      /внешняя зависимость: действие должно выполняться внутри Actum/,
      label,
    );
  }
});

test('timed work cannot hide in block free text without an in-app clock', () => {
  const cases = [
    ['timer instruction', (plan) => { plan.days[0].execution.blocks[0].instruction = 'Задерживай дыхание 40 секунд в неподвижном положении.'; }],
    ['execution criterion', (plan) => { plan.days[0].execution.successCriterion = 'Все блоки выполнены за 10 минут.'; }],
    ['checklist item', (plan) => { plan.days[0].execution.blocks = [checklistBlock({ items: ['Удерживай положение 30 секунд.'] })]; }],
    ['text prompt', (plan) => { plan.days[0].execution.blocks = [textLogBlock({ prompt: 'Описывай ощущения непрерывно 2 минуты.' })]; }],
    ['counter tempo', (plan) => { plan.days[0].execution.blocks = [counterBlock({ tempo: '3 секунды вниз, 1 секунда вверх.' })]; }],
  ];

  for (const [label, mutate] of cases) {
    const plan = actionablePlan();
    mutate(plan);
    assert.throws(
      () => validatePlan(plan),
      /временная нагрузка должна быть структурным полем встроенного timer\/counter/,
      label,
    );
  }
});

test('counter units are non-temporal, custom labels align, and discrete targets are integers', () => {
  for (const unit of ['seconds', 'minutes']) {
    const plan = actionablePlan();
    plan.days[0].execution.blocks = [counterBlock({ unit })];
    assert.throws(() => validatePlan(plan), /неизвестная единица счётчика/);
  }

  const custom = actionablePlan();
  custom.days[0].execution.blocks = [counterBlock({ unit: 'custom', unitLabel: null })];
  assert.throws(() => validatePlan(custom), /unitLabel/);
  custom.days[0].execution.blocks[0].unitLabel = 'дыхательных циклов';
  assert.doesNotThrow(() => validatePlan(custom));

  for (const temporalLabel of [
    'seconds',
    'hours',
    'milliseconds',
    'months',
    'years',
    'минут',
    'часов',
    'миллисекунд',
    'месяцев',
    'лет',
  ]) {
    const temporalCustom = actionablePlan();
    temporalCustom.days[0].execution.blocks = [
      counterBlock({ unit: 'custom', unitLabel: temporalLabel }),
    ];
    assert.throws(
      () => validatePlan(temporalCustom),
      /временная единица должна использовать timer, а не counter/,
    );
  }

  for (const unit of ['reps', 'pages', 'items', 'words', 'attempts']) {
    const plan = actionablePlan();
    plan.days[0].execution.blocks = [counterBlock({ unit, targetPerSet: 2.5 })];
    assert.throws(
      () => validatePlan(plan),
      new RegExp(`для единицы ${unit} ожидается целое число`),
    );
  }
});

test('timer baseline arithmetic and executable target equality are enforced', () => {
  const wrongCalculation = actionablePlan();
  wrongCalculation.days[0].execution.blocks[0].loadBasis.result = 44;
  wrongCalculation.days[0].execution.blocks[0].durationSecondsPerSet = 44;
  assert.throws(
    () => validatePlan(wrongCalculation),
    /result 44 не соответствует 45% от baseline 80/,
  );

  const mismatchedDuration = actionablePlan();
  mismatchedDuration.days[0].execution.blocks[0].durationSecondsPerSet = 40;
  assert.throws(
    () => validatePlan(mismatchedDuration),
    /durationSecondsPerSet 40 не совпадает с loadBasis\.result 36/,
  );

  const almostEqualDuration = actionablePlan();
  almostEqualDuration.days[0].execution.blocks[0].loadBasis.result = 36.009;
  assert.throws(
    () => validatePlan(almostEqualDuration),
    /durationSecondsPerSet 36 не совпадает с loadBasis\.result 36\.009/,
  );

  const wrongUnit = actionablePlan();
  wrongUnit.days[0].execution.blocks[0].loadBasis.baseUnit = 'reps';
  assert.throws(
    () => validatePlan(wrongUnit),
    /loadBasis\.baseUnit: ожидается локально распознанная единица seconds/,
  );
});

test('counter baseline result equals targetPerSet', () => {
  const plan = actionablePlan();
  const baselineStatement = 'Сейчас выполняю 8 повторений';
  plan.baseline = {
    userStatement: baselineStatement,
    normalizedMetric: 'Контролируемые повторения',
    value: 8,
    unit: 'repetitions',
    calculationRule: 'Исходное значение восемь повторений фиксируется на весь блок.',
  };
  plan.days.forEach((day) => {
    day.execution.blocks = [
      counterBlock({
        targetPerSet: 6,
        loadBasis: {
          percentage: 75,
          baseValue: 8,
          baseUnit: 'reps',
          result: 6,
        },
      }),
    ];
  });

  assert.doesNotThrow(() =>
    validatePlanActionability(
      plan,
      30,
      30,
      baselineStatement,
      TARGET_TIMELINE,
      { value: 8, unit: 'reps' },
    ),
  );

  plan.days[0].execution.blocks[0].targetPerSet = 7;
  assert.throws(
    () =>
      validatePlanActionability(
        plan,
        30,
        30,
        baselineStatement,
        TARGET_TIMELINE,
        { value: 8, unit: 'reps' },
      ),
    /targetPerSet 7 не совпадает с loadBasis\.result 6/,
  );

  plan.days[0].execution.blocks[0].targetPerSet = 6;
  plan.days[0].execution.blocks[0].loadBasis.result = 6.009;
  assert.throws(
    () =>
      validatePlanActionability(
        plan,
        30,
        30,
        baselineStatement,
        TARGET_TIMELINE,
        { value: 8, unit: 'reps' },
      ),
    /targetPerSet 6 не совпадает с loadBasis\.result 6\.009/,
  );
});

test('trusted move or practice baselines require a load-linked numeric block', () => {
  const ignoredBaseline = actionablePlan();
  ignoredBaseline.days.forEach((day) => {
    day.execution.blocks[0].loadBasis = null;
  });
  assert.throws(
    () => validatePlan(ignoredBaseline),
    /измеримая двигательная цель не использует baseline ни в одном расчёте/,
  );

  const untrusted = actionablePlan();
  untrusted.domain = 'habit';
  untrusted.baseline.value = null;
  untrusted.baseline.unit = null;
  untrusted.days.forEach((day) => {
    day.execution.blocks[0].loadBasis = null;
  });
  assert.doesNotThrow(() =>
    validatePlanActionability(
      untrusted,
      30,
      30,
      USER_BASELINE,
      TARGET_TIMELINE,
      null,
    ),
  );
});

test('baseline statement, target timeline, calendar coverage, and phases remain strict', () => {
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

  const selfDeclaredBaseline = actionablePlan();
  selfDeclaredBaseline.baseline.value = 120;
  assert.throws(
    () => validatePlan(selfDeclaredBaseline),
    /baseline\.value: ожидается локально распознанное значение 80/,
  );

  const missingDay = actionablePlan();
  missingDay.days.pop();
  assert.throws(() => validatePlan(missingDay), /ровно 30 календарных дней/);

  const reordered = actionablePlan(14);
  [reordered.days[0], reordered.days[1]] = [reordered.days[1], reordered.days[0]];
  assert.throws(
    () => validatePlan(reordered, 14),
    /days\.0\.dayNumber: ожидается последовательный день 1/,
  );

  const phaseGap = actionablePlan();
  phaseGap.phases[1].startDay = 12;
  assert.throws(
    () => validatePlan(phaseGap),
    /ожидается день 11 без разрыва или пересечения/,
  );
});

test('dynamic provider schema fixes calendar and every block duration before the paid response', () => {
  const schema = createPlanSchema(45, 30);
  const day = schema.properties.days.items.properties;
  const execution = day.execution;
  const variants = execution.properties.blocks.items.anyOf;
  const block = (kind) => variants.find((variant) => variant.properties.kind.enum[0] === kind);

  assert.equal(schema.properties.days.minItems, 30);
  assert.equal(schema.properties.days.maxItems, 30);
  assert.equal(day.dayNumber.maximum, 30);
  assert.equal(day.estimatedMinutes.maximum, 45);
  assert.equal(execution.properties.kind.enum[0], 'in_app');
  assert.equal(execution.properties.blocks.minItems, 1);
  assert.equal(execution.properties.blocks.maxItems, 12);
  assert.equal(block('timer').properties.durationSecondsPerSet.maximum, 2700);
  assert.equal(block('timer').properties.restSeconds.maximum, 1800);
  assert.equal(block('counter').properties.workSecondsPerSet.maximum, 2700);
  assert.equal(block('counter').properties.restSeconds.maximum, 1800);
  assert.equal(block('checklist').properties.estimatedSeconds.maximum, 2700);
  assert.equal(block('text_log').properties.estimatedSeconds.maximum, 2700);
  assert.ok(variants.every((variant) => variant.additionalProperties === false));
  assert.equal('steps' in day, false);
  assert.equal('progressionRule' in day, false);
  assert.equal(PLAN_SCHEMA.properties.days.maxItems, 30);
});

test('local baseline parser prefers explicit records and normalizes time', () => {
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

test('prompt, research, schema, and validator advertise the closed-loop plan-v5 contract', () => {
  const instructions = buildPlanInstructions({ hasResearch: true });
  const execution = PLAN_SCHEMA.properties.days.items.properties.execution;

  assert.equal(PLAN_CONTRACT_VERSION, 'plan-v5');
  assert.equal(PLAN_VALIDATOR_VERSION, 'plan-validator-v5');
  assert.equal(PROMPT_VERSION, 'actum-plan-2026-08-01-closed-loop-v5');
  assert.equal(RESEARCH_PROMPT_VERSION, 'actum-research-2026-08-01-closed-loop-v2');
  assert.ok(PLAN_SCHEMA.required.includes('targetTimeline'));
  assert.match(RESEARCH_INSTRUCTIONS, /timer, counter, checklist и text_log/);
  assert.match(RESEARCH_INSTRUCTIONS, /Всё выполнение и журналирование должно завершаться внутри Actum/);
  assert.match(instructions, /days содержит ровно horizonDays объектов/);
  assert.match(instructions, /Никаких repeatCount/);
  assert.match(instructions, /"percentage": 45.*"baseValue": 80.*"result": 36/);
  assert.match(instructions, /execution всегда имеет точную форму \{ "kind": "in_app"/);
  assert.match(instructions, /никаких steps, progressionRule, manual, routine/);
  assert.match(instructions, /Для timer loadBasis\.result точно равен durationSecondsPerSet/);
  assert.match(instructions, /одиночную подводную задержку дыхания/);
  assert.deepEqual(
    execution.properties.blocks.items.anyOf.map((variant) => variant.properties.kind.enum[0]),
    ['timer', 'counter', 'checklist', 'text_log'],
  );
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
        description: 'Выполнить точный встроенный комплекс с наблюдаемым результатом.',
        type: 'practice',
        estimatedMinutes: 10,
        xp: 20,
        execution: {
          kind: 'in_app',
          blocks: [
            {
              kind: 'timer',
              title: 'Субмаксимальный интервал',
              instruction: 'Сохраняй неподвижное положение с обычным дыханием до конца интервала.',
              sets: 3,
              durationSecondsPerSet: 36,
              restSeconds: 60,
              loadBasis: {
                percentage: 45,
                baseValue: 80,
                baseUnit: 'seconds',
                result: 36,
              },
              successCriterion: 'Положение сохраняется до автоматического завершения таймера.',
            },
          ],
          successCriterion: 'Завершены три назначенных интервала.',
        },
        warning: null,
      };
    }),
  };
}

function counterBlock(overrides = {}) {
  return {
    kind: 'counter',
    title: 'Контролируемые повторения',
    instruction: 'Выполняй каждое повторение с одинаковой плавной амплитудой.',
    sets: 1,
    targetPerSet: 8,
    unit: 'reps',
    unitLabel: null,
    workSecondsPerSet: 32,
    restSeconds: 0,
    tempo: 'Ровный контролируемый темп',
    loadBasis: null,
    successCriterion: 'Выполнено ровно восемь контролируемых повторений.',
    ...overrides,
  };
}

function checklistBlock(overrides = {}) {
  return {
    kind: 'checklist',
    title: 'Проверка выполнения',
    items: ['Положение оставалось устойчивым на протяжении интервала.'],
    estimatedSeconds: 30,
    successCriterion: 'Все пункты встроенного списка отмечены.',
    ...overrides,
  };
}

function textLogBlock(overrides = {}) {
  return {
    kind: 'text_log',
    title: 'Короткая рефлексия',
    prompt: 'Опиши сложность сессии и качество техники внутри Actum.',
    minCharacters: 40,
    maxCharacters: 240,
    estimatedSeconds: 60,
    successCriterion: 'Во встроенном поле сохранено не менее сорока символов.',
    ...overrides,
  };
}
