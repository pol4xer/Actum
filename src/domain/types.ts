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

export type MissionExecution =
  | { kind: 'manual' }
  | { kind: 'timer'; durationSeconds: number }
  | { kind: 'routine'; actions: RoutineAction[] };

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

export type Goal = {
  id: string;
  rawPrompt: string;
  title: string;
  domain: GoalDomain;
  targetDate: string;
  targetMetric: string;
  baseline?: PlanBaseline;
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
  targetTimeline?: string;
  chapters: QuestChapter[];
  missions: Mission[];
  research: ResearchDossier;
};

export type CheckIn = {
  id: string;
  missionId: string;
  outcome: Exclude<MissionOutcome, 'pending'>;
  note?: string;
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

export type AppState = {
  schemaVersion: 1;
  onboardingCompleted: boolean;
  profile?: Profile;
  character: CharacterState;
  activeGoal?: Goal;
  activePlan?: PlanVersion;
  checkIns: CheckIn[];
  recovery?: RecoveryFlow;
  settings: AppSettings;
  lastUpdatedAt: string;
};

export type GoalInput = {
  prompt: string;
  currentLevel: 'starting' | 'some-experience' | 'returning';
  baseline: string;
  targetTimeline: string;
  dailyMinutes: number;
  horizonDays: number;
  researchMode?: 'quick' | 'web';
};

export type RiskGateResult =
  | { safe: true; note: string }
  | { safe: false; title: string; message: string };

export type GeneratedGoal = {
  goal: Goal;
  plan: PlanVersion;
};
