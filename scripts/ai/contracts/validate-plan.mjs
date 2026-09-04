import { CYCLE_DAYS, programDurationConfig } from './program-duration.mjs';

export const PLAN_VALIDATOR_VERSION = 'plan-validator-v9';

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
  'duration',
  'totalCycles',
  'cycleNumber',
  'targetCycleNumber',
  'target',
  'cycleGoal',
  'roadmap',
  'assessment',
  'summary',
  'baseline',
  'safetyNotes',
  'assumptions',
  'sourceLabels',
  'phases',
  'days',
];
const BASELINE_KEYS = ['userStatement', 'normalizedMetric', 'value', 'unit', 'calculationRule'];
const TARGET_KEYS = ['userStatement', 'normalizedMetric', 'value', 'unit'];
const ROADMAP_KEYS = ['cycleNumber', 'title', 'focus', 'targetValue', 'targetUnit'];
const ASSESSMENT_KEYS = ['dayNumber', 'blockIndex', 'metric', 'targetValue', 'targetUnit'];
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
const EXECUTION_KEYS = ['kind', 'blocks', 'primaryBlockIndex', 'successCriterion'];
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
  /(?:блокнот|тетрад|заметк|файл|документ|трекер)\w*/iu,
  /(?:заполн|открой|открыть|запиш|записыв|фиксир|отмет|сохран|отправ|загруз|использ|обнов)\w*.{0,40}таблиц\w*/iu,
  /\b(?:add|write|record|log|mark|save|schedule|put|open|use|update)\b.{0,40}\b(?:a\s+|the\s+|your\s+)?calendars?\b/iu,
  /(?:добав|запиш|записыв|фиксир|отмет|сохран|распис|помест|открой|использ|обнов)\w*.{0,40}(?:календарь|календаря|календарю|календаре|календарём|календари|календарей|календарям|календарями|календарях)(?![\p{L}\p{M}])/iu,
  /(?:на|в|открой|заполни|используй)\s+(?:бумажн[\p{L}\p{M}]*\s+)?лист(?:е|у|ом|а)?(?:\s|[.,!?:;—-]|$)/iu,
  /\b(?:other|another|external|third[- ]party)\s+apps?\b/iu,
  /(?:друг|сторонн|внешн)[\p{L}\p{M}]*\s+приложен\w*/iu,
  /\b(?:fill|open|submit|save|send|upload)\b.{0,40}\b(?:forms?|questionnaires?)\b/iu,
  /(?:заполн|открой|открыть|отправ|загруз)\w*.{0,40}(?:форм|анкет)\w*/iu,
  /(?:форм(?:а|у|е|ой|ы)|анкет\w*)\s+(?:отч[её]та|ответа|регистрации)/iu,
  /\b(?:upload|email)\b/iu,
  /(?:загруз|выгруз)\w*/iu,
  /\b(?:send)\b.{0,48}\b(?:emails?|messages?|files?|documents?|attachments?)\b/iu,
  /(?:отправ)\w*.{0,48}(?:письм|сообщен|файл|документ|вложен|email|e-mail|имейл|электронн[\p{L}\p{M}]*\s+почт)\w*/iu,
  /\b(?:call|write\s+to|contact|visit|find|message|send|meet|ask|talk\s+to)\b.{0,64}\b(?:coaches?|trainers?|instructors?|specialists?|friends?|people|persons?|doctors?|experts?)\b/iu,
  /(?:позвон|свяж|контакт|обрат|посет|найд|отыщ|отправ|встрет|спрос)\w*.{0,64}(?:тренер|коуч|инструктор|специалист|друг|человек|персон|врач|доктор|эксперт)\w*/iu,
  /(?:напиш|пиш)\w*.{0,8}(?:тренер|коуч|инструктор|специалист|друг|человек|персон|врач|доктор|эксперт)\w*/iu,
  /(?:напиш|пиш)\w*.{0,48}(?:сообщен|письм)\w*.{0,32}(?:тренер|коуч|инструктор|специалист|друг|человек|персон|врач|доктор|эксперт)\w*/iu,
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
const SAFETY_PROHIBITION_PATTERN =
  /(?:\b(?:do not|don't|never|avoid|must not|should not|without)\b|(?:не\s+(?:добав|использ|отправ|заполня|открыва|запуска|выполня|дела|обращ|посещ|ищ)\w*|нельзя|запрещ\w*|избег\w*|без\s+(?:внешн|друг|сторонн)\w*))/iu;
const SAFETY_CONDITIONAL_RISK_PATTERN =
  /(?:(?:\b(?:if|when|in case)\b|если|в\s+случае).{0,180}(?:pain|symptom|dizz|nause|seiz|loss|worsen|боль|симптом|дискомфорт|головокруж|тошнот|судорог|потер|ухудш)|при\s+(?:(?:появлен|возникновен|ухудшен)\w*.{0,48})?(?:бол|симптом|дискомфорт|головокруж|тошнот|судорог|потер)\w*)/iu;
const EXPLICIT_NO_PRACTICE_PATTERN =
  /(?:\b(?:without|no)\s+(?:holds?|practice|training)\b|\b(?:do\s+not|don't|never)\s+hold\s+(?:(?:your|the)\s+)?breath\b|(?:без|нет)\s+(?:задерж|упражнен|трениров|практик)[\p{L}\p{M}]*|не\s+(?:задерж|удерж)[\p{L}\p{M}]*\s+(?:(?:сво|ваш)[\p{L}\p{M}]*\s+)?дыхани[\p{L}\p{M}]*|не\s+выполня[\p{L}\p{M}]*\s+(?:задерж|упражнен|трениров|практик)[\p{L}\p{M}]*)/iu;
const ORDINARY_BREATHING_PATTERN =
  /(?:\b(?:normal\s+breathing|breathe\s+normally|ordinary\s+breathing)\b|(?:обычн|естественн|спокойн)[\p{L}\p{M}]*\s+дыхани[\p{L}\p{M}]*)/iu;
const BREATH_HOLD_ACTION_PATTERN =
  /(?:\b(?:hold(?:ing)?\s+(?:(?:your|the|my)\s+)?breath|breath[- ]hold(?:ing)?s?)\b|(?:задерж|удерж)[\p{L}\p{M}]*\s+(?:(?:сво|ваш)[\p{L}\p{M}]*\s+)?дыхани[\p{L}\p{M}]*|дыхани[\p{L}\p{M}]*\s+(?:задерж|удерж)[\p{L}\p{M}]*)/iu;
const BREATH_HOLD_INSTRUCTION_ACTION_PATTERN =
  /(?:\b(?:hold|keep\s+holding)\s+(?:(?:your|the)\s+)?breath\b|\b(?:perform|do|start)\s+(?:a\s+)?breath[- ]hold\b|(?:задерж(?:и|ивай|ивайте|ите)|удерж(?:и|ивай|ивайте|ите))\s+(?:(?:сво|ваш)[\p{L}\p{M}]*\s+)?дыхани[\p{L}\p{M}]*|(?:выполни|выполняй|выполняйте|сделай|сделайте|начни|начните)\s+(?:сух[\p{L}\p{M}]*\s+)?задержк[\p{L}\p{M}]*\s+дыхани[\p{L}\p{M}]*)/iu;
const BREATHING_GOAL_PATTERN = /(?:\bbreath(?:e|ing)?\b|дыш|дыхани)/iu;
const PASSIVE_ONLY_PRIMARY_PATTERN =
  /(?:\b(?:lie|lay)\s+down\b|\b(?:sit|stand|stay)\s+still\b|\b(?:stare|look)\s+(?:at|into)\b|\b(?:relax|rest|wait)\b|(?:ляг|лежи|сядь|сиди|стой|оставайся)\s+(?:неподвижн|спокойн|на\s+(?:спин|пол))|(?:смотри|гляди)\s+в\s+(?:одну\s+)?точк|расслаб|отдыхай|жди\b)/iu;
const AFFIRMATIVE_ACTIVE_PRIMARY_PATTERN =
  /(?:\b(?:perform|do|start|hold|raise|lower|lift|read|write|draw|speak|repeat|walk|run|swim|press|pull|push|squeeze|breathe)\b|(?:выполн|сдел|делай|начн|подним|опуск|сгиб|разгиб|читай|пиш|рисуй|говор|произнос|повтор|шагай|бег|иди|ход|плыв|нажим|тяни|толкай|сжим|держи|удерж|задерж|дыши)[\p{L}\p{M}]*|сохраняй\s+(?:ровн[\p{L}\p{M}]*\s+)?дыхани[\p{L}\p{M}]*)/iu;
const PASSIVE_PRACTICE_GOAL_PATTERN =
  /(?:\b(?:meditat|mindful|relaxation|stillness)\w*\b|(?:медит|осознанн|релаксац|расслаб(?:иться|ляться)|неподвижност|концентрир|удерживать\s+внимани)[\p{L}\p{M}]*)/iu;
const SAFETY_ONLY_ITEM_PATTERN =
  /(?:безопасн|медицин|врач|доктор|инструктор|противопоказ|головокруж|тошнот|боль|судорог|потер[\p{L}]*\s+сознани|одышк|симптом|самочувств|гипервентил|(?:без|нет)\s+(?:воды|ванн|задерж|упражнен|трениров|практик)[\p{L}\p{M}]*|практик[\p{L}\p{M}]*.{0,32}на\s+суше|только\s+на\s+суше|(?:устойчив[\p{L}]*.{0,20}положени|положени[\p{L}]*.{0,20}устойчив)|(?:обычн|спокойн)[\p{L}]*\s+дыхани|(?:непрерывн[\p{L}]*.{0,20}дыхани|дыхани[\p{L}]*.{0,20}непрерывн)|dizz|nause|pain|seiz|symptom|hypervent|underwater|dry\s+only|normal\s+breathing|without\s+holds?)/iu;
const SYMPTOM_JOURNAL_PATTERN =
  /(?:симптом|самочувств|головокруж|тошнот|боль|судорог|одышк|symptom|well-?being|dizz|nause|pain|seiz)/iu;
const EMBEDDED_TIME_QUANTITY_PATTERN =
  /(?:^|[^\p{L}\p{N}])(?:\d+(?:[.,]\d+)?\s*(?:[-–—]\s*)?(?:milliseconds?|msecs?|ms|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|мс|миллисекунд\p{L}*|сек(?:унд\p{L}*)?|мин(?:ут\p{L}*)?|час\p{L}*|дн(?:я|ей)?|день|недел\p{L}*|месяц\p{L}*|год\p{L}*|лет)|\d{1,3}:\d{2})(?=$|[^\p{L}\p{N}])/iu;
const EMBEDDED_SUBDAY_TIME_QUANTITY_PATTERN =
  /(?:^|[^\p{L}\p{N}])(?:\d+(?:[.,]\d+)?\s*(?:[-–—]\s*)?(?:milliseconds?|msecs?|ms|seconds?|secs?|minutes?|mins?|hours?|hrs?|мс|миллисекунд\p{L}*|сек(?:унд\p{L}*)?|мин(?:ут\p{L}*)?|час\p{L}*)|\d{1,3}:\d{2})(?=$|[^\p{L}\p{N}])/iu;

export function validatePlanActionability(
  plan,
  {
    dailyMinutes,
    duration,
    cycleNumber = 1,
    expectedBaselineStatement,
    expectedTargetStatement,
    trustedBaseline,
    trustedTarget,
    programContext,
    researchTargetCycleNumber,
  },
) {
  assertExactObject(plan, 'plan', PLAN_KEYS);
  if (!Number.isInteger(dailyMinutes) || dailyMinutes < 1) {
    fail('dailyMinutes', 'дневной лимит должен быть целым числом минут');
  }
  const durationConfig = programDurationConfig(duration);
  if (!durationConfig) {
    fail('duration', 'ожидается month, half-year или year');
  }
  assertInteger(cycleNumber, 'cycleNumber', 1, durationConfig.totalCycles);

  assertString(plan.title, 'title', 3, 120);
  assertGeneratedText(plan.title, 'title');
  if (!GOAL_DOMAINS.has(plan.domain)) fail('domain', 'неизвестный домен цели');
  assertString(plan.targetMetric, 'targetMetric', 3, 220);
  assertGeneratedText(plan.targetMetric, 'targetMetric');
  if (plan.duration !== duration) fail('duration', 'выбранный срок программы был изменён');
  if (plan.totalCycles !== durationConfig.totalCycles) {
    fail('totalCycles', `для срока ${duration} ожидается ${durationConfig.totalCycles}`);
  }
  if (plan.cycleNumber !== cycleNumber) {
    fail('cycleNumber', `ожидается цикл ${cycleNumber}`);
  }
  assertInteger(
    plan.targetCycleNumber,
    'targetCycleNumber',
    cycleNumber,
    durationConfig.totalCycles,
  );
  if (Number.isInteger(researchTargetCycleNumber)) {
    assertInteger(researchTargetCycleNumber, 'researchTargetCycleNumber', 1, 12);
    const earliestAllowed = Math.max(cycleNumber, researchTargetCycleNumber);
    if (
      (cycleNumber === 1 && plan.targetCycleNumber !== researchTargetCycleNumber) ||
      (cycleNumber > 1 && plan.targetCycleNumber < earliestAllowed)
    ) {
      fail(
        'targetCycleNumber',
        cycleNumber === 1
          ? `ожидается подтверждённый research цикл ${researchTargetCycleNumber}`
          : `после нового замера ожидается цикл не раньше ${earliestAllowed}`,
      );
    }
  } else if (researchTargetCycleNumber === null) {
    const quickTargetCycle = quickTargetCycleNumber(
      programContext,
      cycleNumber,
      durationConfig.totalCycles,
    );
    if (plan.targetCycleNumber !== quickTargetCycle) {
      fail(
        'targetCycleNumber',
        `без web-research ожидается сохранённый ближайший цикл ${quickTargetCycle}`,
      );
    }
  }
  validateTarget(
    plan.target,
    expectedTargetStatement,
    trustedTarget,
    cycleNumber > 1 ? programContext?.target : undefined,
  );
  assertString(plan.cycleGoal, 'cycleGoal', 5, 300);
  assertGeneratedText(plan.cycleGoal, 'cycleGoal');
  validateRoadmap(
    plan.roadmap,
    durationConfig.totalCycles,
    cycleNumber,
    plan.targetCycleNumber,
    trustedBaseline,
    trustedTarget,
    programContext,
  );
  assertString(plan.summary, 'summary', 10, 600);
  assertGeneratedText(plan.summary, 'summary');
  validateBaseline(plan.baseline, expectedBaselineStatement, trustedBaseline);
  assertStringArray(plan.safetyNotes, 'safetyNotes', 0, 4, 3, 300);
  assertStringArray(plan.assumptions, 'assumptions', 1, 6, 3, 300);
  plan.safetyNotes.forEach((note, index) =>
    assertSafetyText(note, `safetyNotes.${index}`),
  );
  plan.assumptions.forEach((assumption, index) =>
    assertGeneratedText(assumption, `assumptions.${index}`),
  );
  assertStringArray(plan.sourceLabels, 'sourceLabels', 1, 8, 2, 180);
  validatePhases(plan.phases, CYCLE_DAYS);

  if (!Array.isArray(plan.days) || plan.days.length !== CYCLE_DAYS) {
    fail('days', `цикл должен содержать ровно ${CYCLE_DAYS} календарных дней`);
  }

  plan.days.forEach((day, index) => {
    const path = `days.${index}`;
    assertExactObject(day, path, DAY_KEYS);
    assertInteger(day.dayNumber, `${path}.dayNumber`, 1, CYCLE_DAYS);
    if (day.dayNumber !== index + 1) {
      fail(`${path}.dayNumber`, `ожидается последовательный день ${index + 1}`);
    }
    const expectedPhaseIndex = phaseIndexForDay(plan.phases, day.dayNumber);
    assertInteger(day.phaseIndex, `${path}.phaseIndex`, 1, 3);
    if (day.phaseIndex !== expectedPhaseIndex) {
      fail(`${path}.phaseIndex`, `день ${day.dayNumber} не входит в указанную фазу`);
    }
    validateDay(
      day,
      dailyMinutes,
      trustedBaseline,
      trustedTarget,
      plan.target.userStatement,
      path,
    );
  });

  validateAssessment(plan.assessment, plan, cycleNumber);
  validateNumericPracticeTrajectory(plan, trustedBaseline, trustedTarget, cycleNumber);

  return plan;
}

function validateTarget(target, expectedStatement, trustedTarget, previousTarget) {
  assertExactObject(target, 'target', TARGET_KEYS);
  assertString(target.userStatement, 'target.userStatement', 5, 1000);
  if (typeof expectedStatement === 'string' && target.userStatement !== expectedStatement) {
    fail('target.userStatement', 'цель пользователя должна быть сохранена дословно');
  }
  assertString(target.normalizedMetric, 'target.normalizedMetric', 2, 180);
  assertGeneratedText(target.normalizedMetric, 'target.normalizedMetric');

  if (!trustedTarget) {
    if (target.value !== null || target.unit !== null) {
      fail('target.value', 'нераспознанная числовая цель должна быть null');
    }
    validateFrozenProgramTarget(target, previousTarget);
    return;
  }

  assertFiniteNumber(target.value, 'target.value', 0, 1_000_000_000);
  assertString(target.unit, 'target.unit', 1, 40);
  if (target.value !== trustedTarget.value) {
    fail('target.value', `ожидается локально распознанное значение ${trustedTarget.value}`);
  }
  if (canonicalUnit(target.unit) !== canonicalUnit(trustedTarget.unit)) {
    fail('target.unit', `ожидается локально распознанная единица ${trustedTarget.unit}`);
  }

  validateFrozenProgramTarget(target, previousTarget);
}

function quickTargetCycleNumber(programContext, currentCycleNumber, totalCycles) {
  if (!programContext) return currentCycleNumber;
  if (Number.isInteger(programContext.targetCycleNumber)) {
    return Math.min(
      totalCycles,
      Math.max(currentCycleNumber, programContext.targetCycleNumber),
    );
  }
  const programTarget = programContext.target;
  if (Number.isFinite(programTarget?.value) && typeof programTarget?.unit === 'string') {
    const targetUnit = canonicalUnit(programTarget.unit);
    const targetIndex = programContext.roadmap?.findIndex(
      (entry, index) =>
        index >= currentCycleNumber - 1 &&
        Object.is(entry?.targetValue, programTarget.value) &&
        canonicalUnit(entry?.targetUnit) === targetUnit,
    );
    if (Number.isInteger(targetIndex) && targetIndex >= currentCycleNumber - 1) {
      return targetIndex + 1;
    }
  }
  return totalCycles;
}

function validateFrozenProgramTarget(target, previousTarget) {
  if (!previousTarget) return;
  const sameClientIdentity =
    typeof previousTarget.userStatement === 'string' &&
    target.userStatement.trim() === previousTarget.userStatement.trim() &&
    typeof previousTarget.normalizedMetric === 'string' &&
    target.normalizedMetric.trim() === previousTarget.normalizedMetric.trim() &&
    Object.is(target.value, previousTarget.value) &&
    normalizedIdentityUnit(target.unit) === normalizedIdentityUnit(previousTarget.unit);
  if (!sameClientIdentity) {
    fail('target', 'цель программы нельзя изменять между циклами');
  }
}

function normalizedIdentityUnit(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('ru-RU') : value;
}

function validateRoadmap(
  roadmap,
  totalCycles,
  currentCycleNumber,
  targetCycleNumber,
  trustedBaseline,
  trustedTarget,
  programContext,
) {
  if (!Array.isArray(roadmap) || roadmap.length !== totalCycles) {
    fail('roadmap', `ожидается ровно ${totalCycles} этапов программы`);
  }

  roadmap.forEach((entry, index) => {
    const path = `roadmap.${index}`;
    assertExactObject(entry, path, ROADMAP_KEYS);
    assertInteger(entry.cycleNumber, `${path}.cycleNumber`, 1, totalCycles);
    if (entry.cycleNumber !== index + 1) {
      fail(`${path}.cycleNumber`, `ожидается последовательный цикл ${index + 1}`);
    }
    assertString(entry.title, `${path}.title`, 2, 100);
    assertGeneratedText(entry.title, `${path}.title`);
    assertString(entry.focus, `${path}.focus`, 5, 240);
    assertGeneratedText(entry.focus, `${path}.focus`);
    validateNullableMetricPair(entry.targetValue, entry.targetUnit, path);
  });

  const previousRoadmap = programContext?.roadmap;
  if (currentCycleNumber > 1 && Array.isArray(previousRoadmap)) {
    for (let index = 0; index < currentCycleNumber - 1; index += 1) {
      if (!isSameRoadmapEntry(roadmap[index], previousRoadmap[index])) {
        fail(`roadmap.${index}`, 'завершённый этап программы нельзя изменять');
      }
    }
  }

  const trustedUnitsMatch =
    trustedBaseline &&
    trustedTarget &&
    canonicalUnit(trustedBaseline.unit) === canonicalUnit(trustedTarget.unit);
  if (trustedUnitsMatch) {
    const currentDirection = Math.sign(
      trustedTarget.value - trustedBaseline.value,
    );
    if (currentDirection === 0 && targetCycleNumber !== currentCycleNumber) {
      fail('targetCycleNumber', 'уже достигнутая цель должна завершаться в текущем цикле');
    }
    const numericEntries = [];
    roadmap.forEach((entry, index) => {
      const path = `roadmap.${index}`;
      const frozenLegacyNull =
        index < currentCycleNumber - 1 &&
        Array.isArray(previousRoadmap) &&
        entry.targetValue === null &&
        entry.targetUnit === null &&
        previousRoadmap[index]?.targetValue === null &&
        previousRoadmap[index]?.targetUnit === null;
      if (frozenLegacyNull) return;

      assertFiniteNumber(entry.targetValue, `${path}.targetValue`, 0, 1_000_000_000);
      assertString(entry.targetUnit, `${path}.targetUnit`, 1, 40);
      if (canonicalUnit(entry.targetUnit) !== canonicalUnit(trustedTarget.unit)) {
        fail(`${path}.targetUnit`, `ожидается единица ${trustedTarget.unit}`);
      }
      numericEntries.push({ entry, index, path });
    });

    // Frozen milestones are historical intentions, not measured results. A missed
    // target may legitimately make the new roadmap start below that old intention,
    // so current/future monotonicity starts from the measured baseline instead.
    let previousValue = trustedBaseline.value;
    numericEntries.forEach(({ entry, index, path }) => {
      const isCurrentOrFuture = index >= currentCycleNumber - 1;
      if (!isCurrentOrFuture) return;
      const atOrAfterTargetCycle = index >= targetCycleNumber - 1;
      if (
        atOrAfterTargetCycle &&
        entry.targetValue !== trustedTarget.value
      ) {
        fail(
          `${path}.targetValue`,
          'целевой и последующие циклы должны точно совпадать с конечной целью',
        );
      }
      if (
        !atOrAfterTargetCycle &&
        entry.targetValue === trustedTarget.value
      ) {
        fail(
          `${path}.targetValue`,
          'конечная цель достигнута раньше указанного targetCycleNumber',
        );
      }

      if (currentDirection > 0 && previousValue != null && entry.targetValue < previousValue) {
        fail(`${path}.targetValue`, 'этапы должны монотонно приближаться к цели');
      }
      if (currentDirection < 0 && previousValue != null && entry.targetValue > previousValue) {
        fail(`${path}.targetValue`, 'этапы должны монотонно приближаться к цели');
      }
      if (
        currentDirection === 0 &&
        previousValue != null &&
        !nearlyEqual(entry.targetValue, trustedTarget.value)
      ) {
        fail(`${path}.targetValue`, 'этапы должны монотонно приближаться к цели');
      }
      if (
        currentDirection > 0 &&
        (entry.targetValue <= trustedBaseline.value || entry.targetValue > trustedTarget.value)
      ) {
        fail(`${path}.targetValue`, 'текущий и будущие этапы должны строго приближаться к цели');
      }
      if (
        currentDirection < 0 &&
        (entry.targetValue >= trustedBaseline.value || entry.targetValue < trustedTarget.value)
      ) {
        fail(`${path}.targetValue`, 'текущий и будущие этапы должны строго приближаться к цели');
      }
      if (
        index < targetCycleNumber - 1 &&
        previousValue != null &&
        nearlyEqual(entry.targetValue, previousValue)
      ) {
        fail(`${path}.targetValue`, 'промежуточные будущие этапы не должны создавать плато');
      }
      if (
        currentDirection === 0 &&
        !nearlyEqual(entry.targetValue, trustedTarget.value)
      ) {
        fail(`${path}.targetValue`, 'достигнутая цель не должна удаляться от исходной точки');
      }
      previousValue = entry.targetValue;
    });
  }
}

function validateAssessment(assessment, plan, currentCycleNumber) {
  assertExactObject(assessment, 'assessment', ASSESSMENT_KEYS);
  if (assessment.dayNumber !== CYCLE_DAYS) {
    fail('assessment.dayNumber', `контрольный замер должен быть назначен на день ${CYCLE_DAYS}`);
  }
  assertInteger(assessment.blockIndex, 'assessment.blockIndex', 0, 2);
  assertString(assessment.metric, 'assessment.metric', 2, 180);
  assertGeneratedText(assessment.metric, 'assessment.metric');
  validateNullableMetricPair(
    assessment.targetValue,
    assessment.targetUnit,
    'assessment',
  );

  const currentMilestone = plan.roadmap[currentCycleNumber - 1];
  if (
    !Object.is(assessment.targetValue, currentMilestone.targetValue) ||
    assessment.targetUnit !== currentMilestone.targetUnit
  ) {
    fail('assessment', 'контрольный замер должен совпадать с целью текущего цикла');
  }

  const finalDay = plan.days[CYCLE_DAYS - 1];
  if (assessment.blockIndex !== finalDay.execution.primaryBlockIndex) {
    fail('assessment.blockIndex', 'контрольный замер должен быть главным блоком дня 30');
  }
  const block = finalDay.execution.blocks[assessment.blockIndex];
  if (!block) fail('assessment.blockIndex', 'указанный блок отсутствует в дне 30');
  if (block.kind !== 'timer' && block.kind !== 'counter') {
    fail('assessment.blockIndex', 'контрольный замер должен указывать на timer или counter');
  }
  if (assessment.targetValue === null) return;

  if (block.kind === 'timer') {
    if (canonicalUnit(assessment.targetUnit) !== 'seconds') {
      fail('assessment.targetUnit', 'для timer ожидается seconds');
    }
    if (block.durationSecondsPerSet !== assessment.targetValue) {
      fail('assessment.targetValue', 'длительность timer не совпадает с целью замера');
    }
    return;
  }

  const blockUnit = block.unit === 'custom' ? block.unitLabel : block.unit;
  if (canonicalUnit(blockUnit) !== canonicalUnit(assessment.targetUnit)) {
    fail('assessment.targetUnit', 'единица counter не совпадает с целью замера');
  }
  if (block.targetPerSet !== assessment.targetValue) {
    fail('assessment.targetValue', 'targetPerSet не совпадает с целью замера');
  }
}

function validateNumericPracticeTrajectory(
  plan,
  trustedBaseline,
  trustedTarget,
  currentCycleNumber,
) {
  if (
    !trustedBaseline ||
    !trustedTarget ||
    canonicalUnit(trustedBaseline.unit) !== canonicalUnit(trustedTarget.unit) ||
    trustedTarget.value <= trustedBaseline.value
  ) {
    return;
  }
  const milestone = plan.roadmap[currentCycleNumber - 1];
  if (
    !Number.isFinite(milestone?.targetValue) ||
    canonicalUnit(milestone?.targetUnit) !== canonicalUnit(trustedTarget.unit) ||
    milestone.targetValue <= trustedBaseline.value
  ) {
    return;
  }

  // A structurally valid one-second timer is still filler. Keep every training
  // day connected both to the measured ability and to this month's milestone,
  // while allowing genuinely light sessions instead of daily maximal attempts.
  // A zero baseline cannot produce loadBasis percentages, but the milestone
  // still supplies a positive absolute floor.
  const targetUnit = canonicalUnit(trustedTarget.unit);
  const discreteDose = targetUnit === 'seconds' || DISCRETE_COUNTER_UNITS.has(targetUnit);
  const normalizeFloor = (value) =>
    discreteDose ? Math.max(1, Math.ceil(value)) : Math.max(0.01, value);
  const minimumDailyDose = normalizeFloor(
    Math.max(trustedBaseline.value * 0.25, milestone.targetValue * 0.1),
  );
  const practiceDays = plan.days.slice(0, CYCLE_DAYS - 1);
  practiceDays.forEach((day, index) => {
    const primary = day.execution.blocks[day.execution.primaryBlockIndex];
    const { dose, property } = primaryDose(primary, targetUnit);
    if (dose < minimumDailyDose) {
      fail(
        `days.${index}.execution.blocks.${day.execution.primaryBlockIndex}.${property}`,
        `каждый тренировочный день должен содержать целевую дозу не меньше ${formatDose(minimumDailyDose)} ${trustedTarget.unit} (max из 25% baseline и 10% цели текущего цикла)`,
      );
    }
  });

  // The last practice day is the bridge into the assessment. Requiring the
  // existing 25%-of-milestone floor specifically there prevents an arbitrary
  // early spike from masking a 4-week jump straight into the day-30 target.
  const minimumPreAssessmentDose = normalizeFloor(milestone.targetValue * 0.25);
  const preAssessmentDayIndex = CYCLE_DAYS - 2;
  const preAssessmentDay = plan.days[preAssessmentDayIndex];
  const preAssessmentPrimary =
    preAssessmentDay.execution.blocks[preAssessmentDay.execution.primaryBlockIndex];
  const { dose: preAssessmentDose, property: preAssessmentProperty } =
    primaryDose(preAssessmentPrimary, targetUnit);
  if (preAssessmentDose < minimumPreAssessmentDose) {
    fail(
      `days.${preAssessmentDayIndex}.execution.blocks.${preAssessmentDay.execution.primaryBlockIndex}.${preAssessmentProperty}`,
      `последний тренировочный день перед замером должен содержать целевую дозу не меньше ${formatDose(minimumPreAssessmentDose)} ${trustedTarget.unit} (25% цели текущего цикла)`,
    );
  }
}

function primaryDose(primary, targetUnit) {
  if (targetUnit === 'seconds' && primary?.kind === 'timer') {
    return { dose: primary.durationSecondsPerSet, property: 'durationSecondsPerSet' };
  }
  if (primary?.kind === 'counter') {
    const blockUnit = canonicalUnit(
      primary.unit === 'custom' ? primary.unitLabel : primary.unit,
    );
    if (blockUnit === targetUnit) {
      return { dose: primary.targetPerSet, property: 'targetPerSet' };
    }
  }
  return { dose: 0, property: primary?.kind === 'timer' ? 'durationSecondsPerSet' : 'targetPerSet' };
}

function formatDose(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function validateNullableMetricPair(value, unit, path) {
  if (value === null && unit === null) return;
  if (value === null || unit === null) {
    fail(`${path}.targetValue`, 'значение и единица должны быть одновременно null или заполнены');
  }
  assertFiniteNumber(value, `${path}.targetValue`, 0, 1_000_000_000);
  assertString(unit, `${path}.targetUnit`, 1, 40);
}

function isSameRoadmapEntry(left, right) {
  if (!left || !right) return false;
  return ROADMAP_KEYS.every((key) => Object.is(left[key], right[key]));
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

function validateDay(
  day,
  dailyMinutes,
  trustedBaseline,
  trustedTarget,
  targetStatement,
  path,
) {
  assertString(day.title, `${path}.title`, 2, 120);
  assertGeneratedText(day.title, `${path}.title`);
  assertString(day.description, `${path}.description`, 5, 560);
  assertGeneratedText(day.description, `${path}.description`);
  if (!MISSION_TYPES.has(day.type)) fail(`${path}.type`, 'неизвестный тип миссии');
  assertInteger(day.xp, `${path}.xp`, 5, 60);
  if (day.warning !== null) {
    assertString(day.warning, `${path}.warning`, 3, 300);
    assertSafetyText(day.warning, `${path}.warning`);
  }
  assertInteger(day.estimatedMinutes, `${path}.estimatedMinutes`, 1, 120);
  if (day.estimatedMinutes > dailyMinutes) {
    fail(`${path}.estimatedMinutes`, 'день превышает выбранный дневной лимит');
  }

  const execution = day.execution;
  assertExactObject(execution, `${path}.execution`, EXECUTION_KEYS);
  if (execution.kind !== 'in_app') {
    fail(`${path}.execution.kind`, 'для plan-v7 ожидается только in_app');
  }
  assertString(execution.successCriterion, `${path}.execution.successCriterion`, 5, 320);
  assertGeneratedText(execution.successCriterion, `${path}.execution.successCriterion`);
  assertNoEmbeddedTimeQuantity(
    execution.successCriterion,
    `${path}.execution.successCriterion`,
  );
  if (!Array.isArray(execution.blocks) || execution.blocks.length < 1 || execution.blocks.length > 3) {
    fail(`${path}.execution.blocks`, 'in_app должна содержать от одного до трёх блоков');
  }
  assertInteger(execution.primaryBlockIndex, `${path}.execution.primaryBlockIndex`, 0, 2);
  const primaryBlock = execution.blocks[execution.primaryBlockIndex];
  if (!primaryBlock) {
    fail(`${path}.execution.primaryBlockIndex`, 'указанный главный блок отсутствует');
  }

  let knownDurationSeconds = 0;
  execution.blocks.forEach((block, blockIndex) => {
    const blockPath = `${path}.execution.blocks.${blockIndex}`;
    const result = validateBlock(block, trustedBaseline, targetStatement, blockPath);
    knownDurationSeconds += result.durationSeconds;
  });
  validatePrimaryBlock(
    primaryBlock,
    trustedBaseline,
    trustedTarget,
    targetStatement,
    `${path}.execution.blocks.${execution.primaryBlockIndex}`,
  );

  if (knownDurationSeconds > day.estimatedMinutes * 60) {
    fail(
      `${path}.execution.blocks`,
      'известная длительность блоков превышает заявленную длительность дня',
    );
  }
}

function validatePrimaryBlock(block, trustedBaseline, trustedTarget, targetStatement, path) {
  if (block.kind !== 'timer' && block.kind !== 'counter') {
    fail(path, 'главный блок дня должен быть измеримым timer или counter');
  }
  const targetUnit = trustedTarget ? canonicalUnit(trustedTarget.unit) : undefined;
  if (trustedTarget) {
    if (targetUnit === 'seconds' && block.kind !== 'timer') {
      fail(path, 'для временной цели главным блоком должен быть timer');
    }
    if (targetUnit !== 'seconds') {
      if (block.kind !== 'counter') {
        fail(path, 'для счётной цели главным блоком должен быть counter');
      }
      const blockUnit = block.unit === 'custom' ? block.unitLabel : block.unit;
      if (canonicalUnit(blockUnit) !== targetUnit) {
        fail(path, `единица главного counter должна совпадать с целью ${trustedTarget.unit}`);
      }
    }
  }

  assertNotPassiveOnlyPrimary(block.instruction, targetStatement, path);

  if (
    BREATH_HOLD_ACTION_PATTERN.test(targetStatement) &&
    !BREATH_HOLD_INSTRUCTION_ACTION_PATTERN.test(block.instruction)
  ) {
    fail(
      path,
      'главный блок дня должен содержать явное действие задержки дыхания непосредственно в instruction',
    );
  }
  if (!trustedTarget) return;

  const baselineMatchesTarget =
    trustedBaseline && canonicalUnit(trustedBaseline.unit) === targetUnit;
  if (baselineMatchesTarget && trustedBaseline.value > 0 && block.loadBasis === null) {
    fail(`${path}.loadBasis`, 'главный блок должен содержать точную нагрузку от baseline');
  }
}

function assertNotPassiveOnlyPrimary(instruction, targetStatement, path) {
  if (!PASSIVE_ONLY_PRIMARY_PATTERN.test(instruction)) return;
  if (PASSIVE_PRACTICE_GOAL_PATTERN.test(targetStatement)) return;
  const affirmativeText = instruction
    .replace(/\b(?:do\s+not|don't|never)\s+[\p{L}\p{M}-]+/giu, '')
    .replace(/(?:^|[;,.!?]\s*|\s)не\s+[\p{L}\p{M}-]+/giu, ' ');
  if (AFFIRMATIVE_ACTIVE_PRIMARY_PATTERN.test(affirmativeText)) return;
  fail(path, 'пассивное ожидание, отдых или расслабление не может быть главной целевой практикой');
}

function validateBlock(block, trustedBaseline, targetStatement, path) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    fail(path, 'блок должен быть объектом');
  }

  if (block.kind === 'timer') {
    return validateTimerBlock(block, trustedBaseline, targetStatement, path);
  }
  if (block.kind === 'counter') {
    return validateCounterBlock(block, trustedBaseline, targetStatement, path);
  }
  if (block.kind === 'checklist') return validateChecklistBlock(block, path);
  if (block.kind === 'text_log') return validateTextLogBlock(block, path);
  fail(`${path}.kind`, 'неизвестный вид in_app-блока');
}

function validateTimerBlock(block, trustedBaseline, targetStatement, path) {
  assertExactObject(block, path, TIMER_BLOCK_KEYS);
  validateCommonBlockText(block, path, true);
  assertNotPassiveRecoveryOnlyBlock(block, targetStatement, path);
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

function validateCounterBlock(block, trustedBaseline, targetStatement, path) {
  assertExactObject(block, path, COUNTER_BLOCK_KEYS);
  validateCommonBlockText(block, path, true);
  assertNotPassiveRecoveryOnlyBlock(block, targetStatement, path);
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
  if (block.items.every((item) => SAFETY_ONLY_ITEM_PATTERN.test(item))) {
    fail(path, 'проверка безопасности или восстановления не является исполняемой практикой');
  }
  assertInteger(block.estimatedSeconds, `${path}.estimatedSeconds`, 1, 7200);
  return { durationSeconds: block.estimatedSeconds, loadLinked: false };
}

function validateTextLogBlock(block, path) {
  assertExactObject(block, path, TEXT_LOG_BLOCK_KEYS);
  validateCommonBlockText(block, path, false, true);
  assertString(block.prompt, `${path}.prompt`, 5, 360);
  assertGeneratedText(block.prompt, `${path}.prompt`, true);
  if (SYMPTOM_JOURNAL_PATTERN.test(`${block.title} ${block.prompt}`)) {
    fail(path, 'журнал симптомов или восстановления должен быть вынесен из исполняемой практики');
  }
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
  // A title may identify the calendar position (for example, "Итог 30 дней").
  // Sub-day work still belongs in a structural timer/counter field.
  if (EMBEDDED_SUBDAY_TIME_QUANTITY_PATTERN.test(block.title)) {
    fail(
      `${path}.title`,
      'временная нагрузка должна быть структурным полем встроенного timer/counter, а не свободным текстом',
    );
  }
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

function assertNotPassiveRecoveryOnlyBlock(block, targetStatement, path) {
  const text = `${block.title} ${block.instruction} ${block.successCriterion}`;
  if (EXPLICIT_NO_PRACTICE_PATTERN.test(text)) {
    fail(path, 'пассивное восстановление не может заменять целевую практику');
  }
  if (!ORDINARY_BREATHING_PATTERN.test(text)) return;
  if (BREATH_HOLD_ACTION_PATTERN.test(text)) return;
  const breathingItselfIsGoal =
    BREATHING_GOAL_PATTERN.test(targetStatement) &&
    !BREATH_HOLD_ACTION_PATTERN.test(targetStatement);
  if (!breathingItselfIsGoal) {
    fail(path, 'обычное дыхание без целевого действия не является практикой');
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
  assertFiniteNumber(basis.percentage, `${path}.loadBasis.percentage`, 0.01, 1_000_000);
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

function assertSafetyText(value, path) {
  if (typeof value !== 'string') return;
  // Safety copy is informational rather than an executable block. It may name
  // something that is prohibited, or describe escalation after a risk event.
  // A normal prerequisite/follow-up still goes through the strict dependency
  // scanner and remains forbidden.
  const clauses = value
    .split(
      /(?:[;!?]+|\.(?:\s+|$)|,\s+(?=(?:а\s+)?(?:перед|до|после\s+кажд|во\s+время\s+кажд)(?:\s|$))|\s+(?:и|а)\s+(?=(?:перед|до|после\s+кажд|во\s+время\s+кажд)(?:\s|$)))/iu,
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
  for (const [index, clause] of clauses.entries()) {
    if (
      SAFETY_PROHIBITION_PATTERN.test(clause) ||
      SAFETY_CONDITIONAL_RISK_PATTERN.test(clause)
    ) {
      continue;
    }
    assertGeneratedText(clause, `${path}.clause${index + 1}`);
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
    if (!expected.has(key)) fail(`${path}.${key}`, 'поле не поддерживается контрактом plan-v7');
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
