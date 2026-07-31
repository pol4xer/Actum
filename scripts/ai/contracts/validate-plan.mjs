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

const VAGUE_ONLY_PATTERNS = [
  /^(?:подготовься|сделай разминку|изучи(?: тему| технику)?|поработай над техникой|выполни упражнение|добавь немного|действуй аккуратно)[.!]?$/iu,
  /^(?:найди|обратись к) (?:инструктору|инструктора|специалисту|специалиста)[.!]?$/iu,
  /^(?:prepare|warm up|study(?: the)? technique|do the exercise|find (?:an? )?(?:coach|specialist)|be careful)[.!]?$/iu,
];
const SOFT_VAGUE_PATTERN =
  /(?:постепенн|понемногу|по самочувствию|в комфортн|подготовься|сделай разминку|изучи технику|поработай над техникой|добавь немного|gradually|comfortable pace)/iu;
const GENERIC_SHORT_ACTION_PATTERN =
  /^(?:дыши|тренируй|потренируй|практикуй|выполни|сделай|подготовься|работай|breathe|train|practice|prepare|do the exercise)(?:\s|[.,!?:;—-]|$)/iu;
const PROGRESSION_BRANCH_PATTERN = /(?:если|if).*(?:если нет|иначе|otherwise|if not)/iu;

export function normalizePlanSchedule(plan, horizonDays) {
  const missions = Array.isArray(plan?.chapters)
    ? plan.chapters.flatMap((chapter) =>
        Array.isArray(chapter?.missions) ? chapter.missions : [],
      )
    : [];
  if (
    ![7, 14, 28].includes(horizonDays) ||
    missions.length === 0 ||
    missions.length > horizonDays ||
    missions.some(
      (mission) =>
        !Number.isInteger(mission?.repeatCount) ||
        mission.repeatCount < 1 ||
        mission.repeatCount > 28,
    )
  ) {
    return plan;
  }

  let total = missions.reduce((sum, mission) => sum + mission.repeatCount, 0);
  let cursor = 0;
  while (total < horizonDays) {
    const mission = missions[cursor % missions.length];
    if (mission.repeatCount < 28) {
      mission.repeatCount += 1;
      total += 1;
    }
    cursor += 1;
  }

  cursor = missions.length - 1;
  while (total > horizonDays) {
    const mission = missions[cursor];
    if (mission.repeatCount > 1) {
      mission.repeatCount -= 1;
      total -= 1;
    }
    cursor = cursor === 0 ? missions.length - 1 : cursor - 1;
  }

  return plan;
}

export function normalizePlanDurations(plan, dailyMinutes) {
  const maximumSeconds = Math.max(60, Math.round(dailyMinutes) * 60);
  const missions = Array.isArray(plan?.chapters)
    ? plan.chapters.flatMap((chapter) =>
        Array.isArray(chapter?.missions) ? chapter.missions : [],
      )
    : [];
  let adjustedMissions = 0;

  for (const mission of missions) {
    const actions = mission?.execution?.kind === 'routine' ? mission.execution.actions : undefined;
    if (!Array.isArray(actions)) continue;
    const originalDuration = knownRoutineDuration(actions);
    if (!Number.isFinite(originalDuration) || originalDuration <= maximumSeconds) continue;

    const scale = maximumSeconds / originalDuration;
    for (const action of actions) {
      if (action?.unit === 'seconds' || action?.unit === 'minutes') {
        const originalSeconds = action.unit === 'minutes' ? action.quantity * 60 : action.quantity;
        action.unit = 'seconds';
        action.quantity = Math.max(1, Math.floor(originalSeconds * scale));
        action.unitLabel = null;
        action.successCriterion =
          `Таймер текущего подхода дошёл до 0 после ${action.quantity} секунд без досрочного завершения.`;
      }
      if (Number.isInteger(action?.restSeconds)) {
        action.restSeconds = Math.max(0, Math.floor(action.restSeconds * scale));
      }
    }

    if (knownRoutineDuration(actions) > maximumSeconds) {
      for (const action of actions) {
        action.restSeconds = 0;
        if (action.unit === 'seconds') action.quantity = 1;
      }
    }

    const firstAction = actions[0];
    mission.execution.successCriterion =
      `Выполнены все ${actions.length} действий и все подходы с нормализованными значениями, показанными в комплексе.`;
    if (firstAction) {
      mission.progressionRule =
        `Если выполнен критерий всей миссии — увеличь объём действия «${firstAction.title}» на 1 ${routineUnitLabel(firstAction)}; ` +
        'если нет — повтори текущие числа с изменением 0.';
    }
    mission.estimatedMinutes = Math.min(
      Math.max(1, Math.round(mission.estimatedMinutes || dailyMinutes)),
      Math.round(dailyMinutes),
    );
    adjustedMissions += 1;
  }

  return adjustedMissions;
}

export function validatePlanActionability(plan, dailyMinutes, horizonDays) {
  if (!plan || typeof plan !== 'object') fail('plan', 'план должен быть объектом');
  if (!Number.isInteger(dailyMinutes) || dailyMinutes < 1) {
    fail('dailyMinutes', 'дневной лимит должен быть целым числом минут');
  }
  if (![7, 14, 28].includes(horizonDays)) {
    fail('horizonDays', 'горизонт должен быть равен 7, 14 или 28 дням');
  }
  assertString(plan.title, 'title', 3, 120);
  if (!GOAL_DOMAINS.has(plan.domain)) fail('domain', 'неизвестный домен цели');
  assertString(plan.targetMetric, 'targetMetric', 3, 180);
  assertString(plan.summary, 'summary', 10, 500);
  assertStringArray(plan.safetyNotes, 'safetyNotes', 0, 4, 3, 300);
  assertStringArray(plan.assumptions, 'assumptions', 1, 5, 3, 300);
  assertStringArray(plan.sourceLabels, 'sourceLabels', 1, 6, 2, 160);
  if (!Array.isArray(plan.chapters) || plan.chapters.length !== 3) {
    fail('chapters', 'план должен содержать ровно три главы');
  }

  let totalSessions = 0;
  plan.chapters.forEach((chapter, chapterIndex) => {
    const chapterPath = `chapters.${chapterIndex}`;
    if (!chapter || typeof chapter !== 'object') fail(chapterPath, 'глава должна быть объектом');
    assertString(chapter.title, `${chapterPath}.title`, 2, 100);
    assertString(chapter.subtitle, `${chapterPath}.subtitle`, 2, 160);
    if (!Array.isArray(chapter.missions) || chapter.missions.length < 2 || chapter.missions.length > 3) {
      fail(`${chapterPath}.missions`, 'глава должна содержать от двух до трёх миссий');
    }

    chapter.missions.forEach((mission, missionIndex) => {
      validateMission(mission, dailyMinutes, `${chapterPath}.missions.${missionIndex}`);
      totalSessions += mission.repeatCount;
    });
  });

  if (totalSessions !== horizonDays) {
    fail(
      'chapters',
      `сумма repeatCount должна быть ${horizonDays}, получено ${totalSessions}`,
    );
  }

  return plan;
}

function validateMission(mission, dailyMinutes, path) {
  if (!mission || typeof mission !== 'object') fail(path, 'миссия должна быть объектом');
  assertString(mission.title, `${path}.title`, 2, 120);
  assertString(mission.description, `${path}.description`, 5, 500);
  if (!MISSION_TYPES.has(mission.type)) fail(`${path}.type`, 'неизвестный тип миссии');
  assertInteger(mission.xp, `${path}.xp`, 10, 60);
  assertInteger(mission.repeatCount, `${path}.repeatCount`, 1, 28);
  assertString(mission.progressionRule, `${path}.progressionRule`, 8, 360);
  const progressionNumbers = mission.progressionRule.match(/\d+(?:[.,]\d+)?/gu) ?? [];
  if (
    isVagueOnly(mission.progressionRule) ||
    progressionNumbers.length < 2 ||
    !PROGRESSION_BRANCH_PATTERN.test(mission.progressionRule)
  ) {
    fail(`${path}.progressionRule`, 'правило не содержит двух точных измеримых веток');
  }
  if (mission.warning !== null) assertString(mission.warning, `${path}.warning`, 3, 300);
  if (isVagueOnly(mission.description)) {
    fail(`${path}.description`, 'описание подменяет действие общей фразой');
  }
  if (!Number.isInteger(mission.estimatedMinutes) || mission.estimatedMinutes < 1) {
    fail(`${path}.estimatedMinutes`, 'длительность миссии должна быть положительным целым числом');
  }
  if (mission.estimatedMinutes > dailyMinutes) {
    fail(`${path}.estimatedMinutes`, 'миссия превышает выбранный дневной лимит');
  }
  if (!Array.isArray(mission.steps) || mission.steps.length < 1 || mission.steps.length > 6) {
    fail(`${path}.steps`, 'миссия должна содержать от одного до шести конкретных указаний');
  }
  mission.steps.forEach((step, stepIndex) => {
    assertString(step, `${path}.steps.${stepIndex}`, 2, 260);
  });
  if (mission.steps.some(isInsufficientlySpecific)) {
    fail(`${path}.steps`, 'миссия не содержит конкретного указания');
  }

  const execution = mission.execution;
  if (!execution || typeof execution !== 'object') {
    fail(`${path}.execution`, 'не указан способ выполнения');
  }
  assertString(execution.successCriterion, `${path}.execution.successCriterion`, 5, 300);

  if (execution.kind === 'manual') {
    if (execution.durationSeconds !== null) {
      fail(`${path}.execution.durationSeconds`, 'для manual ожидается null');
    }
    return;
  }

  if (execution.kind === 'timer') {
    assertInteger(execution.durationSeconds, `${path}.execution.durationSeconds`, 1, 7200);
    if (execution.durationSeconds > dailyMinutes * 60) {
      fail(`${path}.execution.durationSeconds`, 'таймер превышает выбранный дневной лимит');
    }
    return;
  }

  if (execution.kind !== 'routine') {
    fail(`${path}.execution.kind`, 'неизвестный способ выполнения');
  }
  if (!Array.isArray(execution.actions) || execution.actions.length < 1 || execution.actions.length > 8) {
    fail(`${path}.execution.actions`, 'routine должна содержать от одного до восьми действий');
  }

  let knownDurationSeconds = 0;
  execution.actions.forEach((action, actionIndex) => {
    const actionPath = `${path}.execution.actions.${actionIndex}`;
    if (!action || typeof action !== 'object') fail(actionPath, 'действие должно быть объектом');
    assertString(action.title, `${actionPath}.title`, 2, 100);
    assertString(action.instruction, `${actionPath}.instruction`, 8, 300);
    assertString(action.successCriterion, `${actionPath}.successCriterion`, 5, 240);
    if (isInsufficientlySpecific(action.instruction)) {
      fail(`${actionPath}.instruction`, 'инструкция подменена общей фразой');
    }
    assertInteger(action.sets, `${actionPath}.sets`, 1, 20);
    assertInteger(action.quantity, `${actionPath}.quantity`, 1, 10000);
    if (!ROUTINE_UNITS.has(action.unit)) fail(`${actionPath}.unit`, 'неизвестная единица объёма');
    assertInteger(action.restSeconds, `${actionPath}.restSeconds`, 0, 1800);
    if (action.tempo !== null) assertString(action.tempo, `${actionPath}.tempo`, 2, 100);
    if (action.unit === 'custom') {
      assertString(action.unitLabel, `${actionPath}.unitLabel`, 1, 40);
    } else if (action.unitLabel !== null) {
      fail(`${actionPath}.unitLabel`, 'unitLabel допустим только для custom');
    }

    const workSeconds =
      action.unit === 'seconds'
        ? action.quantity
        : action.unit === 'minutes'
          ? action.quantity * 60
          : 0;
    const restPeriods = Math.max(0, action.sets - 1) +
      (actionIndex < execution.actions.length - 1 ? 1 : 0);
    knownDurationSeconds += action.sets * workSeconds + restPeriods * action.restSeconds;
  });

  if (knownDurationSeconds > dailyMinutes * 60) {
    fail(`${path}.execution.actions`, 'известная длительность routine превышает дневной лимит');
  }
}

function knownRoutineDuration(actions) {
  return actions.reduce((total, action, actionIndex) => {
    if (!action || !Number.isInteger(action.sets)) return total;
    const workSeconds =
      action.unit === 'seconds'
        ? action.quantity
        : action.unit === 'minutes'
          ? action.quantity * 60
          : 0;
    const restPeriods = Math.max(0, action.sets - 1) +
      (actionIndex < actions.length - 1 ? 1 : 0);
    return total + action.sets * workSeconds + restPeriods * (action.restSeconds || 0);
  }, 0);
}

function routineUnitLabel(action) {
  if (action.unit === 'custom') return action.unitLabel || 'единицу';
  return {
    reps: 'повтор',
    seconds: 'секунду',
    minutes: 'минуту',
    pages: 'страницу',
    items: 'элемент',
    words: 'слово',
    meters: 'метр',
    attempts: 'попытку',
  }[action.unit] || 'единицу';
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

function fail(path, message) {
  throw new Error(`${path}: ${message}.`);
}
