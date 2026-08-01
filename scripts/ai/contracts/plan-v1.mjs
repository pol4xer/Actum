export const PLAN_CONTRACT_VERSION = 'plan-v5';

const LOAD_BASIS_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['percentage', 'baseValue', 'baseUnit', 'result'],
      properties: {
        percentage: { type: 'number', minimum: 0.01, maximum: 1000 },
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
  required: ['kind', 'blocks', 'successCriterion'],
  properties: {
    kind: { type: 'string', enum: ['in_app'] },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        anyOf: [
          TIMER_BLOCK_SCHEMA,
          COUNTER_BLOCK_SCHEMA,
          CHECKLIST_BLOCK_SCHEMA,
          TEXT_LOG_BLOCK_SCHEMA,
        ],
      },
    },
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

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
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
  ],
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 120 },
    domain: {
      type: 'string',
      enum: ['read', 'learn', 'practice', 'organize', 'move', 'habit'],
    },
    targetMetric: { type: 'string', minLength: 3, maxLength: 220 },
    targetTimeline: { type: 'string', minLength: 2, maxLength: 80 },
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
      minItems: 7,
      maxItems: 30,
      items: DAY_SCHEMA,
    },
  },
};

export function createPlanSchema(dailyMinutes, horizonDays) {
  const maximumMinutes = Math.max(1, Math.min(120, Math.round(dailyMinutes)));
  const calendarDays = Math.max(1, Math.min(30, Math.round(horizonDays)));
  const maximumSeconds = maximumMinutes * 60;
  const schema = structuredClone(PLAN_SCHEMA);
  const dayProperties = schema.properties.days.items.properties;

  schema.properties.days.minItems = calendarDays;
  schema.properties.days.maxItems = calendarDays;
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
