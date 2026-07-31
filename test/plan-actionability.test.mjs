import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlanSchema,
  PLAN_CONTRACT_VERSION,
  PLAN_SCHEMA,
} from '../scripts/ai/contracts/plan-v1.mjs';
import {
  normalizePlanDurations,
  normalizePlanSchedule,
  validatePlanActionability,
} from '../scripts/ai/contracts/validate-plan.mjs';
import {
  buildPlanInstructions,
  PROMPT_VERSION,
  RESEARCH_INSTRUCTIONS,
} from '../scripts/ai/prompts/plan-v1.mjs';

test('plan-v3 accepts an exact routine with sets, quantity, rest, and criteria', () => {
  const plan = actionablePlan();
  assert.equal(validatePlanActionability(plan, 20, 14), plan);
  assert.equal(plan.chapters[0].missions[0].execution.actions[0].sets, 3);
  assert.equal(plan.chapters[0].missions[0].execution.actions[0].restSeconds, 45);
});

test('plan-v3 rejects a manual mission made only of a vague placeholder', () => {
  const plan = actionablePlan();
  plan.chapters[0].missions[0].steps = ['Подготовься.'];
  plan.chapters[0].missions[0].execution = {
    kind: 'manual',
    durationSeconds: null,
    successCriterion: 'Подготовка отмечена как выполненная.',
  };

  assert.throws(
    () => validatePlanActionability(plan, 20, 14),
    /chapters\.0\.missions\.0\.steps: миссия не содержит конкретного указания/,
  );
});

test('plan-v3 allows concrete research work and keeps warnings outside the action', () => {
  const plan = actionablePlan();
  const mission = plan.chapters[0].missions[0];
  mission.description = 'Разобрать заданный фрагмент и проверить понимание.';
  mission.steps = ['Изучи страницы 10–15 и письменно ответь на 5 вопросов.'];
  mission.execution = {
    kind: 'manual',
    durationSeconds: null,
    successCriterion: 'Записаны ответы на все 5 вопросов.',
  };
  mission.warning = 'При необходимости обсуди ошибки со специалистом после выполнения.';

  assert.doesNotThrow(() => validatePlanActionability(plan, 20, 14));
});

test('plan-v3 rejects a routine whose known timers exceed the daily limit', () => {
  const plan = actionablePlan();
  const action = plan.chapters[0].missions[0].execution.actions[0];
  action.sets = 3;
  action.quantity = 600;
  action.unit = 'seconds';
  action.restSeconds = 60;

  assert.throws(
    () => validatePlanActionability(plan, 20, 14),
    /известная длительность routine превышает дневной лимит/,
  );
});

test('plan-v3 rejects vague timer instructions and non-measurable progression', () => {
  const vagueTimer = actionablePlan();
  const mission = vagueTimer.chapters[0].missions[0];
  mission.steps = ['Потренируй дыхание в комфортном темпе.'];
  mission.execution = {
    kind: 'timer',
    durationSeconds: 30,
    successCriterion: 'Таймер дошёл до нуля.',
  };
  assert.throws(
    () => validatePlanActionability(vagueTimer, 20, 14),
    /chapters\.0\.missions\.0\.steps: миссия не содержит конкретного указания/,
  );

  const shortGeneric = actionablePlan();
  shortGeneric.chapters[0].missions[0].steps = ['Дыши спокойно.'];
  assert.throws(
    () => validatePlanActionability(shortGeneric, 20, 14),
    /steps: миссия не содержит конкретного указания/,
  );

  const weakProgression = actionablePlan();
  weakProgression.chapters[0].missions[0].progressionRule =
    'Постепенно увеличивай нагрузку.';
  assert.throws(
    () => validatePlanActionability(weakProgression, 20, 14),
    /progressionRule: правило не содержит двух точных измеримых веток/,
  );

  const disguisedProgression = actionablePlan();
  disguisedProgression.chapters[0].missions[0].progressionRule =
    'Если получилось 1 раз, постепенно увеличивай нагрузку; иначе попробуй снова.';
  assert.throws(
    () => validatePlanActionability(disguisedProgression, 20, 14),
    /progressionRule: правило не содержит двух точных измеримых веток/,
  );

  const mixedSteps = actionablePlan();
  mixedSteps.chapters[0].missions[0].steps = [
    'Сделай разминку.',
    'Положи коврик на ровный пол.',
  ];
  assert.throws(
    () => validatePlanActionability(mixedSteps, 20, 14),
    /steps: миссия не содержит конкретного указания/,
  );
});

test('plan-v3 aligns custom units with the schema and allows intentional repeated actions', () => {
  const plan = actionablePlan();
  const action = plan.chapters[0].missions[0].execution.actions[0];
  action.unit = 'custom';
  action.unitLabel = null;
  assert.throws(
    () => validatePlanActionability(plan, 20, 14),
    /execution\.actions\.0\.unitLabel/,
  );

  action.unitLabel = 'дыхательных циклов';
  plan.chapters[0].missions[0].execution.actions.push({ ...action });
  assert.doesNotThrow(() => validatePlanActionability(plan, 20, 14));
});

test('dynamic provider schema applies the selected daily limit before the paid response', () => {
  const schema = createPlanSchema(10);
  const mission = schema.properties.chapters.items.properties.missions.items.properties;
  assert.equal(mission.estimatedMinutes.maximum, 10);
  assert.equal(mission.execution.anyOf[1].properties.durationSeconds.maximum, 600);
  assert.equal(
    PLAN_SCHEMA.properties.chapters.items.properties.missions.items.properties.estimatedMinutes
      .maximum,
    120,
  );
});

test('overlong routine timers are reduced locally instead of discarding paid output', () => {
  const plan = actionablePlan();
  const mission = plan.chapters[0].missions[0];
  const action = mission.execution.actions[0];
  action.sets = 3;
  action.quantity = 600;
  action.unit = 'seconds';
  action.restSeconds = 60;

  assert.equal(normalizePlanDurations(plan, 20), 1);
  assert.doesNotThrow(() => validatePlanActionability(plan, 20, 14));
  assert.ok(action.sets * action.quantity + (action.sets - 1) * action.restSeconds <= 1200);
  assert.match(action.successCriterion, new RegExp(`${action.quantity} секунд`));
  assert.match(mission.execution.successCriterion, /нормализованными значениями/);
  assert.match(mission.progressionRule, /на 1 секунду/);
  assert.match(mission.progressionRule, /изменением 0/);
});

test('repeatCount is normalized locally to avoid wasting a paid plan on arithmetic', () => {
  const plan = actionablePlan();
  plan.chapters[0].missions[0].repeatCount += 1;
  normalizePlanSchedule(plan, 14);
  assert.doesNotThrow(() => validatePlanActionability(plan, 20, 14));
  const total = plan.chapters
    .flatMap((chapter) => chapter.missions)
    .reduce((sum, mission) => sum + mission.repeatCount, 0);
  assert.equal(total, 14);
});

test('prompt and JSON contract explicitly require executable routines', () => {
  const instructions = buildPlanInstructions({ hasResearch: true });
  const execution =
    PLAN_SCHEMA.properties.chapters.items.properties.missions.items.properties.execution;

  assert.equal(PLAN_CONTRACT_VERSION, 'plan-v3');
  assert.match(PROMPT_VERSION, /actionable-routines-v3/);
  assert.match(RESEARCH_INSTRUCTIONS, /объём, частоту, длительность, отдых, технику/);
  assert.match(instructions, /execution\.kind = "routine"/);
  assert.match(instructions, /Сумма repeatCount всех миссий обязана быть ровно horizonDays/);
  assert.match(instructions, /progressionRule обязан содержать две точные ветки/);
  assert.match(instructions, /не считается шагом, упражнением или результатом миссии/);
  assert.ok(execution.anyOf.some((variant) => variant.properties.kind.enum.includes('routine')));
});

function actionablePlan() {
  return {
    title: 'Конкретный тестовый маршрут',
    domain: 'move',
    targetMetric: 'Выполнить шесть измеримых тренировок',
    summary: 'Маршрут проверяет точную дозировку без платного обращения к OpenAI.',
    safetyNotes: ['Предупреждение показывается отдельно от действий.'],
    assumptions: ['На одну миссию доступно двадцать минут.'],
    sourceLabels: ['Тестовый локальный источник'],
    chapters: Array.from({ length: 3 }, (_, chapterIndex) => ({
      title: `Глава ${chapterIndex + 1}`,
      subtitle: `Измеримый этап ${chapterIndex + 1}`,
      missions: Array.from({ length: 2 }, (_, missionIndex) => ({
        title: `Тренировка ${chapterIndex + 1}.${missionIndex + 1}`,
        description: 'Выполнить точный комплекс и записать наблюдаемый результат.',
        type: 'move',
        estimatedMinutes: 10,
        repeatCount: chapterIndex === 0 ? 3 : 2,
        xp: 20,
        steps: ['Поставь предплечья на коврик и держи корпус в прямой линии.'],
        execution: {
          kind: 'routine',
          actions: [
            {
              title: 'Планка на предплечьях',
              instruction: 'Удерживай прямую линию от затылка до пяток без провала таза.',
              sets: 3,
              quantity: 15,
              unit: 'seconds',
              unitLabel: null,
              restSeconds: 45,
              tempo: null,
              successCriterion: 'Положение сохраняется все 15 секунд.',
            },
          ],
          successCriterion: 'Завершены 3 подхода по 15 секунд.',
        },
        progressionRule:
          'Если завершены все 3 подхода, добавь 5 секунд в следующей сессии; если нет — повтори 3 по 15 секунд.',
        warning: null,
      })),
    })),
  };
}
