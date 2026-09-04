export type StrictnessMode = 'gentle' | 'balanced' | 'strict';
export type Archetype = 'pathfinder' | 'scholar' | 'guardian';
export type GoalDomain = 'read' | 'learn' | 'practice' | 'organize' | 'move' | 'habit';
export type MissionType =
  | 'learn'
  | 'read'
  | 'practice'
  | 'prepare'
  | 'recover'
  | 'organize'
  | 'move'
  | 'reflect'
  | 'submit'
  | 'check';
export type MissionOutcome = 'pending' | 'completed' | 'partial' | 'skipped';

export type RoutineUnit =
  | 'reps'
  | 'seconds'
  | 'minutes'
  | 'pages'
  | 'items'
  | 'words'
  | 'meters'
  | 'attempts'
  | 'custom';

export type RoutineLoadBasis = {
  percentage: number;
  baseValue: number;
  baseUnit: string;
  result: number;
};

export type RoutineAction = {
  title: string;
  instruction: string;
  sets: number;
  quantity: number;
  /** Required by plan-v4; optional only for locally persisted older plans. */
  workSecondsPerSet?: number;
  unit: RoutineUnit;
  unitLabel?: string;
  /** String is kept only so locally persisted plan-v3 missions remain readable. */
  loadBasis?: RoutineLoadBasis | string;
  restSeconds: number;
  tempo?: string;
  successCriterion: string;
};

export type CounterUnit =
  | 'reps'
  | 'pages'
  | 'items'
  | 'words'
  | 'meters'
  | 'attempts'
  | 'custom';

export type TimerExecutionBlock = {
  kind: 'timer';
  title: string;
  instruction: string;
  sets: number;
  durationSecondsPerSet: number;
  restSeconds: number;
  loadBasis?: RoutineLoadBasis;
  successCriterion: string;
};

export type CounterExecutionBlock = {
  kind: 'counter';
  title: string;
  instruction: string;
  sets: number;
  targetPerSet: number;
  unit: CounterUnit;
  unitLabel?: string;
  workSecondsPerSet: number;
  restSeconds: number;
  tempo?: string;
  loadBasis?: RoutineLoadBasis;
  successCriterion: string;
};

export type ChecklistExecutionBlock = {
  kind: 'checklist';
  title: string;
  items: string[];
  estimatedSeconds: number;
  successCriterion: string;
};

export type TextLogExecutionBlock = {
  kind: 'text_log';
  title: string;
  prompt: string;
  minCharacters: number;
  maxCharacters: number;
  estimatedSeconds: number;
  successCriterion: string;
};

export type MissionExecutionBlock =
  | TimerExecutionBlock
  | CounterExecutionBlock
  | ChecklistExecutionBlock
  | TextLogExecutionBlock;

export type InAppMissionExecution = {
  kind: 'in_app';
  blocks: MissionExecutionBlock[];
  successCriterion: string;
};

/** Persisted plan-v1 through plan-v4 executions remain readable. */
export type LegacyMissionExecution =
  | { kind: 'manual' }
  | { kind: 'timer'; durationSeconds: number }
  | { kind: 'routine'; actions: RoutineAction[] };

export type MissionExecution = InAppMissionExecution | LegacyMissionExecution;

export type Profile = {
  name: string;
  archetype: Archetype;
  strictness: StrictnessMode;
  contractAcceptedAt: string;
};

export type CharacterState = {
  level: number;
  xp: number;
  energy: number;
  streak: number;
  worldLight: number;
  buffs: string[];
  debuffs: string[];
};

export type PlanBaseline = {
  userStatement: string;
  normalizedMetric: string;
  value: number | null;
  unit: string | null;
  calculationRule: string;
};

export type GoalDuration = 'month' | 'half-year' | 'year';

export type GoalTarget = {
  userStatement: string;
  normalizedMetric: string;
  value: number | null;
  unit: string | null;
};

export type ProgramMilestone = {
  cycleNumber: number;
  title: string;
  focus: string;
  targetValue: number | null;
  targetUnit: string | null;
};

export type ProgramCycleResult = {
  cycleNumber: number;
  completedAt: string;
  measuredValue: number | null;
  unit: string | null;
};

export type GoalProgram = {
  duration: GoalDuration;
  totalDays: number;
  totalCycles: number;
  activeCycle: number;
  target: GoalTarget;
  roadmap: ProgramMilestone[];
  completedCycles: ProgramCycleResult[];
};

export type GoalProgramContext = Pick<
  GoalProgram,
  'target' | 'roadmap' | 'completedCycles'
>;

export type Goal = {
  id: string;
  rawPrompt: string;
  title: string;
  domain: GoalDomain;
  targetDate: string;
  targetMetric: string;
  baseline?: PlanBaseline;
  program: GoalProgram;
  /** Persisted plan-v1 through plan-v5 label. */
  targetTimeline?: string;
  status: 'active' | 'completed' | 'paused';
  createdAt: string;
};

export type ResearchDossier = {
  method: 'local-curated-v1' | 'openai-responses-v1' | 'openai-web-research-v1';
  confidence: 'high' | 'medium';
  safetyNotes: string[];
  assumptions: string[];
  sourceLabels: string[];
  sources?: Array<{ title: string; url: string }>;
  request?: {
    requestId: string;
    providerResponseId?: string;
    model: string;
    promptVersion: string;
    durationMs: number;
    webSearchCount: number;
    inputTokens?: number;
    outputTokens?: number;
  };
};

export type QuestChapter = {
  id: string;
  title: string;
  subtitle: string;
  order: number;
  startDay?: number;
  endDay?: number;
};

export type Mission = {
  id: string;
  chapterId: string;
  sequence: number;
  title: string;
  description: string;
  type: MissionType;
  estimatedMinutes: number;
  xp: number;
  outcome: MissionOutcome;
  dayNumber?: number;
  scheduledDate?: string;
  repeatIndex?: number;
  repeatTotal?: number;
  steps?: string[];
  execution?: MissionExecution;
  completionCriterion?: string;
  progressionRule?: string;
  warning?: string;
};

export type PlanVersion = {
  id: string;
  version: number;
  createdAt: string;
  dailyMinutes: number;
  horizonDays: number;
  summary: string;
  baseline?: PlanBaseline;
  /** Required by plan-v6; optional only for persisted plan-v1 through plan-v5 data. */
  cycleNumber?: number;
  /** Required by plan-v6; optional only for persisted plan-v1 through plan-v5 data. */
  totalCycles?: number;
  /** Required by plan-v6; optional only for persisted plan-v1 through plan-v5 data. */
  cycleGoal?: string;
  /** Required by plan-v6; optional only for persisted plan-v1 through plan-v5 data. */
  assessment?: {
    dayNumber: number;
    /** Zero-based index in the assessment mission's in-app execution blocks. */
    blockIndex: number;
    metric: string;
    targetValue: number | null;
    targetUnit: string | null;
  };
  /** Persisted plan-v1 through plan-v5 label. */
  targetTimeline?: string;
  chapters: QuestChapter[];
  missions: Mission[];
  research: ResearchDossier;
};

export type CheckIn = {
  id: string;
  missionId: string;
  runId?: string;
  outcome: Exclude<MissionOutcome, 'pending'>;
  /** Mission-level reflection; note is retained as its legacy UI alias. */
  comment?: string;
  note?: string;
  /** Optional only for check-ins persisted before explicit provenance existed. */
  provenance?: 'user' | 'dev-skip';
  xpDelta: number;
  energyDelta: number;
  createdAt: string;
};

export type RecoveryFlow = {
  sourceMissionId: string;
  title: string;
  description: string;
  xp: number;
};

export type AppSettings = {
  notificationsEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
};

export type MissionRunStatus = 'running' | 'awaiting_checkin' | 'reported';
export type MissionRunFinishReason = 'completed' | 'stopped';
export type MissionRunCursorStage =
  | 'ready'
  | 'preparing'
  | 'work'
  | 'rest'
  | 'review'
  | 'complete';

export type MissionRunCursor = {
  blockIndex: number;
  setIndex: number;
  stage: MissionRunCursorStage;
};

type MissionRunSetResultBase = {
  setIndex: number;
  targetMet: boolean;
  startedAt?: string;
  completedAt?: string;
};

export type TimerRunSetResult = MissionRunSetResultBase & {
  targetDurationSeconds: number;
  actualDurationSeconds: number;
};

export type CounterRunSetResult = MissionRunSetResultBase & {
  targetQuantity: number;
  actualQuantity: number;
  targetDurationSeconds: number;
  actualDurationSeconds: number;
};

export type MissionRunSetResult = TimerRunSetResult | CounterRunSetResult;

type MissionRunBlockResultBase = {
  blockIndex: number;
  title: string;
  completed: boolean;
  /** Explicit in-app answer to this block's success criterion. */
  criterionMet?: boolean;
  comment?: string;
  startedAt?: string;
  completedAt?: string;
};

export type TimerRunBlockResult = MissionRunBlockResultBase & {
  kind: 'timer';
  sets: TimerRunSetResult[];
};

export type CounterRunBlockResult = MissionRunBlockResultBase & {
  kind: 'counter';
  unit: CounterUnit;
  unitLabel?: string;
  sets: CounterRunSetResult[];
};

export type ChecklistRunBlockResult = MissionRunBlockResultBase & {
  kind: 'checklist';
  checkedIndexes: number[];
};

export type TextLogRunBlockResult = MissionRunBlockResultBase & {
  kind: 'text_log';
  value: string;
};

export type MissionRunBlockResult =
  | TimerRunBlockResult
  | CounterRunBlockResult
  | ChecklistRunBlockResult
  | TextLogRunBlockResult;

export type MissionRun = {
  id: string;
  missionId: string;
  status: MissionRunStatus;
  cursor: MissionRunCursor;
  startedAt: string;
  updatedAt: string;
  stageStartedAt?: string;
  stageEndsAt?: string;
  finishedAt?: string;
  finishReason?: MissionRunFinishReason;
  finalCommentDraft?: string;
  blockResults: MissionRunBlockResult[];
};

export type MissionRunMutation =
  | { kind: 'set-counter'; blockIndex: number; setIndex: number; value: number }
  | { kind: 'toggle-checklist'; blockIndex: number; itemIndex: number }
  | { kind: 'set-text-log'; blockIndex: number; value: string }
  | { kind: 'set-block-comment'; blockIndex: number; value: string }
  | { kind: 'set-block-criterion'; blockIndex: number; value: boolean }
  | { kind: 'set-final-comment'; value: string };

export type AppState = {
  schemaVersion: 3;
  onboardingCompleted: boolean;
  profile?: Profile;
  character: CharacterState;
  activeGoal?: Goal;
  activePlan?: PlanVersion;
  checkIns: CheckIn[];
  missionRuns: Record<string, MissionRun>;
  recovery?: RecoveryFlow;
  settings: AppSettings;
  lastUpdatedAt: string;
};

export type GoalInput = {
  prompt: string;
  currentLevel: 'starting' | 'some-experience' | 'returning';
  baseline: string;
  duration: GoalDuration;
  dailyMinutes: number;
  cycleNumber?: number;
  programContext?: GoalProgramContext;
  researchMode?: 'quick' | 'web';
};

export type GeneratedGoal = {
  goal: Goal;
  plan: PlanVersion;
};
