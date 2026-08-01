export const PLAN_VALIDATOR_VERSION = 'plan-validator-v5';

const COUNTER_UNITS = new Set([
  'reps',
  'pages',
  'items',
  'words',
  'meters',
  'attempts',
  'custom',
]);
const DISCRETE_COUNTER_UNITS = new Set(['reps', 'pages', 'items', 'words', 'attempts']);
const TEMPORAL_UNITS = new Set(['seconds', 'minutes']);
const TEMPORAL_CUSTOM_UNIT_PATTERN =
  /^(?:ms|milliseconds?|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?|мс|миллисекунд(?:а|ы|у|е|ой|ами|ах)?|с|сек|секунд(?:а|ы|у|е|ой|ами|ах)?|мин|минут(?:а|ы|у|е|ой|ами|ах)?|ч|час(?:а|у|е|ом|ы|ов|ами|ах)?|день|дня|дней|недел(?:я|и|ю|е|ей|ями|ях)|месяц(?:а|у|е|ем|ы|ев|ами|ах)?|год(?:а|у|е|ом|ы|ов|ами|ах)?|лет)$/iu;
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
const UNIT_ALIASES = new Map([
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

const PLAN_KEYS = [
  'title',
  'domain',
  'targetMetric',
  'targetTimeline',
  'summary',
  'baseline',
  'safetyNotes',
  'assumptions',
  'sourceLabels',
  'phases',
  'days',
];
const BASELINE_KEYS = ['userStatement', 'normalizedMetric', 'value', 'unit', 'calculationRule'];
const PHASE_KEYS = ['title', 'subtitle', 'startDay', 'endDay'];
const DAY_KEYS = [
  'dayNumber',
  'phaseIndex',
  'title',
  'description',
  'type',
  'estimatedMinutes',
  'xp',
  'execution',
  'warning',
];
const EXECUTION_KEYS = ['kind', 'blocks', 'successCriterion'];
const TIMER_BLOCK_KEYS = [
  'kind',
  'title',
  'instruction',
  'sets',
  'durationSecondsPerSet',
  'restSeconds',
  'loadBasis',
  'successCriterion',
];
const COUNTER_BLOCK_KEYS = [
  'kind',
  'title',
  'instruction',
  'sets',
  'targetPerSet',
  'unit',
  'unitLabel',
  'workSecondsPerSet',
  'restSeconds',
  'tempo',
  'loadBasis',
  'successCriterion',
];
const CHECKLIST_BLOCK_KEYS = ['kind', 'title', 'items', 'estimatedSeconds', 'successCriterion'];
const TEXT_LOG_BLOCK_KEYS = [
  'kind',
  'title',
  'prompt',
  'minCharacters',
  'maxCharacters',
  'estimatedSeconds',
  'successCriterion',
];
const LOAD_BASIS_KEYS = ['percentage', 'baseValue', 'baseUnit', 'result'];

const VAGUE_ONLY_PATTERNS = [
  /^(?:подготовься|сделай разминку|изучи(?: тему| технику)?|поработай над техникой|поработай над дыханием|выполни упражнение|сделай подготовительные упражнения|добавь немного|действуй аккуратно)[.!]?$/iu,
  /^(?:prepare|warm up|study(?: the)? technique|do the exercise|be careful)[.!]?$/iu,
];
const SOFT_VAGUE_PATTERN =
  /(?:постепенн|понемногу|по самочувствию|в комфортн|подготовься|сделай разминку|изучи технику|поработай над техникой|поработай над дыханием|добавь немного|gradually|comfortable pace)/iu;
const GENERIC_SHORT_ACTION_PATTERN =
  /^(?:дыши|тренируй|потренируй|практикуй|выполни|сделай|подготовься|работай|breathe|train|practice|prepare|do the exercise)(?:\s|[.,!?:;—-]|$)/iu;
const DELEGATED_WORK_PATTERNS = [
  /\b(?:calculate|compute)\b/iu,
  /(?:рассчитай|вычисли|посчитай|реши\s+сам|определи\s+сам)/iu,
  /\b(?:choose|pick|select|decide)\b.{0,64}\b(?:exercise|activity|duration|sets?|percentage|load|rest|tempo|method|task|protocol)\b/iu,
  /(?:выбер|подбер)\w*.{0,64}(?:упражнен|активност|длительност|подход|процент|нагруз|отдых|темп|метод|задан|протокол)\w*/iu,
];

const OFF_APP_PATTERNS = [
  /\b(?:google\s+(?:docs?|sheets?|calendar|keep)|apple\s+notes|notion|evernote|onenote)\b/iu,
  /\b(?:notebooks?|notes?|files?|documents?|sheets?|spreadsheets?|trackers?)\b/iu,
  /(?:блокнот|тетрад|заметк|файл|документ|таблиц|трекер)\w*/iu,
  /\b(?:add|write|record|log|mark|save|schedule|put|open|use|update)\b.{0,40}\b(?:a\s+|the\s+|your\s+)?calendars?\b/iu,
  /(?:добав|запиш|записыв|фиксир|отмет|сохран|распис|помест|открой|использ|обнов)\w*.{0,40}(?:календарь|календаря|календарю|календаре|календарём|календари|календарей|календарям|календарями|календарях)(?![\p{L}\p{M}])/iu,
  /(?:на|в|открой|заполни|используй)\s+(?:бумажн[\p{L}\p{M}]*\s+)?лист(?:е|у|ом|а)?(?:\s|[.,!?:;—-]|$)/iu,
  /\b(?:other|another|external|third[- ]party)\s+apps?\b/iu,
  /(?:друг|сторонн|внешн)[\p{L}\p{M}]*\s+приложен\w*/iu,
  /\b(?:fill|complete|open|submit|save|send|upload|use)\b.{0,40}\b(?:forms?|questionnaires?)\b/iu,
  /(?:заполн|открой|открыть|отправ|загруз|сохран|использ)\w*.{0,40}(?:форм|анкет)\w*/iu,
  /(?:форм(?:а|у|е|ой|ы)|анкет\w*)\s+(?:отч[её]та|ответа|регистрации)/iu,
  /\b(?:upload|email)\b/iu,
  /(?:загруз|выгруз)\w*/iu,
  /\b(?:send)\b.{0,48}\b(?:emails?|messages?|files?|documents?|attachments?)\b/iu,
  /(?:отправ)\w*.{0,48}(?:письм|сообщен|файл|документ|вложен|email|e-mail|имейл|электронн[\p{L}\p{M}]*\s+почт)\w*/iu,
  /\b(?:call|write(?:\s+to)?|contact|visit|find|message|send|meet|ask|talk\s+to)\b.{0,64}\b(?:coaches?|trainers?|instructors?|specialists?|friends?|people|persons?|doctors?|experts?)\b/iu,
  /(?:позвон|напиш|пиш|свяж|контакт|обрат|посет|найд|отыщ|отправ|встрет|спрос)\w*.{0,64}(?:тренер|коуч|инструктор|специалист|друг|человек|персон|врач|доктор|эксперт)\w*/iu,
  /\b(?:phones?|smartphones?|smartwatches?|wristwatches?|stopwatches?|alarms?|clickers?|external\s+timers?|separate\s+timers?|external\s+counters?|separate\s+counters?)\b/iu,
  /(?:телефон|смартфон|секундомер|будильник|кликер|наручн[\p{L}\p{M}]*\s+час|внешн[\p{L}\p{M}]*\s+(?:таймер|сч[её]тчик)|отдельн[\p{L}\p{M}]*\s+(?:таймер|сч[её]тчик))\w*/iu,
  /\b(?:use|check|open|start|set|keep|hold|look at)\b.{0,24}\b(?:a\s+|the\s+|your\s+)?(?:watch|counter)\b/iu,
  /(?:использ|проверь|открой|запусти|установ|смотри|держ)\w*.{0,32}(?:наручн\w*\s+час|час(?:ы|ах)|сч[её]тчик)\w*/iu,
  /\b(?:record|log|track|write)\b.{0,64}\b(?:elsewhere|externally|outside\s+(?:of\s+)?(?:actum|the\s+app)|in\s+(?:another|a\s+separate)\s+(?:app|place))\b/iu,
  /(?:запиш|записыв|фиксир|отслеж|вести\s+уч[её]т)\w*.{0,64}(?:вне\s+Actum|за\s+пределами\s+Actum|в\s+другом\s+месте|в\s+другом\s+приложении|отдельно)/iu,
  /\b(?:browse|search|google|open|visit)\b.{0,48}\b(?:the\s+)?(?:web|internet|website|url|link)\b/iu,
  /(?:ищи|найди|открой|перейди|посети)\w*.{0,48}(?:интернет|сайт|веб|url|ссылк)\w*/iu,
  /\b(?:find|search(?:\s+for)?|look\s+up)\b.{0,48}\b(?:instructions?|exercises?|techniques?|methods?|protocols?|tutorials?)\b/iu,
  /(?:ищи|поищи|найди)\w*.{0,48}(?:инструкц|упражнен|техник|метод|протокол|руководств)\w*/iu,
  /\b(?:watch|open)\b.{0,40}\b(?:videos?|tutorials?)\b/iu,
  /(?:посмотр|открой)\w*.{0,40}(?:видео|ролик|урок|туториал)\w*/iu,
];
const EXTERNAL_TEXT_LOG_NOTE_PATTERNS = [
  /\bnotes?\s+apps?\b/iu,
  /\bapple\s+notes\b/iu,
  /(?:приложен[\p{L}\p{M}]*\s+(?:для\s+)?заметок|заметк[\p{L}\p{M}]*\s+в\s+приложении)/iu,
  /\b(?:save|write|record|log)\b.{0,64}\bnotes?\b.{0,64}\b(?:elsewhere|externally|outside|another\s+app)\b/iu,
  /(?:сохран|запиш|фиксир)\w*.{0,64}заметк[\p{L}\p{M}]*.{0,64}(?:вне\s+Actum|в\s+другом\s+месте|в\s+другом\s+приложении|отдельно)/iu,
];
const EMBEDDED_TIME_QUANTITY_PATTERN =
  /(?:^|[^\p{L}\p{N}])(?:\d+(?:[.,]\d+)?\s*(?:[-–—]\s*)?(?:milliseconds?|msecs?|ms|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|мс|миллисекунд\p{L}*|сек(?:унд\p{L}*)?|мин(?:ут\p{L}*)?|час\p{L}*|дн(?:я|ей)?|день|недел\p{L}*|месяц\p{L}*|год\p{L}*|лет)|\d{1,3}:\d{2})(?=$|[^\p{L}\p{N}])/iu;

export function validatePlanActionability(
  plan,
  dailyMinutes,
  horizonDays,
  expectedBaselineStatement,
  expectedTargetTimeline,
  trustedBaseline,
) {
  assertExactObject(plan, 'plan', PLAN_KEYS);
  if (!Number.isInteger(dailyMinutes) || dailyMinutes < 1) {
    fail('dailyMinutes', 'дневной лимит должен быть целым числом минут');
  }
  if (!ALLOWED_HORIZONS.has(horizonDays)) {
    fail('horizonDays', 'горизонт должен быть равен 7, 14 или 30 дням');
  }

  assertString(plan.title, 'title', 3, 120);
  assertGeneratedText(plan.title, 'title');
  if (!GOAL_DOMAINS.has(plan.domain)) fail('domain', 'неизвестный домен цели');
  assertString(plan.targetMetric, 'targetMetric', 3, 220);
  assertGeneratedText(plan.targetMetric, 'targetMetric');
  assertString(plan.targetTimeline, 'targetTimeline', 2, 80);
  if (
    expectedTargetTimeline &&
    plan.targetTimeline.trim() !== expectedTargetTimeline.trim()
  ) {
    fail('targetTimeline', 'срок большой цели пользователя был изменён');
  }
  assertString(plan.summary, 'summary', 10, 600);
  assertGeneratedText(plan.summary, 'summary');
  validateBaseline(plan.baseline, expectedBaselineStatement, trustedBaseline);
  assertStringArray(plan.safetyNotes, 'safetyNotes', 0, 4, 3, 300);
  assertStringArray(plan.assumptions, 'assumptions', 1, 6, 3, 300);
  plan.safetyNotes.forEach((note, index) =>
    assertGeneratedText(note, `safetyNotes.${index}`),
  );
  plan.assumptions.forEach((assumption, index) =>
    assertGeneratedText(assumption, `assumptions.${index}`),
  );
  assertStringArray(plan.sourceLabels, 'sourceLabels', 1, 8, 2, 180);
  validatePhases(plan.phases, horizonDays);

  if (!Array.isArray(plan.days) || plan.days.length !== horizonDays) {
    fail('days', `план должен содержать ровно ${horizonDays} календарных дней`);
  }

  let loadLinkedBlockCount = 0;
  plan.days.forEach((day, index) => {
    const path = `days.${index}`;
    assertExactObject(day, path, DAY_KEYS);
    assertInteger(day.dayNumber, `${path}.dayNumber`, 1, horizonDays);
    if (day.dayNumber !== index + 1) {
      fail(`${path}.dayNumber`, `ожидается последовательный день ${index + 1}`);
    }
    const expectedPhaseIndex = phaseIndexForDay(plan.phases, day.dayNumber);
    assertInteger(day.phaseIndex, `${path}.phaseIndex`, 1, 3);
    if (day.phaseIndex !== expectedPhaseIndex) {
      fail(`${path}.phaseIndex`, `день ${day.dayNumber} не входит в указанную фазу`);
    }
    loadLinkedBlockCount += validateDay(day, dailyMinutes, trustedBaseline, path);
  });

  if (
    trustedBaseline &&
    (plan.domain === 'move' || plan.domain === 'practice') &&
    loadLinkedBlockCount < 1
  ) {
    fail('days', 'измеримая двигательная цель не использует baseline ни в одном расчёте');
  }

  return plan;
}

function validateBaseline(baseline, expectedBaselineStatement, trustedBaseline) {
  assertExactObject(baseline, 'baseline', BASELINE_KEYS);
  assertString(baseline.userStatement, 'baseline.userStatement', 2, 500);
  assertString(baseline.normalizedMetric, 'baseline.normalizedMetric', 2, 180);
  assertGeneratedText(baseline.normalizedMetric, 'baseline.normalizedMetric');
  assertString(baseline.calculationRule, 'baseline.calculationRule', 8, 360);
  assertGeneratedText(baseline.calculationRule, 'baseline.calculationRule');

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
    return;
  }

  assertFiniteNumber(baseline.value, 'baseline.value', 0, 1_000_000_000);
  assertString(baseline.unit, 'baseline.unit', 1, 40);
  if (!nearlyEqual(baseline.value, trustedBaseline.value)) {
    fail(
      'baseline.value',
      `ожидается локально распознанное значение ${trustedBaseline.value}`,
    );
  }
  if (canonicalUnit(baseline.unit) !== canonicalUnit(trustedBaseline.unit)) {
    fail('baseline.unit', `ожидается локально распознанная единица ${trustedBaseline.unit}`);
  }
}

function validatePhases(phases, horizonDays) {
  if (!Array.isArray(phases) || phases.length !== 3) {
    fail('phases', 'план должен содержать ровно три последовательные фазы');
  }

  phases.forEach((phase, index) => {
    const path = `phases.${index}`;
    assertExactObject(phase, path, PHASE_KEYS);
    assertString(phase.title, `${path}.title`, 2, 100);
    assertGeneratedText(phase.title, `${path}.title`);
    assertString(phase.subtitle, `${path}.subtitle`, 2, 180);
    assertGeneratedText(phase.subtitle, `${path}.subtitle`);
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
  assertString(day.title, `${path}.title`, 2, 120);
  assertGeneratedText(day.title, `${path}.title`);
  assertString(day.description, `${path}.description`, 5, 560);
  assertGeneratedText(day.description, `${path}.description`);
  if (!MISSION_TYPES.has(day.type)) fail(`${path}.type`, 'неизвестный тип миссии');
  assertInteger(day.xp, `${path}.xp`, 5, 60);
  if (day.warning !== null) {
    assertString(day.warning, `${path}.warning`, 3, 300);
    assertGeneratedText(day.warning, `${path}.warning`);
  }
  assertInteger(day.estimatedMinutes, `${path}.estimatedMinutes`, 1, 120);
  if (day.estimatedMinutes > dailyMinutes) {
    fail(`${path}.estimatedMinutes`, 'день превышает выбранный дневной лимит');
  }

  const execution = day.execution;
  assertExactObject(execution, `${path}.execution`, EXECUTION_KEYS);
  if (execution.kind !== 'in_app') {
    fail(`${path}.execution.kind`, 'для plan-v5 ожидается только in_app');
  }
  assertString(execution.successCriterion, `${path}.execution.successCriterion`, 5, 320);
  assertGeneratedText(execution.successCriterion, `${path}.execution.successCriterion`);
  assertNoEmbeddedTimeQuantity(
    execution.successCriterion,
    `${path}.execution.successCriterion`,
  );
  if (!Array.isArray(execution.blocks) || execution.blocks.length < 1 || execution.blocks.length > 12) {
    fail(`${path}.execution.blocks`, 'in_app должна содержать от одного до двенадцати блоков');
  }

  let knownDurationSeconds = 0;
  let loadLinkedBlockCount = 0;
  execution.blocks.forEach((block, blockIndex) => {
    const blockPath = `${path}.execution.blocks.${blockIndex}`;
    const result = validateBlock(block, trustedBaseline, blockPath);
    knownDurationSeconds += result.durationSeconds;
    loadLinkedBlockCount += result.loadLinked ? 1 : 0;
  });

  if (knownDurationSeconds > day.estimatedMinutes * 60) {
    fail(
      `${path}.execution.blocks`,
      'известная длительность блоков превышает заявленную длительность дня',
    );
  }
  return loadLinkedBlockCount;
}

function validateBlock(block, trustedBaseline, path) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    fail(path, 'блок должен быть объектом');
  }

  if (block.kind === 'timer') return validateTimerBlock(block, trustedBaseline, path);
  if (block.kind === 'counter') return validateCounterBlock(block, trustedBaseline, path);
  if (block.kind === 'checklist') return validateChecklistBlock(block, path);
  if (block.kind === 'text_log') return validateTextLogBlock(block, path);
  fail(`${path}.kind`, 'неизвестный вид in_app-блока');
}

function validateTimerBlock(block, trustedBaseline, path) {
  assertExactObject(block, path, TIMER_BLOCK_KEYS);
  validateCommonBlockText(block, path, true);
  assertInteger(block.sets, `${path}.sets`, 1, 20);
  assertInteger(block.durationSecondsPerSet, `${path}.durationSecondsPerSet`, 1, 7200);
  assertInteger(block.restSeconds, `${path}.restSeconds`, 0, 1800);
  if (block.loadBasis !== null) {
    validateLoadBasis(
      block.loadBasis,
      trustedBaseline,
      'seconds',
      block.durationSecondsPerSet,
      path,
    );
  }
  return {
    durationSeconds:
      block.sets * block.durationSecondsPerSet + Math.max(0, block.sets - 1) * block.restSeconds,
    loadLinked: block.loadBasis !== null,
  };
}

function validateCounterBlock(block, trustedBaseline, path) {
  assertExactObject(block, path, COUNTER_BLOCK_KEYS);
  validateCommonBlockText(block, path, true);
  assertInteger(block.sets, `${path}.sets`, 1, 20);
  assertFiniteNumber(block.targetPerSet, `${path}.targetPerSet`, 0.01, 1_000_000);
  if (!COUNTER_UNITS.has(block.unit)) fail(`${path}.unit`, 'неизвестная единица счётчика');
  if (DISCRETE_COUNTER_UNITS.has(block.unit) && !Number.isInteger(block.targetPerSet)) {
    fail(`${path}.targetPerSet`, `для единицы ${block.unit} ожидается целое число`);
  }
  if (block.unit === 'custom') {
    assertString(block.unitLabel, `${path}.unitLabel`, 1, 40);
    if (isTemporalUnitLabel(block.unitLabel)) {
      fail(`${path}.unitLabel`, 'временная единица должна использовать timer, а не counter');
    }
  } else if (block.unitLabel !== null) {
    fail(`${path}.unitLabel`, 'unitLabel допустим только для custom');
  }
  assertInteger(block.workSecondsPerSet, `${path}.workSecondsPerSet`, 1, 7200);
  assertInteger(block.restSeconds, `${path}.restSeconds`, 0, 1800);
  if (block.tempo !== null) {
    assertString(block.tempo, `${path}.tempo`, 2, 100);
    assertGeneratedText(block.tempo, `${path}.tempo`);
    assertNoEmbeddedTimeQuantity(block.tempo, `${path}.tempo`);
  }
  if (block.loadBasis !== null) {
    const targetUnit = block.unit === 'custom' ? block.unitLabel : block.unit;
    validateLoadBasis(
      block.loadBasis,
      trustedBaseline,
      targetUnit,
      block.targetPerSet,
      path,
    );
  }
  return {
    durationSeconds:
      block.sets * block.workSecondsPerSet + Math.max(0, block.sets - 1) * block.restSeconds,
    loadLinked: block.loadBasis !== null,
  };
}

function validateChecklistBlock(block, path) {
  assertExactObject(block, path, CHECKLIST_BLOCK_KEYS);
  validateCommonBlockText(block, path, false);
  if (!Array.isArray(block.items) || block.items.length < 1 || block.items.length > 8) {
    fail(`${path}.items`, 'checklist должен содержать от одного до восьми пунктов');
  }
  block.items.forEach((item, index) => {
    const itemPath = `${path}.items.${index}`;
    assertString(item, itemPath, 2, 260);
    assertGeneratedText(item, itemPath);
    assertNoEmbeddedTimeQuantity(item, itemPath);
    if (isInsufficientlySpecific(item)) {
      fail(itemPath, 'пункт checklist подменён общей фразой');
    }
  });
  assertInteger(block.estimatedSeconds, `${path}.estimatedSeconds`, 1, 7200);
  return { durationSeconds: block.estimatedSeconds, loadLinked: false };
}

function validateTextLogBlock(block, path) {
  assertExactObject(block, path, TEXT_LOG_BLOCK_KEYS);
  validateCommonBlockText(block, path, false, true);
  assertString(block.prompt, `${path}.prompt`, 5, 360);
  assertGeneratedText(block.prompt, `${path}.prompt`, true);
  assertNoEmbeddedTimeQuantity(block.prompt, `${path}.prompt`);
  assertInteger(block.minCharacters, `${path}.minCharacters`, 1, 2000);
  assertInteger(block.maxCharacters, `${path}.maxCharacters`, 1, 4000);
  if (block.maxCharacters < block.minCharacters) {
    fail(`${path}.maxCharacters`, 'maxCharacters должен быть не меньше minCharacters');
  }
  assertInteger(block.estimatedSeconds, `${path}.estimatedSeconds`, 1, 7200);
  return { durationSeconds: block.estimatedSeconds, loadLinked: false };
}

function validateCommonBlockText(block, path, hasInstruction, isInAppTextLog = false) {
  assertString(block.title, `${path}.title`, 2, 100);
  assertGeneratedText(block.title, `${path}.title`, isInAppTextLog);
  assertNoEmbeddedTimeQuantity(block.title, `${path}.title`);
  assertString(block.successCriterion, `${path}.successCriterion`, 5, 260);
  assertGeneratedText(block.successCriterion, `${path}.successCriterion`, isInAppTextLog);
  assertNoEmbeddedTimeQuantity(block.successCriterion, `${path}.successCriterion`);
  if (!hasInstruction) return;

  assertString(block.instruction, `${path}.instruction`, 8, 360);
  assertGeneratedText(block.instruction, `${path}.instruction`);
  assertNoEmbeddedTimeQuantity(block.instruction, `${path}.instruction`);
  if (isInsufficientlySpecific(block.instruction)) {
    fail(`${path}.instruction`, 'инструкция подменена общей фразой');
  }
}

function assertNoEmbeddedTimeQuantity(value, path) {
  if (typeof value === 'string' && EMBEDDED_TIME_QUANTITY_PATTERN.test(value)) {
    fail(
      path,
      'временная нагрузка должна быть структурным полем встроенного timer/counter, а не свободным текстом',
    );
  }
}

function validateLoadBasis(basis, trustedBaseline, targetUnit, targetValue, path) {
  assertExactObject(basis, `${path}.loadBasis`, LOAD_BASIS_KEYS);
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
  const trustedUnit = canonicalUnit(trustedBaseline.unit);
  if (canonicalUnit(basis.baseUnit) !== trustedUnit) {
    fail(
      `${path}.loadBasis.baseUnit`,
      `ожидается локально распознанная единица ${trustedBaseline.unit}`,
    );
  }
  if (canonicalUnit(targetUnit) !== trustedUnit) {
    fail(`${path}.kind`, `процент от baseline нельзя записать в единице ${targetUnit}`);
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
  if (targetValue !== basis.result) {
    const targetName = targetUnit === 'seconds' ? 'durationSecondsPerSet' : 'targetPerSet';
    fail(
      `${path}.${targetName}`,
      `${targetName} ${targetValue} не совпадает с loadBasis.result ${basis.result}`,
    );
  }
}

function canonicalUnit(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLocaleLowerCase('ru-RU');
  return UNIT_ALIASES.get(normalized) ?? normalized;
}

function isTemporalUnitLabel(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLocaleLowerCase('ru-RU');
  return TEMPORAL_UNITS.has(canonicalUnit(normalized)) || TEMPORAL_CUSTOM_UNIT_PATTERN.test(normalized);
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

function assertGeneratedText(value, path, isInAppTextLog = false) {
  if (typeof value !== 'string') return;
  if (DELEGATED_WORK_PATTERNS.some((pattern) => pattern.test(value))) {
    fail(path, 'пользователь не должен сам выбирать или рассчитывать действие');
  }
  let dependencyText = value
    .replace(/\b(?:actum|in[- ]app|built[- ]in)\s+counters?\b/giu, '')
    .replace(/\b(?:actum|in[- ]app|built[- ]in)\s+(?:calendars?|journals?|logs?|notes?|timers?|checklists?)\b/giu, '')
    .replace(/\b(?:calendars?|journals?|logs?|notes?|timers?|checklists?)\s+(?:in\s+)?Actum\b/giu, '')
    .replace(/(?:встроенн[\p{L}\p{M}]*\s+сч[её]тчик|сч[её]тчик\s+Actum)/giu, '')
    .replace(/(?:встроенн[\p{L}\p{M}]*\s+(?:календар|журнал|таймер|чек-лист|заметк)[\p{L}\p{M}-]*|(?:календар|журнал|таймер|чек-лист|заметк)[\p{L}\p{M}-]*\s+Actum)/giu, '');
  if (isInAppTextLog) {
    if (EXTERNAL_TEXT_LOG_NOTE_PATTERNS.some((pattern) => pattern.test(value))) {
      fail(path, 'обнаружена внешняя зависимость: действие должно выполняться внутри Actum');
    }
    dependencyText = dependencyText
      .replace(/\bnotes?\b/giu, '')
      .replace(/заметк[\p{L}\p{M}]*/giu, '');
  }
  if (OFF_APP_PATTERNS.some((pattern) => pattern.test(dependencyText))) {
    fail(path, 'обнаружена внешняя зависимость: действие должно выполняться внутри Actum');
  }
}

function assertExactObject(value, path, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'ожидается объект');
  }
  const expected = new Set(expectedKeys);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'обязательное поле отсутствует');
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail(`${path}.${key}`, 'поле не поддерживается контрактом plan-v5');
  }
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
