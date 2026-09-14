import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(testDirectory);
const compiledDirectory = join(
  tmpdir(),
  `actum-state-tests-${process.pid}-${Date.now().toString(36)}`,
);

function compileModule(sourcePath, outputName, transform = (source) => source) {
  const source = transform(readFileSync(join(projectDirectory, sourcePath), 'utf8'));
  const result = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, []);
  writeFileSync(join(compiledDirectory, outputName), result.outputText);
}

await import('node:fs/promises').then(({ mkdir }) => mkdir(compiledDirectory));
compileModule('src/domain/mission-run.ts', 'mission-run.mjs');
compileModule('src/domain/mission-run-machine.ts', 'mission-run-machine.mjs');
compileModule('src/domain/reward-policy.ts', 'reward-policy.mjs');
compileModule('src/domain/goal-program.ts', 'goal-program.mjs');
compileModule('src/lib/calendar-date.ts', 'calendar-date.mjs');
compileModule('src/state/app-state-defaults.ts', 'app-state-defaults.mjs', (source) =>
  source.replace("from '../domain/reward-policy';", "from './reward-policy.mjs';"),
);
compileModule('src/state/app-state-codec.ts', 'app-state-codec.mjs', (source) =>
  source
    .replace("from '../domain/mission-run';", "from './mission-run.mjs';")
    .replace("from '../domain/goal-program';", "from './goal-program.mjs';")
    .replace("from './app-state-defaults';", "from './app-state-defaults.mjs';"),
);
compileModule('src/state/app-state.ts', 'app-state.mjs', (source) =>
  source
    .replace("from '../domain/mission-run';", "from './mission-run.mjs';")
    .replace("from '../domain/reward-policy';", "from './reward-policy.mjs';")
    .replace("from '../domain/goal-program';", "from './goal-program.mjs';")
    .replace("from '../lib/calendar-date';", "from './calendar-date.mjs';")
    .replace("from './app-state-defaults';", "from './app-state-defaults.mjs';")
    .replace("from './app-state-codec';", "from './app-state-codec.mjs';"),
);
compileModule('src/state/app-state-repository.ts', 'app-state-repository.mjs', (source) =>
  source.replace("from './app-state-codec';", "from './app-state-codec.mjs';"),
);
compileModule('src/state/app-commands.ts', 'app-commands.mjs', (source) =>
  source
    .replace("from '@/domain/mission-run';", "from './mission-run.mjs';")
    .replace("from '@/lib/calendar-date';", "from './calendar-date.mjs';"),
);

const {
  createMissionRun,
  isMissionRun,
  isMissionRunComplete,
  isMissionRunSuccessful,
  missionRunSummary,
} = await import(pathToFileURL(join(compiledDirectory, 'mission-run.mjs')).href);
const {
  advanceMissionRunTimedStage,
  checkpointMissionRunWork,
  completeCounterMissionRunSet,
  completeSimpleMissionRunBlock,
  completeTimerMissionRunSet,
  continueMissionRunAfterReview,
  skipMissionRunBlock,
  startMissionRunWork,
} = await import(pathToFileURL(join(compiledDirectory, 'mission-run-machine.mjs')).href);
const { addCalendarDaysToKey, formatCalendarDate } = await import(
  pathToFileURL(join(compiledDirectory, 'calendar-date.mjs')).href
);
const {
  REWARD_POLICY,
  missionReward,
  selectTwinProjection,
} = await import(pathToFileURL(join(compiledDirectory, 'reward-policy.mjs')).href);
const {
  GOAL_DURATION_CONFIG,
  assessmentActualFromMissionRun,
  canonicalMetricUnit,
  createGoalProgram,
  goalDurationEndDate,
  goalDurationLabel,
  goalMetricProgress,
  inferGoalDuration,
  latestProgramActual,
  parseLegacyGoalTarget,
  programTargetReached,
} = await import(pathToFileURL(join(compiledDirectory, 'goal-program.mjs')).href);
const {
  APP_STATE_STORAGE_KEY,
  appStateReducer,
  createInitialAppState,
  getCurrentMission,
  restoreAppState,
} = await import(pathToFileURL(join(compiledDirectory, 'app-state.mjs')).href);
const { createAppStateRepository } = await import(
  pathToFileURL(join(compiledDirectory, 'app-state-repository.mjs')).href
);
const { createAppCommands } = await import(
  pathToFileURL(join(compiledDirectory, 'app-commands.mjs')).href
);

process.on('exit', () => rmSync(compiledDirectory, { recursive: true, force: true }));

const T0 = '2026-08-01T09:00:00.000Z';
const T1 = '2026-08-01T09:01:00.000Z';
const T2 = '2026-08-01T09:02:00.000Z';

function generatedGoal() {
  const target = {
    userStatement: 'Read ten pages',
    normalizedMetric: 'pages read',
    value: 10,
    unit: 'pages',
  };
  return {
    goal: {
      id: 'goal-1',
      rawPrompt: 'Read ten pages',
      title: 'Read ten pages',
      domain: 'read',
      targetDate: '2026-09-01T00:00:00.000Z',
      targetMetric: '10 pages',
      program: createGoalProgram({ duration: 'month', target }),
      status: 'active',
      createdAt: T0,
    },
    plan: {
      id: 'plan-1',
      version: 6,
      createdAt: T0,
      dailyMinutes: 15,
      horizonDays: 1,
      summary: 'Concrete session',
      cycleNumber: 1,
      totalCycles: 1,
      cycleGoal: 'Read and measure ten pages.',
      assessment: {
        dayNumber: 1,
        blockIndex: 0,
        metric: 'pages read',
        targetValue: 10,
        targetUnit: 'pages',
      },
      chapters: [{ id: 'chapter-1', title: 'Start', subtitle: 'Start', order: 1 }],
      missions: [
        {
          id: 'mission-1',
          chapterId: 'chapter-1',
          sequence: 1,
          title: 'Read',
          description: 'Read and record the result.',
          type: 'read',
          estimatedMinutes: 15,
          xp: 20,
          outcome: 'pending',
          execution: {
            kind: 'in_app',
            successCriterion: 'Both blocks meet their targets.',
            blocks: [
              {
                kind: 'counter',
                title: 'Pages',
                instruction: 'Read ten pages.',
                sets: 1,
                targetPerSet: 10,
                unit: 'pages',
                workSecondsPerSet: 600,
                restSeconds: 0,
                successCriterion: 'Ten pages logged.',
              },
              {
                kind: 'text_log',
                title: 'Recall',
                prompt: 'Write one thing you remember.',
                minCharacters: 10,
                maxCharacters: 200,
                estimatedSeconds: 120,
                successCriterion: 'A note is saved.',
              },
            ],
          },
        },
      ],
      research: {
        method: 'local-curated-v1',
        confidence: 'high',
        safetyNotes: [],
        assumptions: [],
        sourceLabels: [],
      },
    },
  };
}

function stateWithGoal() {
  return appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedGoal(),
    now: T0,
  });
}

test('reward policy keeps outcome rewards and initial character meters in one contract', () => {
  assert.deepEqual(missionReward(20, 'completed'), {
    xpDelta: 20,
    energyDelta: 6,
    worldLightDelta: 7,
  });
  assert.deepEqual(missionReward(20, 'partial'), {
    xpDelta: 9,
    energyDelta: -2,
    worldLightDelta: 2,
  });
  assert.deepEqual(missionReward(20, 'skipped'), {
    xpDelta: 0,
    energyDelta: -10,
    worldLightDelta: -5,
  });

  const initial = createInitialAppState(T0);
  assert.equal(initial.character.energy, REWARD_POLICY.initialEnergy);
  assert.equal(initial.character.worldLight, REWARD_POLICY.initialWorldLight);
});

test('twin projection applies the same full and partial reward rules without changing its baseline', () => {
  const missions = [
    { xp: 20, outcome: 'completed' },
    { xp: 21, outcome: 'partial' },
    { xp: 30, outcome: 'skipped' },
    { xp: 40, outcome: 'pending' },
  ];
  const projection = selectTwinProjection(missions, [
    { xpDelta: 20 },
    { xpDelta: 9 },
    { xpDelta: 0 },
  ]);

  assert.deepEqual(projection, {
    completed: 1,
    partial: 1,
    reported: 3,
    skipped: 1,
    projectedXp: 71,
    actualXp: 29,
    adherence: (1 + 0.45) / 3,
    adherenceBand: 'recoverable',
    potentialLevel: 1,
    potentialEnergy: 94,
    potentialLight: 39,
  });

  const unreported = selectTwinProjection(
    missions.map((mission) => ({ ...mission, outcome: 'pending' })),
    [],
  );
  assert.equal(unreported.projectedXp, 20);
  assert.equal(unreported.potentialEnergy, REWARD_POLICY.initialEnergy);
  assert.equal(unreported.potentialLight, REWARD_POLICY.initialWorldLight);
  assert.equal(unreported.adherenceBand, 'unreported');
});

test('app-state repository owns storage encoding while preserving the stable schema contract', async () => {
  const values = new Map();
  const storage = {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
  const repository = createAppStateRepository(storage);
  assert.equal((await repository.load()).source, 'empty');

  const state = createInitialAppState(T0);
  await repository.save(state);
  assert.equal(typeof values.get(APP_STATE_STORAGE_KEY), 'string');
  assert.deepEqual(await repository.load(), {
    status: 'ready',
    source: 'stored',
    state,
    migrated: false,
  });

  await repository.clear();
  assert.equal(values.has(APP_STATE_STORAGE_KEY), false);
});

test('application commands coordinate domain actions with an injected clock and no React dependency', () => {
  const state = stateWithGoal();
  const actions = [];
  const commands = createAppCommands({
    state,
    dispatch: (action) => actions.push(action),
    now: () => new Date(T1),
    canSkipMissionDays: true,
  });

  const run = commands.beginMissionRun('mission-1');
  assert.ok(run);
  assert.equal(run.startedAt, T1);
  assert.deepEqual(actions[0], { type: 'begin-mission-run', run, now: T1 });

  commands.restartActivePlan('plan-1');
  assert.deepEqual(actions[1], {
    type: 'restart-active-plan',
    planId: 'plan-1',
    startDate: '2026-08-01',
    now: T1,
  });

  commands.skipMissionForTesting('not-current');
  assert.equal(actions.length, 2);
  commands.skipMissionForTesting('mission-1');
  assert.deepEqual(actions[2], {
    type: 'skip-mission-for-testing',
    missionId: 'mission-1',
    checkInId: `checkin-${Date.parse(T1).toString(36)}`,
    now: T1,
  });

  const productionActions = [];
  const productionCommands = createAppCommands({
    state,
    dispatch: (action) => productionActions.push(action),
    now: () => new Date(T1),
    canSkipMissionDays: false,
  });
  productionCommands.skipMissionForTesting('mission-1');
  assert.deepEqual(productionActions, []);
});

function completedCheckpoint(run, targetMet = true) {
  const checkpoint = structuredClone(run);
  checkpoint.cursor = { blockIndex: 1, setIndex: 0, stage: 'review' };
  checkpoint.stageStartedAt = T1;
  checkpoint.stageEndsAt = undefined;
  const counter = checkpoint.blockResults[0];
  assert.equal(counter.kind, 'counter');
  counter.completed = true;
  counter.criterionMet = true;
  counter.startedAt = T0;
  counter.completedAt = T1;
  counter.sets[0].actualQuantity = targetMet ? 10 : 8;
  counter.sets[0].actualDurationSeconds = 590;
  counter.sets[0].targetMet = targetMet;
  counter.sets[0].startedAt = T0;
  counter.sets[0].completedAt = T1;
  const textLog = checkpoint.blockResults[1];
  assert.equal(textLog.kind, 'text_log');
  textLog.value = 'A concrete recollection.';
  textLog.completed = true;
  textLog.criterionMet = true;
  textLog.startedAt = T1;
  textLog.completedAt = T2;
  return checkpoint;
}

function generatedProgramGoal({
  duration = 'half-year',
  cycleNumber = 1,
  targetValue = 100,
  targetUnit = 'pages',
  targetStatement = 'Read one hundred pages',
  targetCycleNumber,
  targetDate,
} = {}) {
  const generated = generatedGoal();
  const target = {
    userStatement: targetStatement,
    normalizedMetric: targetUnit ? `${targetUnit} result` : 'qualitative result',
    value: targetValue,
    unit: targetUnit,
  };
  generated.goal.rawPrompt = targetStatement;
  generated.goal.targetMetric = target.normalizedMetric;
  generated.goal.program = createGoalProgram({ duration, target, activeCycle: cycleNumber });
  generated.plan.id = `plan-cycle-${cycleNumber}`;
  generated.plan.cycleNumber = cycleNumber;
  generated.plan.totalCycles = GOAL_DURATION_CONFIG[duration].totalCycles;
  generated.plan.cycleGoal = `Cycle ${cycleNumber} assessment`;
  if (targetCycleNumber !== undefined) {
    generated.plan.version = 7;
    generated.plan.targetCycleNumber = targetCycleNumber;
  }
  if (targetDate !== undefined) generated.goal.targetDate = targetDate;
  generated.plan.assessment = {
    dayNumber: 1,
    blockIndex: 0,
    metric: target.normalizedMetric,
    targetValue,
    targetUnit,
  };
  return generated;
}

function finishProgramMission(
  state,
  { actual = 10, outcome = 'completed', now = T2, note } = {},
) {
  const mission = state.activePlan.missions[0];
  const run = createMissionRun(mission, T0);
  let next = appStateReducer(state, { type: 'begin-mission-run', run, now: T0 });
  const checkpoint = completedCheckpoint(run, actual >= 10);
  checkpoint.blockResults[0].sets[0].actualQuantity = actual;
  checkpoint.blockResults[0].sets[0].targetMet = actual >= 10;
  next = appStateReducer(next, {
    type: 'finish-mission-run',
    run: checkpoint,
    finishReason: 'completed',
    now: T1,
  });
  return appStateReducer(next, {
    type: 'report-mission',
    missionId: mission.id,
    runId: run.id,
    outcome,
    note,
    checkInId: `checkin-${outcome}-${actual}`,
    now,
  });
}

function generatedEarlyNumericGoal({ primaryUnit = 'pages', primaryBlockIndex = 0 } = {}) {
  const generated = generatedProgramGoal({
    targetValue: 10,
    targetUnit: 'pages',
    targetCycleNumber: 1,
  });
  const baseline = {
    userStatement: 'No pages read yet',
    normalizedMetric: 'pages result',
    value: 0,
    unit: 'pages',
    calculationRule: 'Count pages recorded in the primary block.',
  };
  generated.goal.baseline = baseline;
  generated.plan.baseline = structuredClone(baseline);
  const current = generated.plan.missions[0];
  current.dayNumber = 10;
  current.sequence = 10;
  current.execution.primaryBlockIndex = primaryBlockIndex;
  current.execution.blocks[0].unit = primaryUnit;
  const next = structuredClone(current);
  next.id = 'mission-day-11';
  next.dayNumber = 11;
  next.sequence = 11;
  generated.plan.missions = [current, next];
  generated.plan.horizonDays = 30;
  return generated;
}

function reportFirstProgramMission(
  state,
  { actual, outcome = 'completed', targetMet = true } = {},
) {
  const mission = state.activePlan.missions[0];
  const run = createMissionRun(mission, T0);
  let next = appStateReducer(state, { type: 'begin-mission-run', run, now: T0 });
  const checkpoint = completedCheckpoint(run, targetMet);
  checkpoint.blockResults[0].sets[0].actualQuantity = actual;
  checkpoint.blockResults[0].sets[0].targetMet = targetMet;
  next = appStateReducer(next, {
    type: 'finish-mission-run',
    run: checkpoint,
    finishReason: 'completed',
    now: T1,
  });
  return appStateReducer(next, {
    type: 'report-mission',
    missionId: mission.id,
    runId: run.id,
    outcome,
    checkInId: `early-${outcome}-${actual}`,
    now: T2,
  });
}

test('English built-in labels migrate without translating user content or losing state', () => {
  const original = stateWithGoal();
  original.character.buffs = ['Первый шаг', 'Ясное намерение', 'Импульс'];
  original.character.debuffs = ['Туман сомнений'];
  original.activeGoal.rawPrompt = 'Моя личная цель';
  original.activePlan.summary = 'Мой сохранённый план';
  const note = 'Пропущено в DEV-режиме.';
  original.checkIns = ['dev-skip', 'user'].map((provenance) => ({
    id: provenance,
    missionId: 'mission-1',
    outcome: 'skipped',
    comment: note,
    note,
    provenance,
    xpDelta: 0,
    energyDelta: 0,
    createdAt: T0,
  }));

  const persisted = JSON.parse(JSON.stringify(original));
  const restored = restoreAppState(JSON.stringify(persisted));
  assert.equal(restored.status, 'ready');
  assert.equal(restored.migrated, true);
  assert.deepEqual(restored.state.character.buffs, ['First step', 'Clear intention', 'Momentum']);
  assert.deepEqual(restored.state.character.debuffs, ['Fog of doubt']);
  assert.equal(restored.state.checkIns[0].note, 'Skipped in development mode.');
  assert.equal(restored.state.checkIns[0].comment, 'Skipped in development mode.');
  assert.deepEqual(restored.state.checkIns[1], original.checkIns[1]);
  assert.deepEqual(restored.state.activeGoal, persisted.activeGoal);
  assert.deepEqual(restored.state.activePlan, persisted.activePlan);
  assert.deepEqual(restored.state.missionRuns, persisted.missionRuns);
  assert.equal(original.character.buffs[0], 'Первый шаг');
  assert.equal(restoreAppState(JSON.stringify(restored.state)).migrated, false);
});

test('calendar labels use English month names without shifting calendar days', () => {
  assert.equal(formatCalendarDate('2026-09-14'), 'Sep 14');
  assert.equal(formatCalendarDate('2026-09-14', 'long'), 'September 14');
  assert.equal(formatCalendarDate('2026-02-30'), undefined);
});

test('goal duration domain keeps the three fixed product choices and inclusive end dates', () => {
  assert.deepEqual(GOAL_DURATION_CONFIG, {
    month: { totalDays: 30, totalCycles: 1 },
    'half-year': { totalDays: 180, totalCycles: 6 },
    year: { totalDays: 365, totalCycles: 12 },
  });
  assert.equal(goalDurationLabel('month'), '1 month');
  assert.equal(goalDurationLabel('half-year'), '6 months');
  assert.equal(goalDurationLabel('year'), '1 year');
  assert.equal(goalDurationEndDate(T0, 'month'), '2026-08-30T09:00:00.000Z');
  assert.equal(goalDurationEndDate(T0, 'year'), '2027-07-31T09:00:00.000Z');
  assert.equal(goalDurationEndDate('invalid', 'year'), undefined);
  assert.equal(inferGoalDuration('Шесть месяцев'), 'half-year');
  assert.equal(inferGoalDuration('пол года'), 'half-year');
  assert.equal(inferGoalDuration('6 months'), 'half-year');
  assert.equal(inferGoalDuration('12 months'), 'year');
  assert.equal(inferGoalDuration('half year'), 'half-year');
  assert.equal(inferGoalDuration('half a year'), 'half-year');
  assert.equal(inferGoalDuration('six months'), 'half-year');
  assert.equal(inferGoalDuration('twelve months'), 'year');
  assert.deepEqual(parseLegacyGoalTarget({
    rawPrompt: 'Хочу задерживать дыхание под водой на 10 минут',
    targetMetric: 'Статическая задержка дыхания',
  }), {
    userStatement: 'Хочу задерживать дыхание под водой на 10 минут',
    normalizedMetric: 'Статическая задержка дыхания',
    value: 600,
    unit: 'seconds',
  });
});

test('program dates use Europe/Istanbul calendar days around local midnight', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Istanbul';
  try {
    // 22:30Z is already the next local day in Istanbul. The helper preserves
    // that local wall-clock date instead of truncating the input to UTC midnight.
    assert.equal(
      goalDurationEndDate('2026-09-03T22:30:00.000Z', 'month'),
      '2026-10-02T22:30:00.000Z',
    );
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('metric direction and canonical units support increasing and decreasing goals', () => {
  assert.equal(canonicalMetricUnit('секунд'), 'seconds');
  assert.equal(canonicalMetricUnit('Повторения'), 'reps');
  assert.equal(canonicalMetricUnit('custom score'), 'custom score');

  const decreasingBaseline = { value: 10, unit: 'страниц' };
  const decreasingTarget = {
    userStatement: 'Reduce the backlog to five pages',
    normalizedMetric: 'remaining pages',
    value: 5,
    unit: 'pages',
  };
  assert.equal(programTargetReached(
    decreasingTarget,
    { measuredValue: 7, unit: 'страницы' },
    decreasingBaseline,
  ), false);
  assert.equal(programTargetReached(
    decreasingTarget,
    { measuredValue: 5, unit: 'страниц' },
    decreasingBaseline,
  ), true);
  assert.equal(programTargetReached(
    decreasingTarget,
    { measuredValue: 4, unit: 'seconds' },
    decreasingBaseline,
  ), false);

  assert.equal(goalMetricProgress(
    decreasingBaseline,
    { value: 10, unit: 'pages' },
    decreasingTarget,
  ), 0);
  assert.equal(goalMetricProgress(
    decreasingBaseline,
    { value: 8, unit: 'страницы' },
    decreasingTarget,
  ), 0.4);
  assert.equal(goalMetricProgress(
    decreasingBaseline,
    { value: 5, unit: 'pages' },
    decreasingTarget,
  ), 1);
  assert.equal(goalMetricProgress(
    decreasingBaseline,
    { value: 2, unit: 'pages' },
    decreasingTarget,
  ), 1);
  assert.equal(goalMetricProgress(
    decreasingBaseline,
    { value: 8, unit: 'seconds' },
    decreasingTarget,
  ), undefined);

  assert.equal(goalMetricProgress(
    { value: 80, unit: 'секунд' },
    { value: 340, unit: 'seconds' },
    { value: 600, unit: 'секунды' },
  ), 0.5);
});

test('assessment reads the maximum recorded timer or counter set from the explicit block only', () => {
  const counterGoal = generatedGoal();
  const counterRun = createMissionRun(counterGoal.plan.missions[0], T0);
  assert.deepEqual(
    assessmentActualFromMissionRun(counterGoal.plan, { [counterRun.missionId]: counterRun }),
    { measuredValue: null, unit: null },
  );
  counterRun.blockResults[0].sets[0].actualQuantity = 17;
  counterRun.blockResults[0].sets[0].completedAt = T1;
  assert.deepEqual(
    assessmentActualFromMissionRun(counterGoal.plan, { [counterRun.missionId]: counterRun }),
    { measuredValue: 17, unit: 'pages' },
  );

  const timerGoal = generatedGoal();
  timerGoal.plan.missions[0].execution = {
    kind: 'in_app',
    successCriterion: 'Record both holds.',
    blocks: [{
      kind: 'timer',
      title: 'Hold',
      instruction: 'Hold.',
      sets: 2,
      durationSecondsPerSet: 30,
      restSeconds: 30,
      successCriterion: 'Both holds recorded.',
    }],
  };
  timerGoal.plan.assessment = {
    dayNumber: 1,
    blockIndex: 0,
    metric: 'hold duration',
    targetValue: 2,
    targetUnit: 'minutes',
  };
  const timerRun = createMissionRun(timerGoal.plan.missions[0], T0);
  timerRun.blockResults[0].sets[0].actualDurationSeconds = 45;
  timerRun.blockResults[0].sets[1].actualDurationSeconds = 90;
  timerRun.blockResults[0].sets[0].completedAt = T1;
  timerRun.blockResults[0].sets[1].completedAt = T2;
  assert.deepEqual(
    assessmentActualFromMissionRun(timerGoal.plan, { [timerRun.missionId]: timerRun }),
    { measuredValue: 1.5, unit: 'minutes' },
  );
  timerGoal.plan.assessment.blockIndex = 1;
  assert.deepEqual(
    assessmentActualFromMissionRun(timerGoal.plan, { [timerRun.missionId]: timerRun }),
    { measuredValue: null, unit: null },
  );
});

test('assessment ignores unfinished sets and chooses the best value in a decreasing program', () => {
  const generated = generatedGoal();
  generated.goal.baseline = {
    userStatement: 'Ten pages remain',
    normalizedMetric: 'remaining pages',
    value: 10,
    unit: 'pages',
    calculationRule: 'Count remaining pages.',
  };
  generated.plan.baseline = structuredClone(generated.goal.baseline);
  generated.plan.assessment = {
    dayNumber: 1,
    blockIndex: 0,
    metric: 'remaining pages',
    targetValue: 5,
    targetUnit: 'pages',
  };
  generated.plan.missions[0].execution.blocks[0].sets = 3;
  generated.plan.missions[0].execution.blocks[0].targetPerSet = 5;

  const run = createMissionRun(generated.plan.missions[0], T0);
  run.blockResults[0].sets[0].actualQuantity = 7;
  run.blockResults[0].sets[0].completedAt = T1;
  run.blockResults[0].sets[1].actualQuantity = 5;
  run.blockResults[0].sets[1].completedAt = T2;
  // The initialized third set remains zero but was never performed.

  assert.deepEqual(
    assessmentActualFromMissionRun(generated.plan, { [run.missionId]: run }),
    { measuredValue: 5, unit: 'pages' },
  );
});

test('cycle completion records partial assessment once without completing a longer goal', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal(),
    now: T0,
  });
  state = finishProgramMission(state, { actual: 8, outcome: 'partial' });

  assert.equal(state.activeGoal.status, 'active');
  assert.deepEqual(state.activeGoal.program.completedCycles, [{
    cycleNumber: 1,
    completedAt: T2,
    measuredValue: 8,
    unit: 'pages',
  }]);
  const duplicate = appStateReducer(state, {
    type: 'report-mission',
    missionId: 'mission-1',
    runId: state.missionRuns['mission-1'].id,
    outcome: 'partial',
    checkInId: 'duplicate',
    now: T2,
  });
  assert.equal(duplicate, state);
  assert.equal(duplicate.activeGoal.program.completedCycles.length, 1);
});

test('numeric assessment may finish early, while a missed final numeric target pauses the goal', () => {
  let early = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal({ targetValue: 10 }),
    now: T0,
  });
  early = finishProgramMission(early, { actual: 10 });
  assert.equal(early.activeGoal.status, 'completed');
  assert.equal(early.checkIns[0].provenance, 'user');
  assert.equal(appStateReducer(early, {
    type: 'advance-goal-cycle',
    generated: generatedProgramGoal({ cycleNumber: 2, targetValue: 10 }),
    now: T2,
  }), early);

  let missed = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal({ duration: 'month', targetValue: 20 }),
    now: T0,
  });
  missed = finishProgramMission(missed, { actual: 10 });
  assert.equal(missed.activeGoal.status, 'paused');

  let qualitative = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal({
      duration: 'month',
      targetValue: null,
      targetUnit: null,
      targetStatement: 'Build a stable reading habit',
    }),
    now: T0,
  });
  qualitative = finishProgramMission(qualitative, { actual: 10 });
  assert.equal(qualitative.activeGoal.status, 'completed');

  const decreasingGenerated = generatedProgramGoal({ duration: 'month', targetValue: 5 });
  decreasingGenerated.goal.baseline = {
    userStatement: 'Ten pages remain',
    normalizedMetric: 'remaining pages',
    value: 10,
    unit: 'страниц',
    calculationRule: 'Count the remaining pages.',
  };
  let decreasingMiss = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: structuredClone(decreasingGenerated),
    now: T0,
  });
  decreasingMiss = finishProgramMission(decreasingMiss, { actual: 7, outcome: 'partial' });
  assert.equal(decreasingMiss.activeGoal.status, 'paused');

  let decreasingHit = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: decreasingGenerated,
    now: T0,
  });
  decreasingHit = finishProgramMission(decreasingHit, { actual: 5, outcome: 'partial' });
  assert.equal(decreasingHit.activeGoal.status, 'completed');
});

test('plan-v7 completes a numeric goal on day 10 from its successful primary block', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedEarlyNumericGoal(),
    now: T0,
  });
  assert.equal(getCurrentMission(state).dayNumber, 10);

  state = reportFirstProgramMission(state, { actual: 10 });

  assert.equal(state.activeGoal.status, 'completed');
  assert.equal(state.activePlan.missions[0].outcome, 'completed');
  assert.equal(state.activePlan.missions[1].outcome, 'pending');
  assert.deepEqual(state.activeGoal.program.completedCycles, []);
  assert.deepEqual(state.activeGoal.program.achievement, {
    cycleNumber: 1,
    completedAt: T2,
    measuredValue: 10,
    unit: 'pages',
  });
  const current = latestProgramActual(state.activeGoal.program, state.activeGoal.baseline);
  assert.deepEqual(current, { measuredValue: 10, unit: 'pages' });
  assert.equal(goalMetricProgress(
    state.activeGoal.baseline,
    { value: current.measuredValue, unit: current.unit },
    state.activeGoal.program.target,
  ), 1);
  assert.equal(getCurrentMission(state), undefined);

  const persisted = JSON.parse(JSON.stringify(state));
  assert.deepEqual(restoreAppState(JSON.stringify(state)), {
    status: 'ready',
    source: 'stored',
    state: persisted,
    migrated: false,
  });

  const restarted = appStateReducer(state, {
    type: 'restart-active-plan',
    planId: state.activePlan.id,
    startDate: '2026-08-02',
    now: '2026-08-02T09:00:00.000Z',
  });
  assert.equal(restarted.activeGoal.status, 'active');
  assert.equal(restarted.activeGoal.program.achievement, undefined);
  assert.deepEqual(
    latestProgramActual(restarted.activeGoal.program, restarted.activeGoal.baseline),
    { measuredValue: 0, unit: 'pages' },
  );
});

test('plan-v7 completes a seconds goal from a manually finished overtime timer before day 30', () => {
  const generated = generatedProgramGoal({
    targetValue: 60,
    targetUnit: 'seconds',
    targetStatement: 'Hold for sixty seconds',
    targetCycleNumber: 1,
  });
  const baseline = {
    userStatement: 'Current hold is twenty seconds',
    normalizedMetric: 'hold duration',
    value: 20,
    unit: 'seconds',
    calculationRule: 'Use the completed primary timer duration.',
  };
  const timerBlock = {
    kind: 'timer',
    title: 'Hold',
    instruction: 'Hold through the timer.',
    sets: 1,
    durationSecondsPerSet: 30,
    restSeconds: 0,
    successCriterion: 'The timer is recorded.',
  };
  generated.goal.baseline = baseline;
  generated.plan.baseline = structuredClone(baseline);
  generated.plan.missions[0].dayNumber = 10;
  generated.plan.missions[0].sequence = 10;
  generated.plan.missions[0].execution = {
    kind: 'in_app',
    primaryBlockIndex: 0,
    blocks: [timerBlock],
    successCriterion: 'The timer is recorded.',
  };
  const nextMission = structuredClone(generated.plan.missions[0]);
  nextMission.id = 'timer-day-11';
  nextMission.dayNumber = 11;
  nextMission.sequence = 11;
  generated.plan.missions.push(nextMission);

  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated,
    now: T0,
  });
  const mission = state.activePlan.missions[0];
  const initial = createMissionRun(mission, T0);
  state = appStateReducer(state, { type: 'begin-mission-run', run: initial, now: T0 });
  const preparing = startMissionRunWork(initial, [timerBlock], T0);
  assert.ok(preparing);
  const started = advanceMissionRunTimedStage(preparing, [timerBlock]);
  assert.ok(started);
  const overtime = advanceMissionRunTimedStage(started, [timerBlock]);
  assert.ok(overtime);
  assert.equal(overtime.cursor.stage, 'work');
  assert.equal(overtime.stageEndsAt, undefined);
  const recorded = completeTimerMissionRunSet(
    overtime,
    timerBlock,
    false,
    '2026-08-01T09:01:08.000Z',
  );
  assert.ok(recorded);
  assert.equal(recorded.blockResults[0].sets[0].actualDurationSeconds, 65);
  recorded.blockResults[0].criterionMet = true;
  const transition = continueMissionRunAfterReview(
    recorded,
    [timerBlock],
    '2026-08-01T09:01:09.000Z',
  );
  assert.equal(transition.kind, 'finish');
  state = appStateReducer(state, {
    type: 'finish-mission-run',
    run: transition.run,
    finishReason: transition.reason,
    now: '2026-08-01T09:01:09.000Z',
  });
  state = appStateReducer(state, {
    type: 'report-mission',
    missionId: mission.id,
    runId: initial.id,
    outcome: 'completed',
    checkInId: 'timer-overtime-goal',
    now: '2026-08-01T09:01:10.000Z',
  });

  assert.equal(state.activeGoal.status, 'completed');
  assert.deepEqual(state.activeGoal.program.completedCycles, []);
  assert.deepEqual(state.activeGoal.program.achievement, {
    cycleNumber: 1,
    completedAt: '2026-08-01T09:01:10.000Z',
    measuredValue: 65,
    unit: 'seconds',
  });
  assert.equal(state.activePlan.missions[1].outcome, 'pending');
});

test('a successful primary block below the numeric goal keeps plan-v7 active', () => {
  const generated = generatedEarlyNumericGoal();
  generated.plan.missions[0].execution.blocks[0].targetPerSet = 8;
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated,
    now: T0,
  });

  state = reportFirstProgramMission(state, { actual: 8 });

  assert.equal(state.activeGoal.status, 'active');
  assert.equal(getCurrentMission(state).dayNumber, 11);
});

test('an incompatible primary-block unit cannot complete a numeric goal', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedEarlyNumericGoal({ primaryUnit: 'items' }),
    now: T0,
  });

  state = reportFirstProgramMission(state, { actual: 10 });

  assert.equal(state.activeGoal.status, 'active');
  assert.equal(getCurrentMission(state).dayNumber, 11);
});

test('DEV skip cannot trigger plan-v7 numeric early completion', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedEarlyNumericGoal(),
    now: T0,
  });

  state = appStateReducer(state, {
    type: 'skip-mission-for-testing',
    missionId: state.activePlan.missions[0].id,
    checkInId: 'dev-skip-day-10',
    now: T2,
  });

  assert.equal(state.activeGoal.status, 'active');
  assert.equal(state.checkIns[0].provenance, 'dev-skip');
  assert.equal(getCurrentMission(state).dayNumber, 11);
});

test('non-completed outcomes and legacy missions cannot trigger numeric early completion', () => {
  for (const outcome of ['partial', 'skipped']) {
    let state = appStateReducer(createInitialAppState(T0), {
      type: 'create-goal',
      generated: generatedEarlyNumericGoal(),
      now: T0,
    });
    state = reportFirstProgramMission(state, { actual: 10, outcome });
    assert.equal(state.activeGoal.status, 'active');
  }

  const legacy = generatedEarlyNumericGoal();
  legacy.plan.version = 6;
  delete legacy.plan.targetCycleNumber;
  delete legacy.plan.missions[0].execution.primaryBlockIndex;
  let legacyState = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: legacy,
    now: T0,
  });
  legacyState = reportFirstProgramMission(legacyState, { actual: 10 });
  assert.equal(legacyState.activeGoal.status, 'active');
});

test('plan-v7 qualitative goal completes when every mission succeeds in its target cycle', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal({
      targetValue: null,
      targetUnit: null,
      targetStatement: 'Build a stable reading habit',
      targetCycleNumber: 1,
    }),
    now: T0,
  });

  state = finishProgramMission(state, { actual: 10, outcome: 'completed' });

  assert.equal(state.activeGoal.status, 'completed');
  assert.equal(state.activeGoal.program.activeCycle, 1);
  assert.equal(state.activeGoal.program.totalCycles, 6);
});

test('plan-v7 qualitative goal stays active before its target cycle', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal({
      targetValue: null,
      targetUnit: null,
      targetStatement: 'Build a stable reading habit',
      targetCycleNumber: 2,
    }),
    now: T0,
  });

  state = finishProgramMission(state, { actual: 10, outcome: 'completed' });

  assert.equal(state.activeGoal.status, 'active');
  assert.equal(state.activeGoal.program.completedCycles.length, 1);
});

test('a DEV skip cannot complete a plan-v7 qualitative goal in its target cycle', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal({
      targetValue: null,
      targetUnit: null,
      targetStatement: 'Build a stable reading habit',
      targetCycleNumber: 1,
    }),
    now: T0,
  });

  state = appStateReducer(state, {
    type: 'skip-mission-for-testing',
    missionId: state.activePlan.missions[0].id,
    checkInId: 'dev-skip-qualitative-target',
    now: T2,
  });

  assert.equal(state.activeGoal.status, 'active');
  assert.equal(state.checkIns[0].provenance, 'dev-skip');
});

test('a user partial pauses plan-v7 qualitative goal at its final target cycle', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal({
      duration: 'month',
      targetValue: null,
      targetUnit: null,
      targetStatement: 'Build a stable reading habit',
      targetCycleNumber: 1,
    }),
    now: T0,
  });

  state = finishProgramMission(state, { actual: 10, outcome: 'partial' });

  assert.equal(state.activeGoal.status, 'paused');
  assert.equal(state.checkIns[0].provenance, 'user');
});

test('a user skip pauses plan-v7 qualitative goal at its final target cycle', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal({
      duration: 'month',
      targetValue: null,
      targetUnit: null,
      targetStatement: 'Build a stable reading habit',
      targetCycleNumber: 1,
    }),
    now: T0,
  });

  state = finishProgramMission(state, { actual: 10, outcome: 'skipped' });

  assert.equal(state.activeGoal.status, 'paused');
  assert.equal(state.checkIns[0].provenance, 'user');
});

test('a user comment cannot impersonate immutable DEV-skip provenance', () => {
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: generatedProgramGoal({ targetValue: 10 }),
    now: T0,
  });
  state = finishProgramMission(state, {
    actual: 10,
    note: 'Пропущено в DEV-режиме.',
  });

  assert.equal(state.checkIns[0].note, 'Пропущено в DEV-режиме.');
  assert.equal(state.checkIns[0].provenance, 'user');
  assert.equal(state.activeGoal.status, 'completed');
});

test('advanceGoalCycle accepts only the exact next compatible cycle and preserves the program identity', () => {
  const firstGenerated = generatedProgramGoal();
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: firstGenerated,
    now: T0,
  });
  state = finishProgramMission(state, { actual: 10 });
  const character = structuredClone(state.character);
  const identity = {
    id: state.activeGoal.id,
    createdAt: state.activeGoal.createdAt,
    targetDate: state.activeGoal.targetDate,
  };

  const skippedCycle = generatedProgramGoal({ cycleNumber: 3 });
  assert.equal(appStateReducer(state, {
    type: 'advance-goal-cycle',
    generated: skippedCycle,
    now: T2,
  }), state);

  const metricDrift = generatedProgramGoal({ cycleNumber: 2 });
  metricDrift.goal.program.target.normalizedMetric = 'different pages metric';
  assert.equal(appStateReducer(state, {
    type: 'advance-goal-cycle',
    generated: metricDrift,
    now: T2,
  }), state);

  const second = generatedProgramGoal({ cycleNumber: 2 });
  second.goal.program.target.unit = 'страниц';
  second.plan.baseline = {
    userStatement: 'A newer reading check measured twelve pages',
    normalizedMetric: 'pages result',
    value: 12,
    unit: 'pages',
    calculationRule: 'Count pages in the explicit cycle baseline check.',
  };
  second.goal.id = 'replacement-id-that-must-not-win';
  const actions = [];
  createAppCommands({
    state,
    dispatch: (action) => actions.push(action),
    now: () => new Date(T2),
    canSkipMissionDays: true,
  }).advanceGoalCycle(second);
  assert.deepEqual(actions, [{ type: 'advance-goal-cycle', generated: second, now: T2 }]);

  state = appStateReducer(state, actions[0]);
  assert.equal(state.activePlan.id, 'plan-cycle-2');
  assert.equal(state.activeGoal.program.activeCycle, 2);
  assert.deepEqual(state.activeGoal.program.completedCycles, [{
    cycleNumber: 1,
    completedAt: T2,
    measuredValue: 10,
    unit: 'pages',
  }]);
  assert.deepEqual({
    id: state.activeGoal.id,
    createdAt: state.activeGoal.createdAt,
    targetDate: state.activeGoal.targetDate,
  }, identity);
  assert.deepEqual(state.character, character);
  assert.deepEqual(state.checkIns, []);
  assert.deepEqual(state.missionRuns, {});
});

test('plan-v7 keeps and re-estimates a target-cycle deadline without replacing goal identity', () => {
  const firstTargetDate = '2026-09-29T09:00:00.000Z';
  const firstGenerated = generatedProgramGoal({
    duration: 'year',
    targetCycleNumber: 2,
    targetDate: firstTargetDate,
  });
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: firstGenerated,
    now: T0,
  });

  assert.equal(state.activeGoal.targetDate, firstTargetDate);
  assert.notEqual(state.activeGoal.targetDate, goalDurationEndDate(T0, 'year'));

  state = finishProgramMission(state, { actual: 10, outcome: 'partial' });
  const firstCycleResult = structuredClone(state.activeGoal.program.completedCycles);
  const originalIdentity = {
    id: state.activeGoal.id,
    createdAt: state.activeGoal.createdAt,
    target: structuredClone(state.activeGoal.program.target),
  };
  const reestimatedTargetDate = '2026-10-29T09:00:00.000Z';
  const secondGenerated = generatedProgramGoal({
    duration: 'year',
    cycleNumber: 2,
    targetCycleNumber: 3,
    targetDate: reestimatedTargetDate,
  });
  secondGenerated.goal.id = 'replacement-goal-id';
  secondGenerated.goal.createdAt = '2026-08-31T09:00:00.000Z';

  state = appStateReducer(state, {
    type: 'advance-goal-cycle',
    generated: secondGenerated,
    now: T2,
  });

  assert.equal(state.activePlan.cycleNumber, 2);
  assert.equal(state.activePlan.targetCycleNumber, 3);
  assert.equal(state.activeGoal.targetDate, reestimatedTargetDate);
  assert.deepEqual({
    id: state.activeGoal.id,
    createdAt: state.activeGoal.createdAt,
    target: state.activeGoal.program.target,
  }, originalIdentity);
  assert.deepEqual(state.activeGoal.program.completedCycles, firstCycleResult);

  const restarted = appStateReducer(state, {
    type: 'restart-active-plan',
    planId: state.activePlan.id,
    startDate: '2026-09-01',
    now: '2026-09-01T09:00:00.000Z',
  });
  assert.equal(restarted.activeGoal.targetDate, reestimatedTargetDate);
  assert.equal(restarted.activeGoal.id, originalIdentity.id);
  assert.equal(restarted.activeGoal.createdAt, originalIdentity.createdAt);
  assert.deepEqual(restarted.activeGoal.program.completedCycles, firstCycleResult);
});

test('legacy generated plans still derive their deadline from the retry-cap duration', () => {
  const legacy = generatedProgramGoal({
    duration: 'year',
    targetDate: '2026-09-29T09:00:00.000Z',
  });
  const state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: legacy,
    now: T0,
  });

  assert.equal(state.activeGoal.targetDate, goalDurationEndDate(T0, 'year'));
});

test('next-cycle explicit baseline fills a missing cycle result without replacing the program baseline', () => {
  const first = generatedProgramGoal({ targetValue: 5 });
  first.goal.baseline = {
    userStatement: 'Ten pages remain at program start',
    normalizedMetric: 'pages result',
    value: 10,
    unit: 'pages',
    calculationRule: 'Count remaining pages.',
  };
  // A migrated legacy cycle has no trustworthy machine-readable assessment.
  first.plan.assessment = undefined;

  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated: first,
    now: T0,
  });
  state = finishProgramMission(state, { actual: 7, outcome: 'partial' });
  assert.deepEqual(state.activeGoal.program.completedCycles, [{
    cycleNumber: 1,
    completedAt: T2,
    measuredValue: null,
    unit: null,
  }]);

  const second = generatedProgramGoal({ cycleNumber: 2, targetValue: 5 });
  second.goal.program.target.unit = 'страниц';
  second.plan.baseline = {
    userStatement: 'Eight pages remain now',
    normalizedMetric: 'pages result',
    value: 8,
    unit: 'страниц',
    calculationRule: 'Count remaining pages.',
  };
  state = appStateReducer(state, {
    type: 'advance-goal-cycle',
    generated: second,
    now: T2,
  });

  // Keep the original baseline: it determines that reaching five is a decrease.
  assert.equal(state.activeGoal.baseline.value, 10);
  assert.equal(state.activeGoal.baseline.unit, 'pages');
  // The explicit next-cycle input is now the latest current metric shown by UI.
  assert.deepEqual(state.activeGoal.program.completedCycles, [{
    cycleNumber: 1,
    completedAt: T2,
    measuredValue: 8,
    unit: 'страниц',
  }]);
  assert.equal(goalMetricProgress(
    state.activeGoal.baseline,
    {
      value: state.activeGoal.program.completedCycles[0].measuredValue,
      unit: state.activeGoal.program.completedCycles[0].unit,
    },
    state.activeGoal.program.target,
  ), 0.4);
});

test('schema v1 migrates additively under the stable storage key', () => {
  const original = stateWithGoal();
  const legacy = structuredClone({
    ...original,
    schemaVersion: 1,
    missionRuns: undefined,
    checkIns: [
      {
        id: 'old-checkin',
        missionId: 'old-mission',
        outcome: 'partial',
        note: 'Kept verbatim',
        xpDelta: 4,
        energyDelta: -2,
        createdAt: T0,
      },
    ],
  });
  delete legacy.missionRuns;
  delete legacy.activeGoal.program;
  delete legacy.activePlan.cycleNumber;
  delete legacy.activePlan.totalCycles;
  delete legacy.activePlan.cycleGoal;
  delete legacy.activePlan.assessment;

  const restored = restoreAppState(JSON.stringify(legacy));
  assert.equal(APP_STATE_STORAGE_KEY, 'actum.app-state.v1');
  assert.equal(restored.status, 'ready');
  if (restored.status !== 'ready') return;
  assert.equal(restored.migrated, true);
  assert.equal(restored.state.schemaVersion, 3);
  assert.equal(restored.state.activePlan.id, original.activePlan.id);
  assert.deepEqual(restored.state.checkIns, legacy.checkIns);
  assert.deepEqual(restored.state.missionRuns, {});
});

test('schema v2 migrates the saved one-year ten-minute goal without inventing progress', () => {
  const current = stateWithGoal();
  const legacy = structuredClone(current);
  legacy.schemaVersion = 2;
  legacy.activeGoal.rawPrompt = 'Хочу задерживать дыхание под водой на 10 минут';
  legacy.activeGoal.title = 'Задержка дыхания';
  legacy.activeGoal.targetMetric = 'Статическая задержка дыхания';
  legacy.activeGoal.targetTimeline = 'Год';
  legacy.activeGoal.status = 'completed';
  delete legacy.activeGoal.program;
  legacy.activePlan.version = 5;
  legacy.activePlan.horizonDays = 30;
  legacy.activePlan.targetTimeline = 'Год';
  legacy.activePlan.summary = 'Очень длинный legacy-summary, который остаётся только в info.';
  legacy.activePlan.chapters[0].title = 'Краткий стартовый цикл';
  delete legacy.activePlan.cycleNumber;
  delete legacy.activePlan.totalCycles;
  delete legacy.activePlan.cycleGoal;
  delete legacy.activePlan.assessment;
  legacy.activePlan.missions = Array.from({ length: 30 }, (_, index) => ({
    ...structuredClone(current.activePlan.missions[0]),
    id: `legacy-day-${index + 1}`,
    sequence: index + 1,
    dayNumber: index + 1,
    outcome: 'completed',
  }));
  legacy.checkIns = [];
  legacy.missionRuns = {};
  legacy.lastUpdatedAt = T2;

  const restored = restoreAppState(JSON.stringify(legacy));
  assert.equal(restored.status, 'ready');
  if (restored.status !== 'ready') return;
  assert.equal(restored.migrated, true);
  assert.equal(restored.state.schemaVersion, 3);
  assert.equal(restored.state.activeGoal.status, 'active');
  assert.equal(restored.state.activeGoal.targetDate, '2027-07-31T09:00:00.000Z');
  assert.deepEqual(restored.state.activeGoal.program.target, {
    userStatement: 'Хочу задерживать дыхание под водой на 10 минут',
    normalizedMetric: 'Статическая задержка дыхания',
    value: 600,
    unit: 'seconds',
  });
  assert.equal(restored.state.activeGoal.program.duration, 'year');
  assert.equal(restored.state.activeGoal.program.totalDays, 365);
  assert.equal(restored.state.activeGoal.program.totalCycles, 12);
  assert.equal(restored.state.activeGoal.program.activeCycle, 1);
  assert.deepEqual(
    restored.state.activeGoal.program.roadmap.slice(0, -1).map((item) => item.targetValue),
    Array.from({ length: 11 }, () => null),
  );
  assert.deepEqual(restored.state.activeGoal.program.roadmap.at(-1), {
    cycleNumber: 12,
    title: 'Cycle 12',
    focus: 'Final cycle and assessment',
    targetValue: 600,
    targetUnit: 'seconds',
  });
  assert.deepEqual(restored.state.activeGoal.program.completedCycles, [{
    cycleNumber: 1,
    completedAt: T2,
    measuredValue: null,
    unit: null,
  }]);
  assert.equal(restored.state.activePlan.cycleNumber, 1);
  assert.equal(restored.state.activePlan.totalCycles, 12);
  assert.equal(restored.state.activePlan.cycleGoal, 'Read');
  assert.equal(
    restored.state.activePlan.summary,
    'Очень длинный legacy-summary, который остаётся только в info.',
  );
  assert.equal(restored.state.activePlan.assessment, undefined);
  assert.equal(restored.state.activePlan.missions.length, 30);
});

test('corrupt and unknown future state block restoration instead of falling back for persistence', () => {
  assert.deepEqual(restoreAppState('{not-json'), { status: 'blocked', reason: 'corrupt' });
  assert.deepEqual(restoreAppState(JSON.stringify({ schemaVersion: 99 })), {
    status: 'blocked',
    reason: 'unsupported-schema',
    schemaVersion: 99,
  });
  assert.deepEqual(restoreAppState(JSON.stringify({ schemaVersion: 2 })), {
    status: 'blocked',
    reason: 'corrupt',
    schemaVersion: 2,
  });

  const corruptV3 = stateWithGoal();
  corruptV3.activeGoal.program.totalCycles = 99;
  assert.deepEqual(restoreAppState(JSON.stringify(corruptV3)), {
    status: 'blocked',
    reason: 'corrupt',
    schemaVersion: 3,
  });
});

test('stored DEV skips gain explicit provenance without reclassifying ordinary check-ins', () => {
  const legacy = stateWithGoal();
  legacy.checkIns = [
    {
      id: 'legacy-dev-skip',
      missionId: 'mission-1',
      outcome: 'skipped',
      comment: 'Пропущено в DEV-режиме.',
      note: 'Пропущено в DEV-режиме.',
      xpDelta: 0,
      energyDelta: 0,
      createdAt: T1,
    },
    {
      id: 'ordinary',
      missionId: 'mission-1',
      outcome: 'partial',
      comment: 'Обычная запись',
      note: 'Обычная запись',
      xpDelta: 5,
      energyDelta: 0,
      createdAt: T1,
    },
  ];

  const restored = restoreAppState(JSON.stringify(legacy));
  assert.equal(restored.status, 'ready');
  if (restored.status !== 'ready') return;
  assert.equal(restored.migrated, true);
  assert.equal(restored.state.checkIns[0].provenance, 'dev-skip');
  assert.equal(restored.state.checkIns[1].provenance, undefined);
});

test('an interim schema-v3 migration moves a legacy summary back behind the info control', () => {
  const interim = stateWithGoal();
  interim.activePlan.version = 5;
  interim.activePlan.summary = 'A long legacy explanation that must not remain in the main journey card.';
  interim.activePlan.cycleGoal = interim.activePlan.summary;
  interim.activePlan.chapters[0].title = 'Краткий стартовый цикл';

  const restored = restoreAppState(JSON.stringify(interim));
  assert.equal(restored.status, 'ready');
  if (restored.status !== 'ready') return;
  assert.equal(restored.migrated, true);
  assert.equal(restored.state.activePlan.cycleGoal, 'Read');
  assert.equal(restored.state.activePlan.summary, interim.activePlan.summary);
});

test('run initialization captures immutable targets and resumable cursor timestamps', () => {
  const mission = generatedGoal().plan.missions[0];
  const run = createMissionRun(mission, T0);
  assert.equal(run.status, 'running');
  assert.deepEqual(run.cursor, { blockIndex: 0, setIndex: 0, stage: 'ready' });
  assert.equal(run.stageStartedAt, T0);
  assert.equal(run.blockResults.length, 2);
  const counter = run.blockResults[0];
  assert.equal(counter.kind, 'counter');
  assert.deepEqual(counter.sets[0], {
    setIndex: 0,
    targetQuantity: 10,
    actualQuantity: 0,
    targetDurationSeconds: 600,
    actualDurationSeconds: 0,
    targetMet: false,
  });
});

test('mission-run machine advances timer sets through work, rest, review, and finish deterministically', () => {
  const timerBlock = {
    kind: 'timer',
    title: 'Hold',
    instruction: 'Hold for the prescribed time.',
    sets: 2,
    durationSecondsPerSet: 30,
    restSeconds: 10,
    successCriterion: 'Both sets are recorded.',
  };
  const mission = {
    ...generatedGoal().plan.missions[0],
    id: 'timer-mission',
    execution: {
      kind: 'in_app',
      successCriterion: 'Both sets are recorded.',
      blocks: [timerBlock],
    },
  };
  const initial = createMissionRun(mission, T0);
  const preparing = startMissionRunWork(initial, [timerBlock], T0);
  assert.ok(preparing);
  assert.equal(preparing.cursor.stage, 'preparing');
  assert.equal(preparing.stageEndsAt, '2026-08-01T09:00:03.000Z');
  assert.equal(preparing.blockResults[0].startedAt, undefined);
  assert.equal(preparing.blockResults[0].sets[0].startedAt, undefined);
  assert.equal(initial.cursor.stage, 'ready');

  // A resumed UI uses the persisted absolute deadline, so time spent preparing
  // never leaks into measured work even when the callback runs after backgrounding.
  const started = advanceMissionRunTimedStage(preparing, [timerBlock]);
  assert.ok(started);
  assert.equal(started.cursor.stage, 'work');
  assert.equal(started.stageStartedAt, '2026-08-01T09:00:03.000Z');
  assert.equal(started.stageEndsAt, '2026-08-01T09:00:33.000Z');
  assert.equal(started.blockResults[0].sets[0].startedAt, '2026-08-01T09:00:03.000Z');

  const overtime = advanceMissionRunTimedStage(started, [timerBlock]);
  assert.ok(overtime);
  assert.deepEqual(overtime.cursor, { blockIndex: 0, setIndex: 0, stage: 'work' });
  assert.equal(overtime.stageStartedAt, '2026-08-01T09:00:03.000Z');
  assert.equal(overtime.stageEndsAt, undefined);
  assert.equal(overtime.blockResults[0].sets[0].actualDurationSeconds, 30);
  assert.equal(overtime.blockResults[0].sets[0].targetMet, true);
  assert.equal(overtime.blockResults[0].sets[0].completedAt, undefined);
  assert.equal(isMissionRun(overtime), true);

  const afterFirst = completeTimerMissionRunSet(
    overtime,
    timerBlock,
    false,
    '2026-08-01T09:00:38.000Z',
  );
  assert.ok(afterFirst);
  assert.deepEqual(afterFirst.cursor, { blockIndex: 0, setIndex: 1, stage: 'rest' });
  assert.equal(afterFirst.stageEndsAt, '2026-08-01T09:00:48.000Z');
  assert.equal(afterFirst.blockResults[0].sets[0].actualDurationSeconds, 35);
  assert.equal(afterFirst.blockResults[0].sets[0].targetMet, true);

  const secondPreparing = advanceMissionRunTimedStage(afterFirst, [timerBlock]);
  assert.ok(secondPreparing);
  assert.equal(secondPreparing.cursor.stage, 'preparing');
  assert.equal(secondPreparing.stageEndsAt, '2026-08-01T09:00:51.000Z');
  const secondStarted = advanceMissionRunTimedStage(secondPreparing, [timerBlock]);
  assert.ok(secondStarted);
  const afterSecond = completeTimerMissionRunSet(
    secondStarted,
    timerBlock,
    false,
    '2026-08-01T09:01:01.000Z',
  );
  assert.ok(afterSecond);
  assert.equal(afterSecond.cursor.stage, 'review');
  assert.equal(afterSecond.blockResults[0].completed, true);
  assert.equal(afterSecond.blockResults[0].sets[1].actualDurationSeconds, 10);
  assert.equal(afterSecond.blockResults[0].sets[1].targetMet, false);

  const transition = continueMissionRunAfterReview(
    afterSecond,
    [timerBlock],
    '2026-08-01T09:01:02.000Z',
  );
  assert.equal(transition.kind, 'finish');
  assert.equal(transition.reason, 'completed');
  assert.equal(transition.run.cursor.stage, 'complete');
});

test('stopping during timer preparation records no completed work', () => {
  const timerBlock = {
    kind: 'timer',
    title: 'Hold',
    instruction: 'Hold for the prescribed time.',
    sets: 1,
    durationSecondsPerSet: 30,
    restSeconds: 0,
    successCriterion: 'The set is recorded.',
  };
  const mission = {
    ...generatedGoal().plan.missions[0],
    id: 'timer-preparation',
    execution: {
      kind: 'in_app',
      successCriterion: 'The set is recorded.',
      blocks: [timerBlock],
    },
  };
  const initial = createMissionRun(mission, T0);
  const preparing = startMissionRunWork(initial, [timerBlock], T0);
  assert.ok(preparing);
  assert.equal(isMissionRun(preparing), true);

  const stopped = checkpointMissionRunWork(
    preparing,
    timerBlock,
    '2026-08-01T09:00:02.000Z',
  );
  assert.equal(stopped.blockResults[0].sets[0].actualDurationSeconds, 0);
  assert.equal(stopped.blockResults[0].sets[0].startedAt, undefined);
  assert.equal(stopped.blockResults[0].sets[0].completedAt, undefined);
});

test('non-actionable persisted blocks can advance without an interactive review', () => {
  const mission = generatedGoal().plan.missions[0];
  const blocks = mission.execution.blocks;
  const initial = createMissionRun(mission, T0);
  const transition = skipMissionRunBlock(initial, blocks, T0);
  assert.ok(transition);
  assert.equal(transition.kind, 'save');
  assert.deepEqual(transition.run.cursor, { blockIndex: 1, setIndex: 0, stage: 'ready' });
  assert.equal(transition.run.blockResults[0].completed, true);
  assert.equal(transition.run.blockResults[0].criterionMet, true);
});

test('mission-run machine handles counter and simple blocks without React or persistence', () => {
  const mission = generatedGoal().plan.missions[0];
  const blocks = mission.execution.blocks;
  const initial = createMissionRun(mission, T0);
  const counterStarted = startMissionRunWork(initial, blocks, T0);
  assert.ok(counterStarted);
  counterStarted.blockResults[0].sets[0].actualQuantity = 10;
  const counterDone = completeCounterMissionRunSet(
    counterStarted,
    blocks[0],
    '2026-08-01T09:10:00.000Z',
  );
  assert.ok(counterDone);
  assert.equal(counterDone.cursor.stage, 'review');
  assert.equal(counterDone.blockResults[0].sets[0].actualDurationSeconds, 600);
  assert.equal(counterDone.blockResults[0].sets[0].targetMet, true);

  const next = continueMissionRunAfterReview(
    counterDone,
    blocks,
    '2026-08-01T09:10:01.000Z',
  );
  assert.equal(next.kind, 'save');
  assert.deepEqual(next.run.cursor, { blockIndex: 1, setIndex: 0, stage: 'ready' });
  const textStarted = startMissionRunWork(
    next.run,
    blocks,
    '2026-08-01T09:10:02.000Z',
  );
  assert.ok(textStarted);
  const textDone = completeSimpleMissionRunBlock(
    textStarted,
    1,
    '2026-08-01T09:12:00.000Z',
  );
  assert.ok(textDone);
  assert.equal(textDone.blockResults[1].completedAt, '2026-08-01T09:12:00.000Z');

  const stopped = checkpointMissionRunWork(
    counterStarted,
    blocks[0],
    '2026-08-01T09:00:25.000Z',
  );
  assert.equal(stopped.blockResults[0].sets[0].actualDurationSeconds, 25);
  assert.equal(stopped.stageEndsAt, undefined);
  assert.equal(counterStarted.stageEndsAt, '2026-08-01T09:10:00.000Z');
});

test('finish atomically persists the final checkpoint and successful report links its run', () => {
  let state = stateWithGoal();
  const run = createMissionRun(state.activePlan.missions[0], T0);
  state = appStateReducer(state, { type: 'begin-mission-run', run, now: T0 });
  const finalCheckpoint = completedCheckpoint(run);

  state = appStateReducer(state, {
    type: 'finish-mission-run',
    run: finalCheckpoint,
    finishReason: 'completed',
    now: T2,
  });
  const finished = state.missionRuns['mission-1'];
  assert.equal(finished.status, 'awaiting_checkin');
  assert.equal(finished.blockResults[1].completed, true);
  assert.equal(isMissionRunComplete(finished), true);
  assert.equal(isMissionRunSuccessful(finished), true);
  assert.deepEqual(missionRunSummary(finished), {
    completedBlocks: 2,
    totalBlocks: 2,
    targetMetSets: 1,
    totalSets: 1,
  });

  state = appStateReducer(state, {
    type: 'report-mission',
    missionId: 'mission-1',
    runId: run.id,
    outcome: 'completed',
    note: '  remembered the key point  ',
    checkInId: 'checkin-1',
    now: T2,
  });
  assert.equal(state.missionRuns['mission-1'].status, 'reported');
  assert.equal(state.activePlan.missions[0].outcome, 'completed');
  assert.equal(state.checkIns[0].runId, run.id);
  assert.equal(state.checkIns[0].comment, 'remembered the key point');
  assert.equal(state.checkIns[0].note, 'remembered the key point');
  assert.equal(state.character.xp, 20);
  assert.equal(state.recovery, undefined);
});

test('completed outcome rejects missed targets while partial accepts the logged run', () => {
  let state = stateWithGoal();
  const run = createMissionRun(state.activePlan.missions[0], T0);
  state = appStateReducer(state, { type: 'begin-mission-run', run, now: T0 });
  state = appStateReducer(state, {
    type: 'finish-mission-run',
    run: completedCheckpoint(run, false),
    finishReason: 'completed',
    now: T2,
  });
  assert.equal(isMissionRunComplete(state.missionRuns['mission-1']), true);
  assert.equal(isMissionRunSuccessful(state.missionRuns['mission-1']), false);

  const rejected = appStateReducer(state, {
    type: 'report-mission',
    missionId: 'mission-1',
    outcome: 'completed',
    checkInId: 'checkin-rejected',
    now: T2,
  });
  assert.equal(rejected, state);

  const partial = appStateReducer(state, {
    type: 'report-mission',
    missionId: 'mission-1',
    outcome: 'partial',
    checkInId: 'checkin-partial',
    now: T2,
  });
  assert.equal(partial.activePlan.missions[0].outcome, 'partial');
  assert.equal(partial.checkIns[0].runId, run.id);
  assert.equal(partial.character.xp, 9);
});

test('explicit failed criterion rejects a completed outcome and the final comment draft survives', () => {
  let state = stateWithGoal();
  const run = createMissionRun(state.activePlan.missions[0], T0);
  state = appStateReducer(state, { type: 'begin-mission-run', run, now: T0 });
  const checkpoint = completedCheckpoint(run);
  checkpoint.blockResults[1].criterionMet = false;
  state = appStateReducer(state, {
    type: 'finish-mission-run',
    run: checkpoint,
    finishReason: 'completed',
    now: T2,
  });

  const withDraft = structuredClone(state.missionRuns['mission-1']);
  withDraft.finalCommentDraft = 'Saved before the modal closes';
  state = appStateReducer(state, {
    type: 'mutate-mission-run',
    missionId: 'mission-1',
    runId: run.id,
    mutation: { kind: 'set-final-comment', value: withDraft.finalCommentDraft },
    now: T2,
  });
  assert.equal(state.missionRuns['mission-1'].finalCommentDraft, 'Saved before the modal closes');
  assert.equal(isMissionRunSuccessful(state.missionRuns['mission-1']), false);

  const rejected = appStateReducer(state, {
    type: 'report-mission',
    missionId: 'mission-1',
    runId: run.id,
    outcome: 'completed',
    checkInId: 'checkin-criterion-rejected',
    now: T2,
  });
  assert.equal(rejected, state);
});

test('event mutations serialize rapid counter input and stale transitions keep the latest value', () => {
  let state = stateWithGoal();
  const run = createMissionRun(state.activePlan.missions[0], T0);
  state = appStateReducer(state, { type: 'begin-mission-run', run, now: T0 });
  const working = structuredClone(run);
  working.cursor = { blockIndex: 0, setIndex: 0, stage: 'work' };
  working.stageStartedAt = T0;
  working.stageEndsAt = T2;
  working.blockResults[0].startedAt = T0;
  working.blockResults[0].sets[0].startedAt = T0;
  state = appStateReducer(state, { type: 'save-mission-run', run: working, now: T0 });
  const staleCompletion = structuredClone(state.missionRuns['mission-1']);

  for (const value of [3, 10]) {
    state = appStateReducer(state, {
      type: 'mutate-mission-run',
      missionId: 'mission-1',
      runId: run.id,
      mutation: { kind: 'set-counter', blockIndex: 0, setIndex: 0, value },
      now: T1,
    });
  }
  assert.equal(state.missionRuns['mission-1'].blockResults[0].sets[0].actualQuantity, 10);

  staleCompletion.cursor = { blockIndex: 0, setIndex: 0, stage: 'review' };
  staleCompletion.stageEndsAt = undefined;
  staleCompletion.blockResults[0].completed = true;
  staleCompletion.blockResults[0].completedAt = T2;
  staleCompletion.blockResults[0].sets[0].completedAt = T2;
  staleCompletion.blockResults[0].sets[0].actualDurationSeconds = 600;
  state = appStateReducer(state, {
    type: 'save-mission-run',
    run: staleCompletion,
    now: T2,
  });

  const savedSet = state.missionRuns['mission-1'].blockResults[0].sets[0];
  assert.equal(savedSet.actualQuantity, 10);
  assert.equal(savedSet.targetMet, true);
});

test('persisted plan-v1 through plan-v4 missions keep their legacy check-in path', () => {
  const generated = generatedGoal();
  generated.plan.version = 4;
  generated.plan.missions[0].execution = { kind: 'manual' };
  generated.plan.missions[0].steps = ['Complete the legacy action inside the old runner.'];
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated,
    now: T0,
  });

  state = appStateReducer(state, {
    type: 'report-mission',
    missionId: 'mission-1',
    outcome: 'completed',
    note: 'Legacy result retained',
    checkInId: 'checkin-legacy',
    now: T1,
  });

  assert.equal(state.activePlan.missions[0].outcome, 'completed');
  assert.equal(state.checkIns[0].runId, undefined);
  assert.equal(state.checkIns[0].comment, 'Legacy result retained');
  assert.equal(state.character.xp, 20);
});

test('DEV skip advances only the current day without changing RPG metrics', () => {
  const generated = generatedGoal();
  generated.plan.horizonDays = 2;
  generated.plan.missions.push({
    ...structuredClone(generated.plan.missions[0]),
    id: 'mission-2',
    sequence: 2,
    dayNumber: 2,
    title: 'Second day',
  });
  let state = appStateReducer(createInitialAppState(T0), {
    type: 'create-goal',
    generated,
    now: T0,
  });
  const characterBefore = structuredClone(state.character);
  const run = createMissionRun(state.activePlan.missions[0], T0);
  state = appStateReducer(state, { type: 'begin-mission-run', run, now: T0 });

  const outOfOrder = appStateReducer(state, {
    type: 'skip-mission-for-testing',
    missionId: 'mission-2',
    checkInId: 'dev-skip-out-of-order',
    now: T1,
  });
  assert.equal(outOfOrder, state);

  state = appStateReducer(state, {
    type: 'skip-mission-for-testing',
    missionId: 'mission-1',
    checkInId: 'dev-skip-1',
    now: T1,
  });
  assert.equal(state.activePlan.missions[0].outcome, 'skipped');
  assert.equal(state.activePlan.missions[1].outcome, 'pending');
  assert.equal(state.missionRuns['mission-1'], undefined);
  assert.deepEqual(state.character, characterBefore);
  assert.deepEqual(state.checkIns[0], {
    id: 'dev-skip-1',
    missionId: 'mission-1',
    outcome: 'skipped',
    comment: 'Skipped in development mode.',
    note: 'Skipped in development mode.',
    provenance: 'dev-skip',
    xpDelta: 0,
    energyDelta: 0,
    createdAt: T1,
  });

  state = appStateReducer(state, {
    type: 'skip-mission-for-testing',
    missionId: 'mission-2',
    checkInId: 'dev-skip-2',
    now: T2,
  });
  assert.equal(state.activePlan.missions[1].outcome, 'skipped');
  assert.equal(state.activeGoal.status, 'paused');
  assert.deepEqual(state.activeGoal.program.completedCycles, [
    {
      cycleNumber: 1,
      completedAt: T2,
      measuredValue: null,
      unit: null,
    },
  ]);
  assert.deepEqual(state.character, characterBefore);

  state = appStateReducer(state, {
    type: 'restart-active-plan',
    planId: 'plan-1',
    startDate: '2026-08-01',
    now: T2,
  });
  assert.deepEqual(
    state.activePlan.missions.map((mission) => mission.outcome),
    ['pending', 'pending'],
  );
  assert.deepEqual(state.checkIns, []);
  assert.deepEqual(state.character, characterBefore);
});

test('reporting requires the current finished run and restarting replaces its checkpoints', () => {
  let state = stateWithGoal();
  const first = createMissionRun(state.activePlan.missions[0], T0);
  state = appStateReducer(state, { type: 'begin-mission-run', run: first, now: T0 });

  const premature = appStateReducer(state, {
    type: 'report-mission',
    missionId: 'mission-1',
    outcome: 'skipped',
    checkInId: 'checkin-premature',
    now: T1,
  });
  assert.equal(premature, state);

  const restarted = createMissionRun(state.activePlan.missions[0], T1);
  state = appStateReducer(state, { type: 'restart-mission-run', run: restarted, now: T1 });
  assert.equal(state.missionRuns['mission-1'].id, restarted.id);
  assert.equal(state.missionRuns['mission-1'].blockResults[0].completed, false);

  state = appStateReducer(state, { type: 'start-new-goal', now: T2 });
  assert.deepEqual(state.missionRuns, {});
});

test('restarting the active plan preserves paid plan data and resets only its local journey', () => {
  let state = stateWithGoal();
  const originalGoal = structuredClone(state.activeGoal);
  const originalPlanMetadata = {
    id: state.activePlan.id,
    version: state.activePlan.version,
    createdAt: state.activePlan.createdAt,
    research: structuredClone(state.activePlan.research),
  };
  const run = createMissionRun(state.activePlan.missions[0], T0);
  state = appStateReducer(state, { type: 'begin-mission-run', run, now: T0 });
  state = appStateReducer(state, {
    type: 'finish-mission-run',
    run: completedCheckpoint(run),
    finishReason: 'completed',
    now: T1,
  });
  state = appStateReducer(state, {
    type: 'report-mission',
    missionId: 'mission-1',
    runId: run.id,
    outcome: 'completed',
    note: 'Saved result that should be cleared.',
    checkInId: 'checkin-before-plan-restart',
    now: T2,
  });
  const characterAfterCompletion = structuredClone(state.character);
  assert.equal(state.activeGoal.status, 'completed');
  const secondMission = {
    ...structuredClone(state.activePlan.missions[0]),
    id: 'mission-2',
    dayNumber: undefined,
    sequence: 2,
    outcome: 'partial',
    scheduledDate: '2026-08-02',
  };
  state = {
    ...state,
    activePlan: {
      ...state.activePlan,
      horizonDays: 2,
      missions: [...state.activePlan.missions, secondMission],
    },
  };

  const restarted = appStateReducer(state, {
    type: 'restart-active-plan',
    planId: 'plan-1',
    startDate: '2026-08-10',
    now: '2026-08-10T08:00:00.000Z',
  });

  assert.equal(restarted.activeGoal.id, originalGoal.id);
  assert.equal(restarted.activeGoal.rawPrompt, originalGoal.rawPrompt);
  assert.equal(restarted.activeGoal.status, 'active');
  assert.equal(restarted.activeGoal.targetDate, originalGoal.targetDate);
  assert.equal(restarted.activeGoal.program.activeCycle, originalGoal.program.activeCycle);
  assert.deepEqual(restarted.activeGoal.program.completedCycles, []);
  assert.deepEqual(restarted.activeGoal.program.roadmap, originalGoal.program.roadmap);
  assert.equal(restarted.activePlan.id, originalPlanMetadata.id);
  assert.equal(restarted.activePlan.version, originalPlanMetadata.version);
  assert.equal(restarted.activePlan.createdAt, originalPlanMetadata.createdAt);
  assert.deepEqual(restarted.activePlan.research, originalPlanMetadata.research);
  assert.equal(restarted.activePlan.missions[0].outcome, 'pending');
  assert.equal(restarted.activePlan.missions[0].scheduledDate, '2026-08-10');
  assert.equal(restarted.activePlan.missions[1].outcome, 'pending');
  assert.equal(restarted.activePlan.missions[1].scheduledDate, '2026-08-11');
  assert.deepEqual(restarted.missionRuns, {});
  assert.deepEqual(restarted.checkIns, []);
  assert.deepEqual(restarted.character, characterAfterCompletion);
  const persistedRestart = JSON.parse(JSON.stringify(restarted));
  assert.deepEqual(restoreAppState(JSON.stringify(restarted)), {
    status: 'ready',
    source: 'stored',
    state: persistedRestart,
    migrated: false,
  });
});

test('restarting a plan is a no-op without a selected plan or with an invalid date', () => {
  const empty = createInitialAppState(T0);
  assert.equal(
    appStateReducer(empty, {
      type: 'restart-active-plan',
      planId: 'plan-1',
      startDate: '2026-08-10',
      now: T1,
    }),
    empty,
  );

  const selected = stateWithGoal();
  assert.equal(
    appStateReducer(selected, {
      type: 'restart-active-plan',
      planId: 'plan-1',
      startDate: 'not-a-date',
      now: T1,
    }),
    selected,
  );
  assert.equal(
    appStateReducer(selected, {
      type: 'restart-active-plan',
      planId: 'another-plan',
      startDate: '2026-08-10',
      now: T1,
    }),
    selected,
  );
});

test('calendar-date restart arithmetic handles leap days and rejects invalid keys', () => {
  assert.equal(addCalendarDaysToKey('2028-02-28', 1), '2028-02-29');
  assert.equal(addCalendarDaysToKey('2028-02-28', 2), '2028-03-01');
  assert.equal(addCalendarDaysToKey('2026-12-31', 1), '2027-01-01');
  assert.equal(addCalendarDaysToKey('2026-02-30', 1), undefined);
  assert.equal(addCalendarDaysToKey('not-a-date', 1), undefined);
});
