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
import {
  BASELINE_PARSER_VERSION,
  parseTrustedBaseline,
  parseTrustedTarget,
} from '../scripts/ai/contracts/parse-baseline.mjs';
import {
  buildPlanInstructions,
  PROMPT_VERSION,
  RESEARCH_INSTRUCTIONS,
  RESEARCH_PROMPT_VERSION,
} from '../scripts/ai/prompts/plan-v1.mjs';

const USER_BASELINE = 'Сухая статическая задержка: рекорд 1:20';
const USER_PROMPT = 'Научиться задерживать дыхание на 10 минут';
const TRUSTED_BASELINE = { value: 80, unit: 'seconds' };
const TRUSTED_TARGET = { value: 600, unit: 'seconds' };

function validationOptions(overrides = {}) {
  return {
    dailyMinutes: 30,
    duration: 'year',
    cycleNumber: 1,
    expectedBaselineStatement: USER_BASELINE,
    expectedTargetStatement: USER_PROMPT,
    trustedBaseline: TRUSTED_BASELINE,
    trustedTarget: TRUSTED_TARGET,
    ...overrides,
  };
}

function validatePlan(plan, overrides) {
  return validatePlanActionability(plan, validationOptions(overrides));
}

test('plan-v7 accepts a full roadmap and thirty explicit goal-work days', () => {
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

test('a minimal three-block execution keeps one measurable primary action', () => {
  const plan = actionablePlan();
  plan.days[1].execution = {
    kind: 'in_app',
    primaryBlockIndex: 0,
    blocks: [
      {
        kind: 'timer',
        title: 'Техническое удержание',
        instruction: 'Задерживай дыхание до автоматического сигнала таймера.',
        sets: 1,
        durationSecondsPerSet: 30,
        restSeconds: 0,
        loadBasis: {
          percentage: 37.5,
          baseValue: 80,
          baseUnit: 'seconds',
          result: 30,
        },
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
    ],
    successCriterion: 'Все три встроенных блока завершены.',
  };

  assert.doesNotThrow(() => validatePlan(plan));
});

test('every day requires a measurable primary goal block', () => {
  const missing = actionablePlan();
  delete missing.days[0].execution.primaryBlockIndex;
  assert.throws(
    () => validatePlan(missing),
    /execution\.primaryBlockIndex: обязательное поле отсутствует/,
  );

  const absent = actionablePlan();
  absent.days[0].execution.primaryBlockIndex = 2;
  assert.throws(
    () => validatePlan(absent),
    /execution\.primaryBlockIndex: указанный главный блок отсутствует/,
  );

  const checklistPrimary = actionablePlan();
  checklistPrimary.days[0].execution.blocks = [
    checklistBlock({
      title: 'Подготовка материалов',
      items: ['Разложи рабочие карточки по порядку.'],
    }),
    checklistPrimary.days[0].execution.blocks[0],
  ];
  checklistPrimary.days[0].execution.primaryBlockIndex = 0;
  assert.throws(
    () => validatePlan(checklistPrimary),
    /главный блок дня должен быть измеримым timer или counter/,
  );

  const logPrimary = actionablePlan();
  logPrimary.days[0].execution.blocks = [textLogBlock()];
  assert.throws(
    () => validatePlan(logPrimary),
    /главный блок дня должен быть измеримым timer или counter/,
  );
});

test('numeric target fixes the primary primitive, unit, and baseline load', () => {
  const wrongPrimitive = actionablePlan();
  wrongPrimitive.days[0].execution.blocks = [counterBlock()];
  assert.throws(
    () => validatePlan(wrongPrimitive),
    /для временной цели главным блоком должен быть timer/,
  );

  const missingLoad = actionablePlan();
  missingLoad.days[12].execution.blocks[0].loadBasis = null;
  assert.throws(
    () => validatePlan(missingLoad),
    /days\.12\.execution\.blocks\.0\.loadBasis: главный блок должен содержать точную нагрузку от baseline/,
  );
});

test('a zero baseline uses positive absolute primary doses instead of impossible percentages', () => {
  const plan = actionablePlan();
  const baselineStatement = 'Сухая статическая задержка: рекорд 0 секунд';
  plan.baseline.userStatement = baselineStatement;
  plan.baseline.value = 0;
  plan.days.forEach((day) => {
    day.execution.blocks[day.execution.primaryBlockIndex].loadBasis = null;
  });

  assert.doesNotThrow(() =>
    validatePlanActionability(plan, validationOptions({
      expectedBaselineStatement: baselineStatement,
      trustedBaseline: { value: 0, unit: 'seconds' },
    })),
  );
  assert.ok(
    plan.days.every(
      (day) => day.execution.blocks[day.execution.primaryBlockIndex].durationSecondsPerSet > 0,
    ),
  );

  const zeroBaselineFiller = structuredClone(plan);
  zeroBaselineFiller.days.slice(0, 28).forEach((day) => {
    day.execution.blocks[day.execution.primaryBlockIndex].durationSecondsPerSet = 1;
  });
  assert.throws(
    () =>
      validatePlanActionability(zeroBaselineFiller, validationOptions({
        expectedBaselineStatement: baselineStatement,
        trustedBaseline: { value: 0, unit: 'seconds' },
      })),
    /каждый тренировочный день должен содержать целевую дозу не меньше 12 seconds/,
  );
});

test('passive recovery, safety gates, and symptom journals cannot consume a mission', () => {
  const passive = actionablePlan();
  passive.days[28].execution.blocks[0] = {
    ...passive.days[28].execution.blocks[0],
    title: 'Восстановительное дыхание',
    instruction: 'Выполни обычное восстановительное дыхание, не выполняя задержек.',
    successCriterion: 'Обычное дыхание сохранено без намеренных пауз.',
  };
  assert.throws(
    () => validatePlan(passive),
    /пассивное восстановление не может заменять целевую практику/,
  );

  const negatedAction = actionablePlan();
  negatedAction.days[28].execution.blocks[0].instruction =
    'Не задерживай дыхание; лежи до сигнала таймера.';
  assert.throws(
    () => validatePlan(negatedAction),
    /пассивное восстановление не может заменять целевую практику/,
  );

  const safetyGate = actionablePlan();
  safetyGate.days[28].execution.blocks.push(
    checklistBlock({
      title: 'Условия восстановления',
      items: [
        'Сегодня нет задержек дыхания.',
        'Практика проходит на суше.',
        'Положение устойчивое и расслабленное.',
        'Дыхание непрерывное, без намеренных пауз.',
      ],
    }),
  );
  assert.throws(
    () => validatePlan(safetyGate),
    /проверка безопасности или восстановления не является исполняемой практикой/,
  );

  const neutralSafetyGate = actionablePlan();
  neutralSafetyGate.days[28].execution.blocks.push(
    checklistBlock({
      title: 'Проверка выполнения',
      items: [
        'Сегодня нет задержек дыхания.',
        'Практика проходит только на суше.',
        'До начала нет головокружения или тошноты.',
      ],
    }),
  );
  assert.throws(
    () => validatePlan(neutralSafetyGate),
    /проверка безопасности или восстановления не является исполняемой практикой/,
  );

  const symptomLog = actionablePlan();
  symptomLog.days[28].execution.blocks.push(
    textLogBlock({
      title: 'Восстановление после блока',
      prompt: 'Опиши состояние и наличие тревожных симптомов после сессии.',
    }),
  );
  assert.throws(
    () => validatePlan(symptomLog),
    /журнал симптомов или восстановления должен быть вынесен из исполняемой практики/,
  );
});

test('passive breathing inflections stay blocked without blacklisting legitimate recovery goals', () => {
  for (const instruction of [
    'Удерживай внимание, сохраняя обычное дыхание без целевой практики.',
    'Смотри в одну точку и сохраняй спокойное дыхание.',
    'Keep your attention steady and breathe normally without practice.',
  ]) {
    const passive = actionablePlan();
    passive.days[6].execution.blocks[0].instruction = instruction;
    assert.throws(
      () => validatePlan(passive),
      /(?:пассивное восстановление не может заменять целевую практику|обычное дыхание без целевого действия не является практикой)/,
      instruction,
    );
  }

  for (const [title, instruction, targetStatement] of [
    [
      'Восстановление подвижности',
      'Поднимай руку по доступной амплитуде до сигнала таймера.',
      'Восстановить подвижность руки за 10 минут',
    ],
    [
      'Восстановление голоса',
      'Произноси гласные ровно и непрерывно до сигнала таймера.',
      'Восстановить голос за 10 минут',
    ],
  ]) {
    const activeRecovery = actionablePlan();
    activeRecovery.target.userStatement = targetStatement;
    activeRecovery.days[6].execution.blocks[0].title = title;
    activeRecovery.days[6].execution.blocks[0].instruction = instruction;
    assert.doesNotThrow(
      () => validatePlan(activeRecovery, { expectedTargetStatement: targetStatement }),
      title,
    );
  }

  const dataRecoveryLog = actionablePlan();
  dataRecoveryLog.days[6].execution.blocks.push(
    textLogBlock({
      title: 'Разбор восстановления данных',
      prompt: 'Опиши выполненные шаги восстановления данных и полученный результат.',
    }),
  );
  assert.doesNotThrow(() => validatePlan(dataRecoveryLog));
});

test('ordinary breathing is classified by the goal action instead of by a global phrase blacklist', () => {
  const breathHoldWithRecoveryCue = actionablePlan();
  breathHoldWithRecoveryCue.days[6].execution.blocks[0].instruction =
    'После обычного вдоха задержи дыхание до сигнала таймера, затем вернись к обычному дыханию.';
  assert.doesNotThrow(() => validatePlan(breathHoldWithRecoveryCue));

  const ordinaryBreathingOnly = actionablePlan();
  ordinaryBreathingOnly.days[6].execution.blocks[0].instruction =
    'Сохраняй обычное дыхание до сигнала таймера.';
  assert.throws(
    () => validatePlan(ordinaryBreathingOnly),
    /обычное дыхание без целевого действия не является практикой/,
  );

  for (const [title, instruction] of [
    ['День отдыха', 'Лежи неподвижно до сигнала таймера.'],
    ['Пассивная пауза', 'Лежи неподвижно и расслабь мышцы до сигнала таймера.'],
    ['Фокус внимания', 'Смотри в одну точку до сигнала таймера.'],
  ]) {
    const filler = actionablePlan();
    filler.days[6].execution.blocks[0].title = title;
    filler.days[6].execution.blocks[0].instruction = instruction;
    filler.days[6].execution.blocks[0].successCriterion =
      'Назначенный интервал завершён полностью.';
    assert.throws(
      () => validatePlan(filler),
      /пассивное ожидание, отдых или расслабление не может быть главной целевой практикой/,
      title,
    );
  }

  for (const [title, instruction] of [
    [
      'Восстановление после задержки дыхания',
      'Ляг и расслабь тело до сигнала таймера.',
    ],
    [
      'Пассивный интервал',
      'После задержки дыхания ляг и расслабь тело до сигнала таймера.',
    ],
  ]) {
    const contextualMention = actionablePlan();
    contextualMention.days[6].execution.blocks[0].title = title;
    contextualMention.days[6].execution.blocks[0].instruction = instruction;
    contextualMention.days[6].execution.blocks[0].successCriterion =
      'Пассивный интервал завершён полностью.';
    assert.throws(
      () => validatePlan(contextualMention),
      /(?:пассивное ожидание, отдых или расслабление не может быть главной целевой практикой|главный блок дня должен содержать явное действие задержки дыхания непосредственно в instruction)/,
      instruction,
    );
  }

  const calmBreathingGoal = actionablePlan();
  const calmBreathingStatement = 'Научиться спокойно дышать 10 минут';
  calmBreathingGoal.target.userStatement = calmBreathingStatement;
  calmBreathingGoal.days[6].execution.blocks[0].title = 'Спокойное дыхание';
  calmBreathingGoal.days[6].execution.blocks[0].instruction =
    'Сохраняй спокойное дыхание до сигнала таймера.';
  assert.doesNotThrow(() =>
    validatePlan(calmBreathingGoal, {
      expectedTargetStatement: calmBreathingStatement,
    }),
  );
});

test('passive timer work cannot masquerade as an active non-breathing goal', () => {
  const plankGoal = 'Научиться держать планку 10 минут';
  const passivePlank = actionablePlan();
  passivePlank.target.userStatement = plankGoal;
  passivePlank.days[6].execution.blocks[0].instruction =
    'Ляг на спину и расслабляй мышцы до сигнала таймера.';
  assert.throws(
    () => validatePlan(passivePlank, { expectedTargetStatement: plankGoal }),
    /пассивное ожидание, отдых или расслабление не может быть главной целевой практикой/,
  );

  const activeFromFloor = actionablePlan();
  activeFromFloor.target.userStatement = plankGoal;
  activeFromFloor.days[6].execution.blocks[0].instruction =
    'Ляг на спину и выполняй подъёмы таза до сигнала таймера.';
  assert.doesNotThrow(() =>
    validatePlan(activeFromFloor, { expectedTargetStatement: plankGoal }),
  );

  const meditationGoal = 'Научиться медитировать 10 минут';
  const goalDirectedStillness = actionablePlan();
  goalDirectedStillness.target.userStatement = meditationGoal;
  goalDirectedStillness.days[6].execution.blocks[0].instruction =
    'Сиди неподвижно до сигнала таймера.';
  assert.doesNotThrow(() =>
    validatePlan(goalDirectedStillness, { expectedTargetStatement: meditationGoal }),
  );
});

test('low-load target practice and rest between its sets remain valid', () => {
  const plan = actionablePlan();
  const primary = plan.days[4].execution.blocks[0];
  primary.title = 'Лёгкая техника задержки';
  primary.instruction = 'Задерживай дыхание в назначенном положении до сигнала таймера.';
  primary.sets = 2;
  primary.durationSecondsPerSet = 20;
  primary.restSeconds = 90;
  primary.loadBasis = {
    percentage: 25,
    baseValue: 80,
    baseUnit: 'seconds',
    result: 20,
  };

  assert.doesNotThrow(() => validatePlan(plan));
});

test('counter goals reject token daily work even when one late day is high', () => {
  const plan = actionablePlan();
  const baselineStatement = 'Сейчас выполняю 8 повторений';
  const targetStatement = 'Хочу выполнять 50 повторений';
  const roadmapValues = [12, 16, 20, 24, 28, 32, 36, 40, 44, 46, 48, 50];
  plan.target.userStatement = targetStatement;
  plan.target.normalizedMetric = 'Контролируемые повторения';
  plan.target.value = 50;
  plan.target.unit = 'reps';
  plan.baseline.userStatement = baselineStatement;
  plan.baseline.normalizedMetric = 'Контролируемые повторения';
  plan.baseline.value = 8;
  plan.baseline.unit = 'reps';
  plan.roadmap.forEach((entry, index) => {
    entry.targetValue = roadmapValues[index];
    entry.targetUnit = 'reps';
  });
  plan.assessment.metric = 'Контролируемые повторения';
  plan.assessment.targetValue = 12;
  plan.assessment.targetUnit = 'reps';
  plan.days.forEach((day, index) => {
    const targetPerSet = index === 29 ? 12 : index === 28 ? 3 : 2;
    day.execution.blocks = [counterBlock({
      targetPerSet,
      loadBasis: {
        percentage: targetPerSet / 8 * 100,
        baseValue: 8,
        baseUnit: 'reps',
        result: targetPerSet,
      },
    })];
  });
  const options = {
    expectedBaselineStatement: baselineStatement,
    expectedTargetStatement: targetStatement,
    trustedBaseline: { value: 8, unit: 'reps' },
    trustedTarget: { value: 50, unit: 'reps' },
  };
  assert.doesNotThrow(() => validatePlan(plan, options));

  const tokenWork = structuredClone(plan);
  tokenWork.days.slice(0, 28).forEach((day) => {
    day.execution.blocks[0].targetPerSet = 1;
    day.execution.blocks[0].loadBasis = {
      percentage: 12.5,
      baseValue: 8,
      baseUnit: 'reps',
      result: 1,
    };
  });
  assert.throws(
    () => validatePlan(tokenWork, options),
    /каждый тренировочный день должен содержать целевую дозу не меньше 2 reps/,
  );
});

test('plan-v7 rejects legacy day fields and non-exact block shapes', () => {
  const legacySteps = actionablePlan();
  legacySteps.days[0].steps = ['Старое свободное указание.'];
  assert.throws(
    () => validatePlan(legacySteps),
    /days\.0\.steps: поле не поддерживается контрактом plan-v7/,
  );

  const legacyProgression = actionablePlan();
  legacyProgression.days[0].progressionRule = 'Если готово, увеличь; иначе повтори.';
  assert.throws(
    () => validatePlan(legacyProgression),
    /days\.0\.progressionRule: поле не поддерживается контрактом plan-v7/,
  );

  const extraTimerField = actionablePlan();
  extraTimerField.days[0].execution.blocks[0].workSecondsPerSet = 36;
  assert.throws(
    () => validatePlan(extraTimerField),
    /execution\.blocks\.0\.workSecondsPerSet: поле не поддерживается контрактом plan-v7/,
  );

  const wrongExecutionKind = actionablePlan();
  wrongExecutionKind.days[0].execution.kind = 'routine';
  assert.throws(
    () => validatePlan(wrongExecutionKind),
    /execution\.kind: для plan-v7 ожидается только in_app/,
  );
});

test('numeric and estimated block durations must fit the declared day', () => {
  const timerPlan = actionablePlan();
  const timerDay = timerPlan.days[0];
  timerDay.estimatedMinutes = 1;
  timerDay.execution.blocks[0].sets = 2;
  timerDay.execution.blocks[0].durationSecondsPerSet = 20;
  timerDay.execution.blocks[0].restSeconds = 30;
  timerDay.execution.blocks[0].loadBasis = {
    percentage: 25,
    baseValue: 80,
    baseUnit: 'seconds',
    result: 20,
  };
  assert.throws(
    () => validatePlan(timerPlan),
    /известная длительность блоков превышает заявленную длительность дня/,
  );

  const counterPlan = actionablePlan();
  const counterDay = counterPlan.days[0];
  counterDay.estimatedMinutes = 1;
  counterDay.execution.blocks[0] = {
    ...counterDay.execution.blocks[0],
    sets: 1,
    durationSecondsPerSet: 10,
    restSeconds: 0,
    loadBasis: { percentage: 12.5, baseValue: 80, baseUnit: 'seconds', result: 10 },
  };
  counterDay.execution.blocks.push(counterBlock({ workSecondsPerSet: 61 }));
  assert.throws(
    () => validatePlan(counterPlan),
    /известная длительность блоков превышает заявленную длительность дня/,
  );

  const estimatedPlan = actionablePlan();
  const estimatedDay = estimatedPlan.days[0];
  estimatedDay.estimatedMinutes = 1;
  estimatedDay.execution.blocks = [
    {
      ...estimatedDay.execution.blocks[0],
      sets: 1,
      durationSecondsPerSet: 1,
      restSeconds: 0,
      loadBasis: { percentage: 1.25, baseValue: 80, baseUnit: 'seconds', result: 1 },
    },
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
    plan.days[0].execution.blocks[0],
    textLogBlock({
      title: 'Session notes',
      prompt: 'Write notes about how the built-in session felt.',
      successCriterion: 'The note is saved in the built-in text log.',
    }),
  ];

  assert.doesNotThrow(() =>
    validatePlanActionability(plan, validationOptions({
      expectedBaselineStatement: baselineStatement,
    })),
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

test('safety copy allows prohibitions and risk-triggered escalation but not routine prerequisites', () => {
  const plan = actionablePlan();
  plan.safetyNotes = [
    'В текущем блоке нельзя самостоятельно добавлять CO₂- или O₂-таблицы.',
    'Не используй внешний секундомер и не отправляй результат тренеру.',
  ];
  plan.days[0].warning =
    'Если боль не проходит после остановки, прекрати миссию и обратись к врачу.';

  assert.doesNotThrow(() => validatePlan(plan));

  plan.days[0].warning = 'При головокружении прекрати миссию и обратись к врачу.';
  assert.doesNotThrow(() => validatePlan(plan));

  plan.safetyNotes = ['Перед следующим днём обязательно посети специалиста.'];
  assert.throws(
    () => validatePlan(plan),
    /внешняя зависимость: действие должно выполняться внутри Actum/,
  );

  plan.safetyNotes = [
    'Не используй внешний таймер; перед следующим днём обязательно посети специалиста.',
  ];
  assert.throws(
    () => validatePlan(plan),
    /внешняя зависимость: действие должно выполняться внутри Actum/,
  );

  for (const mixedNote of [
    'Не используй внешний таймер и перед следующим днём обязательно посети специалиста.',
    'Если появилась боль, прекрати миссию, а перед следующим днём обязательно посети специалиста.',
  ]) {
    plan.safetyNotes = [mixedNote];
    assert.throws(
      () => validatePlan(plan),
      /внешняя зависимость: действие должно выполняться внутри Actum/,
      mixedNote,
    );
  }
});

test('physical form wording is not mistaken for an external form', () => {
  const plan = actionablePlan();
  plan.days[0].execution.blocks = [
    plan.days[0].execution.blocks[0],
    textLogBlock({
      prompt: 'Запиши напряжение и что позволило сохранить точную форму.',
    }),
  ];

  assert.doesNotThrow(() => validatePlan(plan));

  plan.days[0].execution.blocks = [
    plan.days[0].execution.blocks[0],
    textLogBlock({ prompt: 'Используй точную форму движения на протяжении подхода.' }),
  ];
  assert.doesNotThrow(() => validatePlan(plan));

  plan.days[0].execution.blocks = [
    plan.days[0].execution.blocks[0],
    textLogBlock({ prompt: 'Complete every repetition with proper form.' }),
  ];
  assert.doesNotThrow(() => validatePlan(plan));
});

test('text_log can mention support without turning it into external contact', () => {
  for (const prompt of [
    'Напиши, как поддержка друга помогла сохранить технику.',
    'Write how support from a friend affected the session.',
  ]) {
    const plan = actionablePlan();
    plan.days[0].execution.blocks = [plan.days[0].execution.blocks[0], textLogBlock({ prompt })];
    assert.doesNotThrow(() => validatePlan(plan), prompt);
  }

  for (const prompt of [
    'Напиши другу результат после сессии.',
    'Write to a friend after the session.',
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

test('calendar-labelled block titles do not become hidden timed work', () => {
  const plan = actionablePlan();
  plan.days[0].execution.blocks[0].title = 'Итоговая запись 30 дней';

  assert.doesNotThrow(() => validatePlan(plan));

  plan.days[0].execution.blocks[0].title = 'Удержание 40 секунд';
  assert.throws(
    () => validatePlan(plan),
    /временная нагрузка должна быть структурным полем встроенного timer\/counter/,
  );
});

test('external forms and tables remain forbidden inside executable blocks', () => {
  for (const instruction of [
    'Заполни внешнюю таблицу с результатами после подхода.',
    'Сохрани форму отчёта после завершения подхода.',
  ]) {
    const plan = actionablePlan();
    plan.days[0].execution.blocks[0].instruction = instruction;
    assert.throws(
      () => validatePlan(plan),
      /внешняя зависимость: действие должно выполняться внутри Actum/,
      instruction,
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
  custom.days[0].execution.blocks.push(counterBlock({ unit: 'custom', unitLabel: null }));
  assert.throws(() => validatePlan(custom), /unitLabel/);
  custom.days[0].execution.blocks[1].unitLabel = 'дыхательных циклов';
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
  const targetStatement = 'Улучшить качество контролируемых повторений';
  plan.target.userStatement = targetStatement;
  plan.baseline = {
    userStatement: baselineStatement,
    normalizedMetric: 'Контролируемые повторения',
    value: 8,
    unit: 'repetitions',
    calculationRule: 'Исходное значение восемь повторений фиксируется на весь блок.',
  };
  plan.target.value = null;
  plan.target.unit = null;
  plan.roadmap.forEach((entry) => {
    entry.targetValue = null;
    entry.targetUnit = null;
  });
  plan.assessment.targetValue = null;
  plan.assessment.targetUnit = null;
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
    validatePlanActionability(plan, validationOptions({
      expectedBaselineStatement: baselineStatement,
      expectedTargetStatement: targetStatement,
      trustedBaseline: { value: 8, unit: 'reps' },
      trustedTarget: null,
    })),
  );

  plan.days[0].execution.blocks[0].targetPerSet = 7;
  assert.throws(
    () =>
      validatePlanActionability(plan, validationOptions({
        expectedBaselineStatement: baselineStatement,
        expectedTargetStatement: targetStatement,
        trustedBaseline: { value: 8, unit: 'reps' },
        trustedTarget: null,
      })),
    /targetPerSet 7 не совпадает с loadBasis\.result 6/,
  );

  plan.days[0].execution.blocks[0].targetPerSet = 6;
  plan.days[0].execution.blocks[0].loadBasis.result = 6.009;
  assert.throws(
    () =>
      validatePlanActionability(plan, validationOptions({
        expectedBaselineStatement: baselineStatement,
        expectedTargetStatement: targetStatement,
        trustedBaseline: { value: 8, unit: 'reps' },
        trustedTarget: null,
      })),
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
    /главный блок должен содержать точную нагрузку от baseline/,
  );

  const untrusted = actionablePlan();
  untrusted.domain = 'habit';
  untrusted.baseline.value = null;
  untrusted.baseline.unit = null;
  untrusted.days.forEach((day) => {
    day.execution.blocks[0].loadBasis = null;
  });
  assert.doesNotThrow(() =>
    validatePlanActionability(untrusted, validationOptions({ trustedBaseline: null })),
  );
});

test('duration, baseline, exact target, calendar coverage, and phases remain strict', () => {
  const changedDuration = actionablePlan();
  changedDuration.duration = 'half-year';
  assert.throws(
    () => validatePlan(changedDuration),
    /duration: выбранный срок программы был изменён/,
  );

  const changedTarget = actionablePlan();
  changedTarget.target.userStatement = `${USER_PROMPT}.`;
  assert.throws(() => validatePlan(changedTarget), /цель пользователя должна быть сохранена дословно/);

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

  const reordered = actionablePlan();
  [reordered.days[0], reordered.days[1]] = [reordered.days[1], reordered.days[0]];
  assert.throws(
    () => validatePlan(reordered),
    /days\.0\.dayNumber: ожидается последовательный день 1/,
  );

  const phaseGap = actionablePlan();
  phaseGap.phases[1].startDay = 12;
  assert.throws(
    () => validatePlan(phaseGap),
    /ожидается день 11 без разрыва или пересечения/,
  );
});

test('roadmap is monotonic, reaches the final target, and matches the day-30 assessment', () => {
  const backwards = actionablePlan();
  backwards.roadmap[4].targetValue = 200;
  assert.throws(
    () => validatePlan(backwards),
    /roadmap\.4\.targetValue: этапы должны монотонно приближаться к цели/,
  );

  const missesTarget = actionablePlan();
  missesTarget.roadmap[11].targetValue = 590;
  assert.throws(
    () => validatePlan(missesTarget),
    /целевой и последующие циклы должны точно совпадать с конечной целью/,
  );

  const mismatchedAssessment = actionablePlan();
  mismatchedAssessment.assessment.targetValue = 121;
  assert.throws(
    () => validatePlan(mismatchedAssessment),
    /assessment: контрольный замер должен совпадать с целью текущего цикла/,
  );

  const displayOnlyAssessment = actionablePlan();
  displayOnlyAssessment.days[29].execution.blocks = [checklistBlock()];
  assert.throws(
    () => validatePlan(displayOnlyAssessment),
    /главный блок дня должен быть измеримым timer или counter/,
  );

  const timerMismatch = actionablePlan();
  timerMismatch.days[29].execution.blocks[0].durationSecondsPerSet = 119;
  timerMismatch.days[29].execution.blocks[0].loadBasis = {
    percentage: 148.75,
    baseValue: 80,
    baseUnit: 'seconds',
    result: 119,
  };
  assert.throws(
    () => validatePlan(timerMismatch),
    /длительность timer не совпадает с целью замера/,
  );
});

test('targetCycleNumber reaches the goal at the earliest declared cycle without stretching', () => {
  const firstMonth = actionablePlan();
  firstMonth.targetCycleNumber = 1;
  firstMonth.roadmap.forEach((entry) => {
    entry.targetValue = 600;
  });
  firstMonth.assessment.targetValue = 600;
  firstMonth.days.slice(0, 28).forEach((day) => {
    day.execution.blocks[0].durationSecondsPerSet = 60;
    day.execution.blocks[0].loadBasis = {
      percentage: 75,
      baseValue: 80,
      baseUnit: 'seconds',
      result: 60,
    };
  });
  firstMonth.days[29].execution.blocks[0] = {
    ...firstMonth.days[29].execution.blocks[0],
    durationSecondsPerSet: 600,
    loadBasis: {
      percentage: 750,
      baseValue: 80,
      baseUnit: 'seconds',
      result: 600,
    },
  };
  firstMonth.days[28].execution.blocks[0] = {
    ...firstMonth.days[28].execution.blocks[0],
    durationSecondsPerSet: 150,
    loadBasis: {
      percentage: 187.5,
      baseValue: 80,
      baseUnit: 'seconds',
      result: 150,
    },
  };
  assert.doesNotThrow(() => validatePlan(firstMonth));

  const assessmentJump = structuredClone(firstMonth);
  assessmentJump.days.slice(0, 28).forEach((day) => {
    day.execution.blocks[0].durationSecondsPerSet = 1;
    day.execution.blocks[0].loadBasis = {
      percentage: 1.25,
      baseValue: 80,
      baseUnit: 'seconds',
      result: 1,
    };
  });
  assert.throws(
    () => validatePlan(assessmentJump),
    /каждый тренировочный день должен содержать целевую дозу не меньше 60 seconds \(max из 25% baseline и 10% цели текущего цикла\)/,
  );

  const lateAssessmentJump = structuredClone(firstMonth);
  lateAssessmentJump.days[28].execution.blocks[0].durationSecondsPerSet = 60;
  lateAssessmentJump.days[28].execution.blocks[0].loadBasis = {
    percentage: 75,
    baseValue: 80,
    baseUnit: 'seconds',
    result: 60,
  };
  assert.throws(
    () => validatePlan(lateAssessmentJump),
    /последний тренировочный день перед замером должен содержать целевую дозу не меньше 150 seconds/,
  );

  const thirdCycle = actionablePlan();
  thirdCycle.targetCycleNumber = 3;
  thirdCycle.roadmap.forEach((entry, index) => {
    entry.targetValue = index === 0 ? 120 : index === 1 ? 360 : 600;
  });
  assert.doesNotThrow(() => validatePlan(thirdCycle));
  assert.doesNotThrow(() =>
    validatePlan(thirdCycle, { researchTargetCycleNumber: 3 }),
  );

  assert.throws(
    () => validatePlan(thirdCycle, { researchTargetCycleNumber: 2 }),
    /targetCycleNumber: ожидается подтверждённый research цикл 2/,
  );

  const stretched = structuredClone(thirdCycle);
  stretched.roadmap[2].targetValue = 500;
  assert.throws(
    () => validatePlan(stretched),
    /целевой и последующие циклы должны точно совпадать с конечной целью/,
  );

  const declaredLate = structuredClone(thirdCycle);
  declaredLate.targetCycleNumber = 4;
  assert.throws(
    () => validatePlan(declaredLate),
    /конечная цель достигнута раньше указанного targetCycleNumber/,
  );

  const plateau = structuredClone(thirdCycle);
  plateau.roadmap[1].targetValue = 120;
  assert.throws(
    () => validatePlan(plateau),
    /промежуточные будущие этапы не должны создавать плато/,
  );

  const noCurrentProgress = actionablePlan();
  noCurrentProgress.roadmap[0].targetValue = 80;
  assert.throws(
    () => validatePlan(noCurrentProgress),
    /текущий и будущие этапы должны строго приближаться к цели/,
  );
});

test('decreasing targets use the same strict earliest-cycle rules', () => {
  const plan = actionablePlan();
  plan.target.value = 50;
  plan.targetCycleNumber = 3;
  plan.roadmap.forEach((entry, index) => {
    entry.targetValue = index === 0 ? 70 : index === 1 ? 60 : 50;
  });
  plan.assessment.targetValue = 70;
  plan.days[29].execution.blocks[0] = {
    ...plan.days[29].execution.blocks[0],
    durationSecondsPerSet: 70,
    loadBasis: {
      percentage: 87.5,
      baseValue: 80,
      baseUnit: 'seconds',
      result: 70,
    },
  };

  assert.doesNotThrow(() => validatePlan(plan, { trustedTarget: { value: 50, unit: 'seconds' } }));

  plan.roadmap[0].targetValue = 80;
  assert.throws(
    () => validatePlan(plan, { trustedTarget: { value: 50, unit: 'seconds' } }),
    /текущий и будущие этапы должны строго приближаться к цели/,
  );
});

test('a missed planned target remains frozen while the next cycle retries it', () => {
  const first = actionablePlan();
  first.targetCycleNumber = 1;
  first.roadmap.forEach((entry) => {
    entry.targetValue = 600;
  });

  const second = structuredClone(first);
  const nextBaselineStatement = 'Новый контрольный результат: рекорд 1 минута 30 секунд';
  second.cycleNumber = 2;
  second.targetCycleNumber = 2;
  second.baseline.userStatement = nextBaselineStatement;
  second.baseline.value = 90;
  second.days.forEach((day, index) => {
    const result = index === 29 ? 600 : 60;
    day.execution.blocks[0].durationSecondsPerSet = result;
    day.execution.blocks[0].loadBasis = {
      percentage: result / 90 * 100,
      baseValue: 90,
      baseUnit: 'seconds',
      result,
    };
  });
  second.days[28].execution.blocks[0].durationSecondsPerSet = 150;
  second.days[28].execution.blocks[0].loadBasis = {
    percentage: 150 / 90 * 100,
    baseValue: 90,
    baseUnit: 'seconds',
    result: 150,
  };
  second.assessment.targetValue = 600;
  const programContext = {
    target: structuredClone(first.target),
    roadmap: structuredClone(first.roadmap),
    completedCycles: [
      { cycleNumber: 1, completedAt: '2026-10-04T00:00:00.000Z', measuredValue: 90, unit: 'seconds' },
    ],
  };

  assert.doesNotThrow(() =>
    validatePlanActionability(second, validationOptions({
      cycleNumber: 2,
      expectedBaselineStatement: nextBaselineStatement,
      trustedBaseline: { value: 90, unit: 'seconds' },
      programContext,
      researchTargetCycleNumber: null,
    })),
  );

  const delayed = structuredClone(second);
  delayed.targetCycleNumber = 3;
  delayed.roadmap[1].targetValue = 300;
  delayed.assessment.targetValue = 300;
  delayed.days[29].execution.blocks[0].durationSecondsPerSet = 300;
  delayed.days[29].execution.blocks[0].loadBasis = {
    percentage: 300 / 90 * 100,
    baseValue: 90,
    baseUnit: 'seconds',
    result: 300,
  };
  assert.doesNotThrow(() =>
    validatePlanActionability(delayed, validationOptions({
      cycleNumber: 2,
      expectedBaselineStatement: nextBaselineStatement,
      trustedBaseline: { value: 90, unit: 'seconds' },
      programContext,
      researchTargetCycleNumber: 1,
    })),
    'a frozen missed target must not block a newly researched later target cycle',
  );

  assert.throws(
    () => validatePlanActionability(second, validationOptions({
      cycleNumber: 2,
      expectedBaselineStatement: nextBaselineStatement,
      trustedBaseline: { value: 90, unit: 'seconds' },
      programContext,
      researchTargetCycleNumber: 3,
    })),
    /targetCycleNumber: после нового замера ожидается цикл не раньше 3/,
  );
});

test('quick planning cannot invent a shorter target cycle without research', () => {
  const fresh = actionablePlan();
  assert.throws(
    () => validatePlan(fresh, { researchTargetCycleNumber: null }),
    /без web-research ожидается сохранённый ближайший цикл 1/,
  );

  const second = actionablePlan();
  const nextBaselineStatement = 'Новый контрольный результат: рекорд 2 минуты 10 секунд';
  second.cycleNumber = 2;
  second.baseline = {
    ...second.baseline,
    userStatement: nextBaselineStatement,
    value: 130,
  };
  second.days.forEach((day, index) => {
    const result = index === 29 ? 165 : 52;
    day.execution.blocks[0].durationSecondsPerSet = result;
    day.execution.blocks[0].loadBasis = {
      percentage: result / 130 * 100,
      baseValue: 130,
      baseUnit: 'seconds',
      result,
    };
  });
  second.assessment.targetValue = 165;
  const context = {
    targetCycleNumber: 12,
    target: structuredClone(actionablePlan().target),
    roadmap: structuredClone(actionablePlan().roadmap),
    completedCycles: [
      { cycleNumber: 1, completedAt: '2026-10-04T00:00:00.000Z', measuredValue: 130, unit: 'seconds' },
    ],
  };
  assert.doesNotThrow(() =>
    validatePlanActionability(second, validationOptions({
      cycleNumber: 2,
      expectedBaselineStatement: nextBaselineStatement,
      trustedBaseline: { value: 130, unit: 'seconds' },
      programContext: context,
      researchTargetCycleNumber: null,
    })),
  );

  const qualitative = actionablePlan();
  qualitative.cycleNumber = 2;
  qualitative.targetCycleNumber = 2;
  qualitative.target.value = null;
  qualitative.target.unit = null;
  qualitative.roadmap.forEach((entry) => {
    entry.targetValue = null;
    entry.targetUnit = null;
  });
  qualitative.assessment.targetValue = null;
  qualitative.assessment.targetUnit = null;
  const qualitativeContext = {
    targetCycleNumber: 1,
    target: structuredClone(qualitative.target),
    roadmap: structuredClone(qualitative.roadmap),
    completedCycles: [
      { cycleNumber: 1, completedAt: '2026-10-04T00:00:00.000Z', measuredValue: null, unit: null },
    ],
  };
  assert.doesNotThrow(() =>
    validatePlanActionability(qualitative, validationOptions({
      cycleNumber: 2,
      trustedTarget: null,
      programContext: qualitativeContext,
      researchTargetCycleNumber: null,
    })),
  );
});

test('later cycles adapt to a new baseline without rewriting completed roadmap entries', () => {
  const firstCycle = actionablePlan();
  const secondCycle = actionablePlan();
  const newBaselineStatement = 'Новый контрольный результат: рекорд 2 минуты 10 секунд';
  secondCycle.cycleNumber = 2;
  secondCycle.baseline = {
    ...secondCycle.baseline,
    userStatement: newBaselineStatement,
    value: 130,
  };
  secondCycle.assessment.targetValue = secondCycle.roadmap[1].targetValue;
  secondCycle.days.forEach((day, index) => {
    const assessmentDay = index === 29;
    const durationSecondsPerSet = assessmentDay ? 165 : 59;
    day.execution.blocks = [{
      ...day.execution.blocks[0],
      sets: assessmentDay ? 1 : 3,
      durationSecondsPerSet,
      restSeconds: assessmentDay ? 0 : 60,
      loadBasis: {
        percentage: assessmentDay ? (165 / 130) * 100 : 45,
        baseValue: 130,
        baseUnit: 'seconds',
        result: durationSecondsPerSet,
      },
    }];
  });
  const programContext = {
    target: structuredClone(firstCycle.target),
    roadmap: structuredClone(firstCycle.roadmap),
    completedCycles: [
      { cycleNumber: 1, completedAt: '2026-10-04T00:00:00.000Z', measuredValue: 130, unit: 'seconds' },
    ],
  };
  const options = validationOptions({
    cycleNumber: 2,
    expectedBaselineStatement: newBaselineStatement,
    trustedBaseline: { value: 130, unit: 'seconds' },
    programContext,
  });

  assert.equal(validatePlanActionability(secondCycle, options), secondCycle);

  const renamedTarget = structuredClone(secondCycle);
  renamedTarget.target.normalizedMetric = 'Другая формулировка той же метрики';
  assert.throws(
    () => validatePlanActionability(renamedTarget, options),
    /target: цель программы нельзя изменять между циклами/,
  );

  const aliasedTargetUnit = structuredClone(secondCycle);
  aliasedTargetUnit.target.unit = 'секунд';
  assert.throws(
    () => validatePlanActionability(aliasedTargetUnit, options),
    /target: цель программы нельзя изменять между циклами/,
  );

  secondCycle.roadmap[0].focus = 'Переписанный завершённый цикл.';
  assert.throws(
    () => validatePlanActionability(secondCycle, options),
    /roadmap\.0: завершённый этап программы нельзя изменять/,
  );
});

test('a migrated legacy roadmap preserves completed null milestones but keeps the active future numeric', () => {
  const migratedContextPlan = actionablePlan();
  const secondCycle = actionablePlan();
  secondCycle.cycleNumber = 2;
  secondCycle.cycleGoal = 'Проверить сухую задержку на уровне ста шестидесяти пяти секунд.';
  secondCycle.roadmap[0].targetValue = null;
  secondCycle.roadmap[0].targetUnit = null;
  secondCycle.assessment.targetValue = 165;
  secondCycle.days[29].execution.blocks[0] = {
    ...secondCycle.days[29].execution.blocks[0],
    durationSecondsPerSet: 165,
    loadBasis: {
      percentage: 206.25,
      baseValue: 80,
      baseUnit: 'seconds',
      result: 165,
    },
  };
  secondCycle.days[28].execution.blocks[0] = {
    ...secondCycle.days[28].execution.blocks[0],
    durationSecondsPerSet: 42,
    loadBasis: {
      percentage: 52.5,
      baseValue: 80,
      baseUnit: 'seconds',
      result: 42,
    },
  };

  const legacyRoadmap = structuredClone(migratedContextPlan.roadmap);
  legacyRoadmap.forEach((entry) => {
    entry.targetValue = null;
    entry.targetUnit = null;
  });
  const programContext = {
    target: structuredClone(migratedContextPlan.target),
    roadmap: legacyRoadmap,
    completedCycles: [
      { cycleNumber: 1, completedAt: '2026-10-04T00:00:00.000Z', measuredValue: 80, unit: 'seconds' },
    ],
  };
  const options = validationOptions({ cycleNumber: 2, programContext });

  assert.equal(validatePlanActionability(secondCycle, options), secondCycle);

  const rewrittenPast = structuredClone(secondCycle);
  rewrittenPast.roadmap[0].targetValue = 120;
  rewrittenPast.roadmap[0].targetUnit = 'seconds';
  assert.throws(
    () => validatePlanActionability(rewrittenPast, options),
    /roadmap\.0: завершённый этап программы нельзя изменять/,
  );

  const missingActiveMilestone = structuredClone(secondCycle);
  missingActiveMilestone.roadmap[1].targetValue = null;
  missingActiveMilestone.roadmap[1].targetUnit = null;
  missingActiveMilestone.assessment.targetValue = null;
  missingActiveMilestone.assessment.targetUnit = null;
  assert.throws(
    () => validatePlanActionability(missingActiveMilestone, options),
    /roadmap\.1\.targetValue: ожидается число/,
  );

  const freshPlanWithNullMilestone = actionablePlan();
  freshPlanWithNullMilestone.roadmap[0].targetValue = null;
  freshPlanWithNullMilestone.roadmap[0].targetUnit = null;
  freshPlanWithNullMilestone.assessment.targetValue = null;
  freshPlanWithNullMilestone.assessment.targetUnit = null;
  assert.throws(
    () => validatePlan(freshPlanWithNullMilestone),
    /roadmap\.0\.targetValue: ожидается число/,
  );
});

test('dynamic provider schema fixes calendar and every block duration before the paid response', () => {
  const schema = createPlanSchema(45, 'half-year', 3);
  const day = schema.properties.days.items.properties;
  const execution = day.execution;
  const variants = execution.properties.blocks.items.anyOf;
  const block = (kind) => variants.find((variant) => variant.properties.kind.enum[0] === kind);

  assert.equal(schema.properties.days.minItems, 30);
  assert.equal(schema.properties.days.maxItems, 30);
  assert.deepEqual(schema.properties.duration.enum, ['half-year']);
  assert.deepEqual(schema.properties.totalCycles.enum, [6]);
  assert.deepEqual(schema.properties.cycleNumber.enum, [3]);
  assert.equal(schema.properties.roadmap.minItems, 6);
  assert.equal(schema.properties.roadmap.maxItems, 6);
  assert.equal(day.dayNumber.maximum, 30);
  assert.equal(day.estimatedMinutes.maximum, 45);
  assert.equal(execution.properties.kind.enum[0], 'in_app');
  assert.equal(execution.properties.blocks.minItems, 1);
  assert.equal(execution.properties.blocks.maxItems, 3);
  assert.equal(execution.properties.primaryBlockIndex.maximum, 2);
  assert.equal(schema.properties.targetCycleNumber.minimum, 3);
  assert.equal(schema.properties.targetCycleNumber.maximum, 6);
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

test('local target parser normalizes the requested measurable outcome', () => {
  assert.equal(BASELINE_PARSER_VERSION, 'numeric-metric-v2');
  assert.deepEqual(parseTrustedTarget(USER_PROMPT), TRUSTED_TARGET);
  assert.deepEqual(parseTrustedTarget('Хочу удерживать планку 2 минуты'), {
    value: 120,
    unit: 'seconds',
  });
  assert.deepEqual(parseTrustedTarget('Хочу выполнить 50 повторений'), {
    value: 50,
    unit: 'reps',
  });
  assert.equal(parseTrustedTarget('Хочу улучшить технику'), null);
});

test('prompt, research, schema, and validator advertise the direct-practice plan-v7 contract', () => {
  const instructions = buildPlanInstructions({ researchTargetCycleNumber: 12 });
  const execution = PLAN_SCHEMA.properties.days.items.properties.execution;

  assert.equal(PLAN_CONTRACT_VERSION, 'plan-v7');
  assert.equal(PLAN_VALIDATOR_VERSION, 'plan-validator-v9');
  assert.equal(PROMPT_VERSION, 'actum-plan-2026-09-04-direct-practice-v4');
  assert.equal(RESEARCH_PROMPT_VERSION, 'actum-research-2026-09-04-fastest-program-v5');
  assert.ok(PLAN_SCHEMA.required.includes('duration'));
  assert.ok(PLAN_SCHEMA.required.includes('roadmap'));
  assert.ok(PLAN_SCHEMA.required.includes('assessment'));
  assert.ok(PLAN_SCHEMA.required.includes('targetCycleNumber'));
  assert.equal(PLAN_SCHEMA.required.includes('targetTimeline'), false);
  assert.match(RESEARCH_INSTRUCTIONS, /timer,\s+counter, checklist и text_log/);
  assert.match(RESEARCH_INSTRUCTIONS, /внутри Actum/);
  assert.match(RESEARCH_INSTRUCTIONS, /максимальную траекторию: 12/);
  assert.match(RESEARCH_INSTRUCTIONS, /retry cap исследователь не\s+получает/);
  assert.match(RESEARCH_INSTRUCTIONS, /earliestTargetCycleNumber/);
  assert.match(RESEARCH_INSTRUCTIONS, /отдельный день\s+только отдыха/);
  assert.match(instructions, /days содержит ровно 30 явных объектов/);
  assert.match(instructions, /roadmap содержит ровно totalCycles/);
  assert.match(instructions, /следующий запрос строит новый цикл/);
  assert.match(instructions, /legacy-записи оба поля targetValue\/targetUnit равны null/);
  assert.match(instructions, /текущая и все будущие\s+записи roadmap обязаны иметь числовые targetValue/);
  assert.match(instructions, /durationSecondsPerSet точно равен assessment\.targetValue/);
  assert.match(instructions, /primaryBlockIndex/);
  assert.match(instructions, /дней только отдыха или восстановления нет/);
  assert.match(instructions, /главный блок каждого дня 1–29\s+имеет дозу не меньше max\(25% trustedBaseline\.value, 10% assessment\.targetValue\)/);
  assert.match(instructions, /Главный блок дня 29.*не меньше 25% assessment\.targetValue/su);
  assert.match(instructions, /обязателен именно в instruction/);
  assert.match(instructions, /одиночную подводную задержку/);
  assert.match(instructions, /Предупреждения допускаются только в safetyNotes и day\.warning/);
  assert.deepEqual(
    execution.properties.blocks.items.anyOf.map((variant) => variant.properties.kind.enum[0]),
    ['timer', 'counter', 'checklist', 'text_log'],
  );
});

function actionablePlan() {
  const horizonDays = 30;
  const firstEnd = 10;
  const secondEnd = 20;
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
    duration: 'year',
    totalCycles: 12,
    cycleNumber: 1,
    targetCycleNumber: 12,
    target: {
      userStatement: USER_PROMPT,
      normalizedMetric: 'Максимальная сухая статическая задержка',
      value: 600,
      unit: 'seconds',
    },
    cycleGoal: 'Проверить устойчивую сухую задержку на уровне ста двадцати секунд.',
    roadmap: [120, 165, 210, 255, 300, 345, 390, 435, 480, 525, 560, 600].map(
      (targetValue, index) => ({
        cycleNumber: index + 1,
        title: `Цикл ${index + 1}`,
        focus: 'Последовательное развитие измеримого навыка внутри Actum.',
        targetValue,
        targetUnit: 'seconds',
      }),
    ),
    assessment: {
      dayNumber: 30,
      blockIndex: 0,
      metric: 'Максимальная сухая статическая задержка',
      targetValue: 120,
      targetUnit: 'seconds',
    },
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
      const assessmentDay = dayNumber === 30;
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
          primaryBlockIndex: 0,
          blocks: [
            {
              kind: 'timer',
              title: 'Субмаксимальный интервал',
              instruction: 'Задерживай дыхание в неподвижном положении до сигнала таймера.',
              sets: assessmentDay ? 1 : 3,
              durationSecondsPerSet: assessmentDay ? 120 : 36,
              restSeconds: assessmentDay ? 0 : 60,
              loadBasis: {
                percentage: assessmentDay ? 150 : 45,
                baseValue: 80,
                baseUnit: 'seconds',
                result: assessmentDay ? 120 : 36,
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
    items: ['Назначенная задержка дыхания запущена и завершена внутри Actum.'],
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
