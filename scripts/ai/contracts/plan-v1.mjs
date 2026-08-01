export const PLAN_CONTRACT_VERSION = 'plan-v4';

const ROUTINE_ACTION_REQUIRED = [
  'title',
  'instruction',
  'sets',
  'quantity',
  'workSecondsPerSet',
  'unit',
  'unitLabel',
  'loadBasis',
  'restSeconds',
  'tempo',
  'successCriterion',
];

const ROUTINE_ACTION_PROPERTIES = {
  title: { type: 'string', minLength: 2, maxLength: 100 },
  instruction: { type: 'string', minLength: 8, maxLength: 360 },
  sets: { type: 'integer', minimum: 1, maximum: 20 },
  quantity: { type: 'number', minimum: 0.01, maximum: 1_000_000 },
  workSecondsPerSet: { type: 'integer', minimum: 1, maximum: 7200 },
  restSeconds: { type: 'integer', minimum: 0, maximum: 1800 },
  loadBasis: {
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
  },
  tempo: {
    anyOf: [
      { type: 'string', minLength: 2, maxLength: 100 },
      { type: 'null' },
    ],
  },
  successCriterion: { type: 'string', minLength: 5, maxLength: 260 },
};

function routineActionVariant(unit, unitLabel, quantity = ROUTINE_ACTION_PROPERTIES.quantity) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ROUTINE_ACTION_REQUIRED,
    properties: { ...ROUTINE_ACTION_PROPERTIES, quantity, unit, unitLabel },
  };
}

const EXECUTION_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'durationSeconds', 'successCriterion'],
      properties: {
        kind: { type: 'string', enum: ['manual'] },
        durationSeconds: { type: 'null' },
        successCriterion: { type: 'string', minLength: 5, maxLength: 320 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'durationSeconds', 'successCriterion'],
      properties: {
        kind: { type: 'string', enum: ['timer'] },
        durationSeconds: { type: 'integer', minimum: 1, maximum: 7200 },
        successCriterion: { type: 'string', minLength: 5, maxLength: 320 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'actions', 'successCriterion'],
      properties: {
        kind: { type: 'string', enum: ['routine'] },
        actions: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            anyOf: [
              routineActionVariant(
                {
                  type: 'string',
                  enum: ['reps', 'pages', 'items', 'words', 'attempts'],
                },
                { type: 'null' },
                { type: 'integer', minimum: 1, maximum: 1_000_000 },
              ),
              routineActionVariant(
                { type: 'string', enum: ['seconds', 'minutes', 'meters'] },
                { type: 'null' },
              ),
              routineActionVariant(
                { type: 'string', enum: ['custom'] },
                { type: 'string', minLength: 1, maxLength: 40 },
              ),
            ],
          },
        },
        successCriterion: { type: 'string', minLength: 5, maxLength: 320 },
      },
    },
  ],
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
    'steps',
    'execution',
    'progressionRule',
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
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: { type: 'string', minLength: 2, maxLength: 300 },
    },
    execution: EXECUTION_SCHEMA,
    progressionRule: { type: 'string', minLength: 8, maxLength: 420 },
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
  const schema = structuredClone(PLAN_SCHEMA);
  const dayProperties = schema.properties.days.items.properties;

  schema.properties.days.minItems = calendarDays;
  schema.properties.days.maxItems = calendarDays;
  dayProperties.dayNumber.maximum = calendarDays;
  dayProperties.estimatedMinutes.maximum = maximumMinutes;
  dayProperties.execution.anyOf[1].properties.durationSeconds.maximum = maximumMinutes * 60;
  for (const routineVariant of dayProperties.execution.anyOf[2].properties.actions.items.anyOf) {
    routineVariant.properties.workSecondsPerSet.maximum = maximumMinutes * 60;
    routineVariant.properties.restSeconds.maximum = maximumMinutes * 60;
  }

  for (const phaseBoundary of ['startDay', 'endDay']) {
    schema.properties.phases.items.properties[phaseBoundary].maximum = calendarDays;
  }

  return schema;
}
