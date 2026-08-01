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
compileModule('src/state/app-state.ts', 'app-state.mjs', (source) =>
  source.replace("from '../domain/mission-run';", "from './mission-run.mjs';"),
);

const {
  createMissionRun,
  isMissionRunComplete,
  isMissionRunSuccessful,
  missionRunSummary,
} = await import(pathToFileURL(join(compiledDirectory, 'mission-run.mjs')).href);
const {
  APP_STATE_STORAGE_KEY,
  appStateReducer,
  createInitialAppState,
  restoreAppState,
} = await import(pathToFileURL(join(compiledDirectory, 'app-state.mjs')).href);

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
