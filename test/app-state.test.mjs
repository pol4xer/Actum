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
compileModule('src/lib/calendar-date.ts', 'calendar-date.mjs');
compileModule('src/state/app-state-defaults.ts', 'app-state-defaults.mjs', (source) =>
  source.replace("from '../domain/reward-policy';", "from './reward-policy.mjs';"),
);
compileModule('src/state/app-state-codec.ts', 'app-state-codec.mjs', (source) =>
  source
    .replace("from '../domain/mission-run';", "from './mission-run.mjs';")
    .replace("from './app-state-defaults';", "from './app-state-defaults.mjs';"),
);
compileModule('src/state/app-state.ts', 'app-state.mjs', (source) =>
  source
    .replace("from '../domain/mission-run';", "from './mission-run.mjs';")
    .replace("from '../domain/reward-policy';", "from './reward-policy.mjs';")
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
const { addCalendarDaysToKey } = await import(
  pathToFileURL(join(compiledDirectory, 'calendar-date.mjs')).href
);
const {
  REWARD_POLICY,
  missionReward,
  selectTwinProjection,
} = await import(pathToFileURL(join(compiledDirectory, 'reward-policy.mjs')).href);
const {
  APP_STATE_STORAGE_KEY,
  appStateReducer,
  createInitialAppState,
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
  return {
    goal: {
      id: 'goal-1',
      rawPrompt: 'Read ten pages',
      title: 'Read ten pages',
      domain: 'read',
      targetDate: '2026-09-01T00:00:00.000Z',
      targetMetric: '10 pages',
      status: 'active',
      createdAt: T0,
    },
    plan: {
      id: 'plan-1',
      version: 5,
      createdAt: T0,
      dailyMinutes: 15,
      horizonDays: 1,
      summary: 'Concrete session',
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

test('schema v1 migrates additively under the stable storage key', () => {
  const original = stateWithGoal();
  const legacy = {
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
  };
  delete legacy.missionRuns;

  const restored = restoreAppState(JSON.stringify(legacy));
  assert.equal(APP_STATE_STORAGE_KEY, 'actum.app-state.v1');
  assert.equal(restored.status, 'ready');
  if (restored.status !== 'ready') return;
  assert.equal(restored.migrated, true);
  assert.equal(restored.state.schemaVersion, 2);
  assert.deepEqual(restored.state.activePlan, original.activePlan);
  assert.deepEqual(restored.state.checkIns, legacy.checkIns);
  assert.deepEqual(restored.state.missionRuns, {});
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

  const afterFirst = advanceMissionRunTimedStage(started, [timerBlock]);
  assert.ok(afterFirst);
  assert.deepEqual(afterFirst.cursor, { blockIndex: 0, setIndex: 1, stage: 'rest' });
  assert.equal(afterFirst.stageEndsAt, '2026-08-01T09:00:43.000Z');
  assert.equal(afterFirst.blockResults[0].sets[0].targetMet, true);

  const secondPreparing = advanceMissionRunTimedStage(afterFirst, [timerBlock]);
  assert.ok(secondPreparing);
  assert.equal(secondPreparing.cursor.stage, 'preparing');
  assert.equal(secondPreparing.stageEndsAt, '2026-08-01T09:00:46.000Z');
  const secondStarted = advanceMissionRunTimedStage(secondPreparing, [timerBlock]);
  assert.ok(secondStarted);
  const afterSecond = completeTimerMissionRunSet(
    secondStarted,
    timerBlock,
    false,
    '2026-08-01T09:00:56.000Z',
  );
  assert.ok(afterSecond);
  assert.equal(afterSecond.cursor.stage, 'review');
  assert.equal(afterSecond.blockResults[0].completed, true);
  assert.equal(afterSecond.blockResults[0].sets[1].actualDurationSeconds, 10);
  assert.equal(afterSecond.blockResults[0].sets[1].targetMet, false);

  const transition = continueMissionRunAfterReview(
    afterSecond,
    [timerBlock],
    '2026-08-01T09:00:51.000Z',
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
  assert.equal(restarted.activeGoal.targetDate, '2026-08-11T00:00:00.000Z');
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
