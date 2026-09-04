import { CYCLE_DAYS, programDurationConfig } from './program-duration.mjs';

export const PLAN_CONTRACT_VERSION = 'plan-v7';

const LOAD_BASIS_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['percentage', 'baseValue', 'baseUnit', 'result'],
      properties: {
        percentage: { type: 'number', minimum: 0.01, maximum: 1_000_000 },
        baseValue: { type: 'number', minimum: 0, maximum: 1_000_000_000 },
        baseUnit: { type: 'string', minLength: 1, maxLength: 40 },
        result: { type: 'number', minimum: 0, maximum: 1_000_000 },
      },
    },
    { type: 'null' },
  ],
};

const TIMER_BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'title',
    'instruction',
    'sets',
    'durationSecondsPerSet',
    'restSeconds',
    'loadBasis',
    'successCriterion',
  ],
  properties: {
    kind: { type: 'string', enum: ['timer'] },
    title: { type: 'string', minLength: 2, maxLength: 100 },
    instruction: { type: 'string', minLength: 8, maxLength: 360 },
    sets: { type: 'integer', minimum: 1, maximum: 20 },
    durationSecondsPerSet: { type: 'integer', minimum: 1, maximum: 7200 },
    restSeconds: { type: 'integer', minimum: 0, maximum: 1800 },
    loadBasis: LOAD_BASIS_SCHEMA,
    successCriterion: { type: 'string', minLength: 5, maxLength: 260 },
  },
};

const COUNTER_BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
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
  ],
  properties: {
    kind: { type: 'string', enum: ['counter'] },
    title: { type: 'string', minLength: 2, maxLength: 100 },
    instruction: { type: 'string', minLength: 8, maxLength: 360 },
    sets: { type: 'integer', minimum: 1, maximum: 20 },
    targetPerSet: { type: 'number', minimum: 0.01, maximum: 1_000_000 },
    unit: {
      type: 'string',
      enum: ['reps', 'pages', 'items', 'words', 'meters', 'attempts', 'custom'],
    },
    unitLabel: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 40 },
        { type: 'null' },
      ],
    },
    workSecondsPerSet: { type: 'integer', minimum: 1, maximum: 7200 },
    restSeconds: { type: 'integer', minimum: 0, maximum: 1800 },
    tempo: {
      anyOf: [
        { type: 'string', minLength: 2, maxLength: 100 },
        { type: 'null' },
      ],
    },
    loadBasis: LOAD_BASIS_SCHEMA,
    successCriterion: { type: 'string', minLength: 5, maxLength: 260 },
  },
};

const CHECKLIST_BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'items', 'estimatedSeconds', 'successCriterion'],
  properties: {
    kind: { type: 'string', enum: ['checklist'] },
    title: { type: 'string', minLength: 2, maxLength: 100 },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: { type: 'string', minLength: 2, maxLength: 260 },
    },
    estimatedSeconds: { type: 'integer', minimum: 1, maximum: 7200 },
    successCriterion: { type: 'string', minLength: 5, maxLength: 260 },
  },
};

const TEXT_LOG_BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'title',
    'prompt',
    'minCharacters',
    'maxCharacters',
    'estimatedSeconds',
    'successCriterion',
  ],
  properties: {
    kind: { type: 'string', enum: ['text_log'] },
    title: { type: 'string', minLength: 2, maxLength: 100 },
    prompt: { type: 'string', minLength: 5, maxLength: 360 },
    minCharacters: { type: 'integer', minimum: 1, maximum: 2000 },
    maxCharacters: { type: 'integer', minimum: 1, maximum: 4000 },
    estimatedSeconds: { type: 'integer', minimum: 1, maximum: 7200 },
    successCriterion: { type: 'string', minLength: 5, maxLength: 260 },
  },
};

const EXECUTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'blocks', 'primaryBlockIndex', 'successCriterion'],
  properties: {
    kind: { type: 'string', enum: ['in_app'] },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        anyOf: [
          TIMER_BLOCK_SCHEMA,
          COUNTER_BLOCK_SCHEMA,
          CHECKLIST_BLOCK_SCHEMA,
          TEXT_LOG_BLOCK_SCHEMA,
        ],
      },
    },
    primaryBlockIndex: { type: 'integer', minimum: 0, maximum: 2 },
    successCriterion: { type: 'string', minLength: 5, maxLength: 320 },
  },
};

const DAY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'dayNumber',
    'phaseIndex',
    'title',
    'description',
    'type',
    'estimatedMinutes',
    'xp',
    'execution',
    'warning',
  ],
  properties: {
    dayNumber: { type: 'integer', minimum: 1, maximum: 30 },
    phaseIndex: { type: 'integer', enum: [1, 2, 3] },
    title: { type: 'string', minLength: 2, maxLength: 120 },
    description: { type: 'string', minLength: 5, maxLength: 560 },
    type: {
      type: 'string',
      enum: [
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
      ],
    },
    estimatedMinutes: { type: 'integer', minimum: 1, maximum: 120 },
    xp: { type: 'integer', minimum: 5, maximum: 60 },
    execution: EXECUTION_SCHEMA,
    warning: {
      anyOf: [
        { type: 'string', minLength: 3, maxLength: 300 },
        { type: 'null' },
      ],
    },
  },
};

const TARGET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['userStatement', 'normalizedMetric', 'value', 'unit'],
  properties: {
    userStatement: { type: 'string', minLength: 5, maxLength: 1000 },
    normalizedMetric: { type: 'string', minLength: 2, maxLength: 180 },
    value: {
      anyOf: [
        { type: 'number', minimum: 0 },
        { type: 'null' },
      ],
    },
    unit: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 40 },
        { type: 'null' },
      ],
    },
  },
};

const ROADMAP_ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cycleNumber', 'title', 'focus', 'targetValue', 'targetUnit'],
  properties: {
    cycleNumber: { type: 'integer', minimum: 1, maximum: 12 },
    title: { type: 'string', minLength: 2, maxLength: 100 },
    focus: { type: 'string', minLength: 5, maxLength: 240 },
    targetValue: {
      anyOf: [
        { type: 'number', minimum: 0 },
        { type: 'null' },
      ],
    },
    targetUnit: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 40 },
        { type: 'null' },
      ],
    },
  },
};

const ASSESSMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dayNumber', 'blockIndex', 'metric', 'targetValue', 'targetUnit'],
  properties: {
    dayNumber: { type: 'number', enum: [CYCLE_DAYS] },
    blockIndex: { type: 'integer', minimum: 0, maximum: 2 },
    metric: { type: 'string', minLength: 2, maxLength: 180 },
    targetValue: {
      anyOf: [
        { type: 'number', minimum: 0 },
        { type: 'null' },
      ],
    },
    targetUnit: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 40 },
        { type: 'null' },
      ],
    },
  },
};

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
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
  ],
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 120 },
    domain: {
      type: 'string',
      enum: ['read', 'learn', 'practice', 'organize', 'move', 'habit'],
    },
    targetMetric: { type: 'string', minLength: 3, maxLength: 220 },
    duration: { type: 'string', enum: ['month', 'half-year', 'year'] },
    totalCycles: { type: 'number', enum: [1, 6, 12] },
    cycleNumber: { type: 'integer', minimum: 1, maximum: 12 },
    targetCycleNumber: { type: 'integer', minimum: 1, maximum: 12 },
    target: TARGET_SCHEMA,
    cycleGoal: { type: 'string', minLength: 5, maxLength: 300 },
    roadmap: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: ROADMAP_ENTRY_SCHEMA,
    },
    assessment: ASSESSMENT_SCHEMA,
    summary: { type: 'string', minLength: 10, maxLength: 600 },
    baseline: {
      type: 'object',
      additionalProperties: false,
      required: ['userStatement', 'normalizedMetric', 'value', 'unit', 'calculationRule'],
      properties: {
        userStatement: { type: 'string', minLength: 2, maxLength: 500 },
        normalizedMetric: { type: 'string', minLength: 2, maxLength: 180 },
        value: {
          anyOf: [
            { type: 'number', minimum: 0 },
            { type: 'null' },
          ],
        },
        unit: {
          anyOf: [
            { type: 'string', minLength: 1, maxLength: 40 },
            { type: 'null' },
          ],
        },
        calculationRule: { type: 'string', minLength: 8, maxLength: 360 },
      },
    },
    safetyNotes: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', minLength: 3, maxLength: 300 },
    },
    assumptions: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: { type: 'string', minLength: 3, maxLength: 300 },
    },
    sourceLabels: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: { type: 'string', minLength: 2, maxLength: 180 },
    },
    phases: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'subtitle', 'startDay', 'endDay'],
        properties: {
          title: { type: 'string', minLength: 2, maxLength: 100 },
          subtitle: { type: 'string', minLength: 2, maxLength: 180 },
          startDay: { type: 'integer', minimum: 1, maximum: 30 },
          endDay: { type: 'integer', minimum: 1, maximum: 30 },
        },
      },
    },
    days: {
      type: 'array',
      minItems: CYCLE_DAYS,
      maxItems: CYCLE_DAYS,
      items: DAY_SCHEMA,
    },
  },
};

export function createPlanSchema(dailyMinutes, duration, cycleNumber = 1) {
  const maximumMinutes = Math.max(1, Math.min(120, Math.round(dailyMinutes)));
  const durationConfig = programDurationConfig(duration);
  if (!durationConfig) throw new TypeError('Unsupported program duration');
  if (
    !Number.isInteger(cycleNumber) ||
    cycleNumber < 1 ||
    cycleNumber > durationConfig.totalCycles
  ) {
    throw new TypeError('Unsupported program cycle');
  }
  const calendarDays = CYCLE_DAYS;
  const maximumSeconds = maximumMinutes * 60;
  const schema = structuredClone(PLAN_SCHEMA);
  const dayProperties = schema.properties.days.items.properties;

  schema.properties.duration.enum = [duration];
  schema.properties.totalCycles.enum = [durationConfig.totalCycles];
  schema.properties.cycleNumber = { type: 'number', enum: [cycleNumber] };
  schema.properties.targetCycleNumber.minimum = cycleNumber;
  schema.properties.targetCycleNumber.maximum = durationConfig.totalCycles;
  schema.properties.roadmap.minItems = durationConfig.totalCycles;
  schema.properties.roadmap.maxItems = durationConfig.totalCycles;
  dayProperties.dayNumber.maximum = calendarDays;
  dayProperties.estimatedMinutes.maximum = maximumMinutes;

  for (const blockVariant of dayProperties.execution.properties.blocks.items.anyOf) {
    const blockKind = blockVariant.properties.kind.enum[0];
    if (blockKind === 'timer') {
      blockVariant.properties.durationSecondsPerSet.maximum = maximumSeconds;
      blockVariant.properties.restSeconds.maximum = Math.min(1800, maximumSeconds);
    } else if (blockKind === 'counter') {
      blockVariant.properties.workSecondsPerSet.maximum = maximumSeconds;
      blockVariant.properties.restSeconds.maximum = Math.min(1800, maximumSeconds);
    } else {
      blockVariant.properties.estimatedSeconds.maximum = maximumSeconds;
    }
  }

  for (const phaseBoundary of ['startDay', 'endDay']) {
    schema.properties.phases.items.properties[phaseBoundary].maximum = calendarDays;
  }

  return schema;
}
