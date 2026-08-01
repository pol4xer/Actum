export const PLAN_VALIDATOR_VERSION = 'plan-validator-v4.1';

const ROUTINE_UNITS = new Set([
  'reps',
  'seconds',
  'minutes',
  'pages',
  'items',
  'words',
  'meters',
  'attempts',
  'custom',
]);
const DISCRETE_ROUTINE_UNITS = new Set(['reps', 'pages', 'items', 'words', 'attempts']);
const GOAL_DOMAINS = new Set(['read', 'learn', 'practice', 'organize', 'move', 'habit']);
const MISSION_TYPES = new Set([
  'learn',
  'read',
  'practice',
  'prepare',
  'recover',
  'organize',
  'move',
  'reflect',
  'submit',
  'check',
]);
const ALLOWED_HORIZONS = new Set([7, 14, 30]);
const ROUTINE_UNIT_ALIASES = new Map([
  ['reps', 'reps'],
  ['rep', 'reps'],
  ['repetitions', 'reps'],
  ['повтор', 'reps'],
  ['повтора', 'reps'],
  ['повторов', 'reps'],
  ['повторения', 'reps'],
  ['seconds', 'seconds'],
  ['second', 'seconds'],
  ['sec', 'seconds'],
  ['secs', 'seconds'],
  ['s', 'seconds'],
  ['сек', 'seconds'],
  ['секунда', 'seconds'],
  ['секунды', 'seconds'],
  ['секунд', 'seconds'],
  ['minutes', 'minutes'],
  ['minute', 'minutes'],
  ['min', 'minutes'],
  ['mins', 'minutes'],
  ['мин', 'minutes'],
  ['минута', 'minutes'],
  ['минуты', 'minutes'],
  ['минут', 'minutes'],
  ['pages', 'pages'],
  ['page', 'pages'],
  ['стр', 'pages'],
  ['страница', 'pages'],
  ['страницы', 'pages'],
  ['страниц', 'pages'],
  ['items', 'items'],
  ['item', 'items'],
  ['элемент', 'items'],
  ['элемента', 'items'],
  ['элементов', 'items'],
  ['words', 'words'],
  ['word', 'words'],
  ['слово', 'words'],
  ['слова', 'words'],
  ['слов', 'words'],
  ['meters', 'meters'],
  ['meter', 'meters'],
  ['metres', 'meters'],
  ['metre', 'meters'],
  ['m', 'meters'],
  ['метр', 'meters'],
  ['метра', 'meters'],
  ['метров', 'meters'],
  ['attempts', 'attempts'],
  ['attempt', 'attempts'],
  ['попытка', 'attempts'],
  ['попытки', 'attempts'],
  ['попыток', 'attempts'],
]);

const VAGUE_ONLY_PATTERNS = [
  /^(?:подготовься|сделай разминку|изучи(?: тему| технику)?|поработай над техникой|поработай над дыханием|выполни упражнение|сделай подготовительные упражнения|добавь немного|действуй аккуратно)[.!]?$/iu,
  /^(?:найди|обратись к) (?:инструктору|инструктора|специалисту|специалиста)[.!]?$/iu,
  /^(?:prepare|warm up|study(?: the)? technique|do the exercise|find (?:an? )?(?:coach|specialist)|be careful)[.!]?$/iu,
];
const SOFT_VAGUE_PATTERN =
  /(?:постепенн|понемногу|по самочувствию|в комфортн|подготовься|сделай разминку|изучи технику|поработай над техникой|поработай над дыханием|добавь немного|gradually|comfortable pace)/iu;
const GENERIC_SHORT_ACTION_PATTERN =
  /^(?:дыши|тренируй|потренируй|практикуй|выполни|сделай|подготовься|работай|breathe|train|practice|prepare|do the exercise)(?:\s|[.,!?:;—-]|$)/iu;
const PROGRESSION_BRANCH_PATTERN = /(?:если|if).*(?:если нет|иначе|otherwise|if not)/iu;
const MANUAL_VAGUE_PATTERN =
  /(?:качественн\w*\s+тренировочн\w*\s+сесси|хорош\w*\s+техник|запиши\s+ощущен|проведи\s+тренировочн\w*\s+сесси|quality\s+training\s+session|good\s+technique|record\s+how\s+you\s+feel)/iu;
const MANUAL_ARTIFACT_PATTERN =
  /(?:(?:форм|файл|документ|список|таблиц|черновик|фото|видео|ссылк|письм|сообщени|ответ|звонок|книг|запис|отч[её]т|папк|полк|стол|комнат|зон|form|file|document|list|table|draft|photo|video|link|letter|message|answer|call|book|entry|report|folder).{0,56}(?:записан|написан|создан|сохран|отправ|заполн|разобран|удал|перемещ|собран|прочитан|реш[её]н|заверш|очищ|submitted|written|created|saved|sent|filled|removed|moved|assembled|read|solved|completed|cleared)|(?:записан|написан|создан|сохран|отправ|заполн|разобран|удал|перемещ|собран|прочитан|реш[её]н|заверш|очищ|submitted|written|created|saved|sent|filled|removed|moved|assembled|read|solved|completed|cleared).{0,56}(?:форм|файл|документ|список|таблиц|черновик|фото|видео|ссылк|письм|сообщени|ответ|звонок|книг|запис|отч[её]т|папк|полк|стол|комнат|зон|form|file|document|list|table|draft|photo|video|link|letter|message|answer|call|book|entry|report|folder))/iu;

export function validatePlanActionability(
  plan,
  dailyMinutes,
  horizonDays,
  expectedBaselineStatement,
  expectedTargetTimeline,
  trustedBaseline,
) {
  if (!plan || typeof plan !== 'object') fail('plan', 'план должен быть объектом');
  if (!Number.isInteger(dailyMinutes) || dailyMinutes < 1) {
    fail('dailyMinutes', 'дневной лимит должен быть целым числом минут');
  }
  if (!ALLOWED_HORIZONS.has(horizonDays)) {
    fail('horizonDays', 'горизонт должен быть равен 7, 14 или 30 дням');
  }

  assertString(plan.title, 'title', 3, 120);
  if (!GOAL_DOMAINS.has(plan.domain)) fail('domain', 'неизвестный домен цели');
  assertString(plan.targetMetric, 'targetMetric', 3, 220);
  assertString(plan.targetTimeline, 'targetTimeline', 2, 80);
  if (
    expectedTargetTimeline &&
    plan.targetTimeline.trim() !== expectedTargetTimeline.trim()
  ) {
    fail('targetTimeline', 'срок большой цели пользователя был изменён');
  }
  assertString(plan.summary, 'summary', 10, 600);
  validateBaseline(plan.baseline, expectedBaselineStatement, trustedBaseline);
  assertStringArray(plan.safetyNotes, 'safetyNotes', 0, 4, 3, 300);
  assertStringArray(plan.assumptions, 'assumptions', 1, 6, 3, 300);
  assertStringArray(plan.sourceLabels, 'sourceLabels', 1, 8, 2, 180);
  validatePhases(plan.phases, horizonDays);

  if (!Array.isArray(plan.days) || plan.days.length !== horizonDays) {
    fail('days', `план должен содержать ровно ${horizonDays} календарных дней`);
  }

  let calculatedActionCount = 0;
  plan.days.forEach((day, index) => {
    const path = `days.${index}`;
    assertInteger(day?.dayNumber, `${path}.dayNumber`, 1, horizonDays);
    if (day.dayNumber !== index + 1) {
      fail(`${path}.dayNumber`, `ожидается последовательный день ${index + 1}`);
    }
    const expectedPhaseIndex = phaseIndexForDay(plan.phases, day.dayNumber);
    assertInteger(day.phaseIndex, `${path}.phaseIndex`, 1, 3);
    if (day.phaseIndex !== expectedPhaseIndex) {
      fail(`${path}.phaseIndex`, `день ${day.dayNumber} не входит в указанную фазу`);
    }
    calculatedActionCount += validateDay(day, dailyMinutes, trustedBaseline, path);
  });

  if (
    trustedBaseline &&
    (plan.domain === 'move' || plan.domain === 'practice') &&
    calculatedActionCount < 1
  ) {
    fail('days', 'измеримая двигательная цель не использует baseline ни в одном расчёте');
  }

  return plan;
}

function validateBaseline(baseline, expectedBaselineStatement, trustedBaseline) {
  if (!baseline || typeof baseline !== 'object') fail('baseline', 'не указана исходная точка');
  assertString(baseline.userStatement, 'baseline.userStatement', 2, 500);
  assertString(baseline.normalizedMetric, 'baseline.normalizedMetric', 2, 180);
  assertString(baseline.calculationRule, 'baseline.calculationRule', 8, 360);

  if (
    expectedBaselineStatement &&
    baseline.userStatement.trim() !== expectedBaselineStatement.trim()
  ) {
    fail('baseline.userStatement', 'исходная точка пользователя была изменена');
  }

  if (!trustedBaseline) {
    if (baseline.value !== null || baseline.unit !== null) {
      fail('baseline.value', 'непроверенное числовое значение должно быть null');
    }
    return 0;
  }

  assertFiniteNumber(baseline.value, 'baseline.value', 0, 1_000_000_000);
  assertString(baseline.unit, 'baseline.unit', 1, 40);
  if (!nearlyEqual(baseline.value, trustedBaseline.value)) {
    fail(
      'baseline.value',
      `ожидается локально распознанное значение ${trustedBaseline.value}`,
    );
  }
  if (canonicalRoutineUnit(baseline.unit) !== trustedBaseline.unit) {
    fail('baseline.unit', `ожидается локально распознанная единица ${trustedBaseline.unit}`);
  }
}

function validatePhases(phases, horizonDays) {
  if (!Array.isArray(phases) || phases.length !== 3) {
    fail('phases', 'план должен содержать ровно три последовательные фазы');
  }

  phases.forEach((phase, index) => {
    const path = `phases.${index}`;
    if (!phase || typeof phase !== 'object') fail(path, 'фаза должна быть объектом');
    assertString(phase.title, `${path}.title`, 2, 100);
    assertString(phase.subtitle, `${path}.subtitle`, 2, 180);
    assertInteger(phase.startDay, `${path}.startDay`, 1, horizonDays);
    assertInteger(phase.endDay, `${path}.endDay`, 1, horizonDays);
    if (phase.endDay < phase.startDay) fail(path, 'конец фазы раньше её начала');

    const expectedStart = index === 0 ? 1 : phases[index - 1].endDay + 1;
    if (phase.startDay !== expectedStart) {
      fail(`${path}.startDay`, `ожидается день ${expectedStart} без разрыва или пересечения`);
    }
  });

  if (phases[2].endDay !== horizonDays) {
    fail('phases.2.endDay', `последняя фаза должна завершаться днём ${horizonDays}`);
  }
}

function phaseIndexForDay(phases, dayNumber) {
  const index = phases.findIndex(
    (phase) => dayNumber >= phase.startDay && dayNumber <= phase.endDay,
  );
  return index + 1;
}

function validateDay(day, dailyMinutes, trustedBaseline, path) {
  if (!day || typeof day !== 'object') fail(path, 'день должен быть объектом');
  assertString(day.title, `${path}.title`, 2, 120);
  assertString(day.description, `${path}.description`, 5, 560);
  if (!MISSION_TYPES.has(day.type)) fail(`${path}.type`, 'неизвестный тип миссии');
  assertInteger(day.xp, `${path}.xp`, 5, 60);
  assertString(day.progressionRule, `${path}.progressionRule`, 8, 420);
  const progressionNumbers = day.progressionRule.match(/\d+(?:[.,]\d+)?/gu) ?? [];
  if (
    isVagueOnly(day.progressionRule) ||
    progressionNumbers.length < 2 ||
    !PROGRESSION_BRANCH_PATTERN.test(day.progressionRule)
  ) {
    fail(`${path}.progressionRule`, 'правило не содержит двух точных измеримых веток');
  }
  if (day.warning !== null) assertString(day.warning, `${path}.warning`, 3, 300);
  if (isVagueOnly(day.description)) {
    fail(`${path}.description`, 'описание подменяет действие общей фразой');
  }
  if (!Number.isInteger(day.estimatedMinutes) || day.estimatedMinutes < 1) {
    fail(`${path}.estimatedMinutes`, 'длительность дня должна быть положительным целым числом');
  }
  if (day.estimatedMinutes > dailyMinutes) {
    fail(`${path}.estimatedMinutes`, 'день превышает выбранный дневной лимит');
  }
  if (!Array.isArray(day.steps) || day.steps.length < 1 || day.steps.length > 8) {
    fail(`${path}.steps`, 'день должен содержать от одного до восьми конкретных указаний');
  }
  day.steps.forEach((step, stepIndex) => {
    assertString(step, `${path}.steps.${stepIndex}`, 2, 300);
  });
  if (day.steps.some(isInsufficientlySpecific)) {
    fail(`${path}.steps`, 'день не содержит конкретного указания');
  }

  const execution = day.execution;
  if (!execution || typeof execution !== 'object') {
    fail(`${path}.execution`, 'не указан способ выполнения');
  }
  assertString(execution.successCriterion, `${path}.execution.successCriterion`, 5, 320);

  if (execution.kind === 'manual') {
    if (execution.durationSeconds !== null) {
      fail(`${path}.execution.durationSeconds`, 'для manual ожидается null');
    }
    const manualEvidence = `${day.steps.join(' ')} ${execution.successCriterion}`;
    if (MANUAL_VAGUE_PATTERN.test(manualEvidence) || !MANUAL_ARTIFACT_PATTERN.test(manualEvidence)) {
      fail(
        `${path}.execution.successCriterion`,
        'manual-день не содержит измеримого результата или проверяемого артефакта',
      );
    }
    return 0;
  }

  if (execution.kind === 'timer') {
    assertInteger(execution.durationSeconds, `${path}.execution.durationSeconds`, 1, 7200);
    if (execution.durationSeconds > day.estimatedMinutes * 60) {
      fail(`${path}.execution.durationSeconds`, 'таймер превышает заявленную длительность дня');
    }
    return 0;
  }

  if (execution.kind !== 'routine') {
    fail(`${path}.execution.kind`, 'неизвестный способ выполнения');
  }
  if (!Array.isArray(execution.actions) || execution.actions.length < 1 || execution.actions.length > 10) {
    fail(`${path}.execution.actions`, 'routine должна содержать от одного до десяти действий');
  }

  let knownDurationSeconds = 0;
  let calculatedActionCount = 0;
  execution.actions.forEach((action, actionIndex) => {
    const actionPath = `${path}.execution.actions.${actionIndex}`;
    if (!action || typeof action !== 'object') fail(actionPath, 'действие должно быть объектом');
    assertString(action.title, `${actionPath}.title`, 2, 100);
    assertString(action.instruction, `${actionPath}.instruction`, 8, 360);
    assertString(action.successCriterion, `${actionPath}.successCriterion`, 5, 260);
    if (isInsufficientlySpecific(action.instruction)) {
      fail(`${actionPath}.instruction`, 'инструкция подменена общей фразой');
    }
    assertInteger(action.sets, `${actionPath}.sets`, 1, 20);
    assertFiniteNumber(action.quantity, `${actionPath}.quantity`, 0.01, 1_000_000);
    assertInteger(action.workSecondsPerSet, `${actionPath}.workSecondsPerSet`, 1, 7200);
    if (!ROUTINE_UNITS.has(action.unit)) fail(`${actionPath}.unit`, 'неизвестная единица объёма');
    if (DISCRETE_ROUTINE_UNITS.has(action.unit) && !Number.isInteger(action.quantity)) {
      fail(`${actionPath}.quantity`, `для единицы ${action.unit} ожидается целое число`);
    }
    assertInteger(action.restSeconds, `${actionPath}.restSeconds`, 0, 1800);
    if (action.tempo !== null) assertString(action.tempo, `${actionPath}.tempo`, 2, 100);
    if (action.loadBasis !== null) {
      validateLoadBasis(action, trustedBaseline, actionPath);
      calculatedActionCount += 1;
    }
    if (action.unit === 'custom') {
      assertString(action.unitLabel, `${actionPath}.unitLabel`, 1, 40);
    } else if (action.unitLabel !== null) {
      fail(`${actionPath}.unitLabel`, 'unitLabel допустим только для custom');
    }
    if (
      action.unit === 'seconds' &&
      action.workSecondsPerSet !== Math.max(1, Math.round(action.quantity))
    ) {
      fail(`${actionPath}.workSecondsPerSet`, 'для seconds время подхода должно совпадать с quantity');
    }
    if (
      action.unit === 'minutes' &&
      action.workSecondsPerSet !== Math.max(1, Math.round(action.quantity * 60))
    ) {
      fail(`${actionPath}.workSecondsPerSet`, 'для minutes время подхода должно совпадать с quantity');
    }

    const restPeriods = Math.max(0, action.sets - 1) +
      (actionIndex < execution.actions.length - 1 ? 1 : 0);
    knownDurationSeconds +=
      action.sets * action.workSecondsPerSet + restPeriods * action.restSeconds;
  });

  if (knownDurationSeconds > day.estimatedMinutes * 60) {
    fail(`${path}.execution.actions`, 'известная длительность routine превышает заявленную длительность дня');
  }
  return calculatedActionCount;
}

function validateLoadBasis(action, trustedBaseline, path) {
  const basis = action.loadBasis;
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) {
    fail(`${path}.loadBasis`, 'расчёт нагрузки должен быть объектом');
  }
  assertFiniteNumber(basis.percentage, `${path}.loadBasis.percentage`, 0.01, 1000);
  assertFiniteNumber(basis.baseValue, `${path}.loadBasis.baseValue`, 0, 1_000_000_000);
  assertString(basis.baseUnit, `${path}.loadBasis.baseUnit`, 1, 40);
  assertFiniteNumber(basis.result, `${path}.loadBasis.result`, 0, 1_000_000);

  if (!trustedBaseline) {
    fail(`${path}.loadBasis`, 'процент нельзя считать без локально распознанной исходной величины');
  }
  if (!nearlyEqual(basis.baseValue, trustedBaseline.value)) {
    fail(
      `${path}.loadBasis.baseValue`,
      `ожидается локально распознанное значение ${trustedBaseline.value}`,
    );
  }
  if (canonicalRoutineUnit(basis.baseUnit) !== trustedBaseline.unit) {
    fail(
      `${path}.loadBasis.baseUnit`,
      `ожидается локально распознанная единица ${trustedBaseline.unit}`,
    );
  }
  if (canonicalRoutineUnit(action.unit) !== trustedBaseline.unit) {
    fail(`${path}.unit`, `процент от baseline нельзя записать в единице ${action.unit}`);
  }

  const expectedResult = trustedBaseline.value * basis.percentage / 100;
  const exactOrRounded =
    nearlyEqual(basis.result, expectedResult) ||
    (Number.isInteger(basis.result) && nearlyEqual(basis.result, Math.round(expectedResult)));
  if (!exactOrRounded) {
    fail(
      `${path}.loadBasis.result`,
      `result ${basis.result} не соответствует ${basis.percentage}% от baseline ${trustedBaseline.value}`,
    );
  }
  if (!nearlyEqual(action.quantity, basis.result)) {
    fail(`${path}.quantity`, `quantity ${action.quantity} не совпадает с loadBasis.result ${basis.result}`);
  }
}

function canonicalRoutineUnit(value) {
  if (typeof value !== 'string') return undefined;
  return ROUTINE_UNIT_ALIASES.get(value.trim().toLocaleLowerCase('ru-RU'));
}

function nearlyEqual(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 0.01;
}

function isVagueOnly(value) {
  return typeof value === 'string' && VAGUE_ONLY_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function isInsufficientlySpecific(value) {
  if (typeof value !== 'string') return true;
  const text = value.trim();
  if (isVagueOnly(text)) return true;
  if (SOFT_VAGUE_PATTERN.test(text) && !/\d/u.test(text)) return true;
  return (
    GENERIC_SHORT_ACTION_PATTERN.test(text) &&
    Array.from(text).length < 48 &&
    !/\d/u.test(text)
  );
}

function assertString(value, path, minLength, maxLength = Number.POSITIVE_INFINITY) {
  const length = typeof value === 'string' ? Array.from(value.trim()).length : -1;
  if (length < minLength || length > maxLength) {
    fail(path, `ожидается строка длиной от ${minLength} до ${maxLength} символов`);
  }
}

function assertStringArray(value, path, minimum, maximum, minLength, maxLength) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail(path, `ожидается массив длиной от ${minimum} до ${maximum}`);
  }
  value.forEach((item, index) =>
    assertString(item, `${path}.${index}`, minLength, maxLength),
  );
}

function assertInteger(value, path, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(path, `ожидается целое число от ${minimum} до ${maximum}`);
  }
}

function assertFiniteNumber(value, path, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `ожидается число от ${minimum} до ${maximum}`);
  }
}

function fail(path, message) {
  throw new Error(`${path}: ${message}.`);
}
