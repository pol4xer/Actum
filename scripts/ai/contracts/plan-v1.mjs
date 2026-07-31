export const PLAN_CONTRACT_VERSION = 'plan-v3';

const ROUTINE_ACTION_REQUIRED = [
  'title',
  'instruction',
  'sets',
  'quantity',
  'unit',
  'unitLabel',
  'restSeconds',
  'tempo',
  'successCriterion',
];

const ROUTINE_ACTION_PROPERTIES = {
  title: { type: 'string', minLength: 2, maxLength: 100 },
  instruction: { type: 'string', minLength: 8, maxLength: 300 },
  sets: { type: 'integer', minimum: 1, maximum: 20 },
  quantity: { type: 'integer', minimum: 1, maximum: 10000 },
  restSeconds: { type: 'integer', minimum: 0, maximum: 1800 },
  tempo: {
    anyOf: [
      { type: 'string', minLength: 2, maxLength: 100 },
      { type: 'null' },
    ],
  },
  successCriterion: { type: 'string', minLength: 5, maxLength: 240 },
};

function routineActionVariant(unit, unitLabel) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ROUTINE_ACTION_REQUIRED,
    properties: { ...ROUTINE_ACTION_PROPERTIES, unit, unitLabel },
  };
}

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'domain',
    'targetMetric',
    'summary',
    'safetyNotes',
    'assumptions',
    'sourceLabels',
    'chapters',
  ],
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 120 },
    domain: {
      type: 'string',
      enum: ['read', 'learn', 'practice', 'organize', 'move', 'habit'],
    },
    targetMetric: { type: 'string', minLength: 3, maxLength: 180 },
    summary: { type: 'string', minLength: 10, maxLength: 500 },
    safetyNotes: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', minLength: 3, maxLength: 300 },
    },
    assumptions: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: { type: 'string', minLength: 3, maxLength: 300 },
    },
    sourceLabels: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: { type: 'string', minLength: 2, maxLength: 160 },
    },
    chapters: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'subtitle', 'missions'],
        properties: {
          title: { type: 'string', minLength: 2, maxLength: 100 },
          subtitle: { type: 'string', minLength: 2, maxLength: 160 },
          missions: {
            type: 'array',
            minItems: 2,
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'title',
                'description',
                'type',
                'estimatedMinutes',
                'repeatCount',
                'xp',
                'steps',
                'execution',
                'progressionRule',
                'warning',
              ],
              properties: {
                title: { type: 'string', minLength: 2, maxLength: 120 },
                description: { type: 'string', minLength: 5, maxLength: 500 },
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
                repeatCount: { type: 'integer', minimum: 1, maximum: 28 },
                xp: { type: 'integer', minimum: 10, maximum: 60 },
                steps: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 6,
                  items: { type: 'string', minLength: 2, maxLength: 260 },
                },
                execution: {
                  anyOf: [
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: ['kind', 'durationSeconds', 'successCriterion'],
                      properties: {
                        kind: { type: 'string', enum: ['manual'] },
                        durationSeconds: { type: 'null' },
                        successCriterion: {
                          type: 'string',
                          minLength: 5,
                          maxLength: 300,
                        },
                      },
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: ['kind', 'durationSeconds', 'successCriterion'],
                      properties: {
                        kind: { type: 'string', enum: ['timer'] },
                        durationSeconds: {
                          type: 'integer',
                          minimum: 1,
                          maximum: 7200,
                        },
                        successCriterion: {
                          type: 'string',
                          minLength: 5,
                          maxLength: 300,
                        },
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
                          maxItems: 8,
                          items: {
                            anyOf: [
                              routineActionVariant(
                                {
                                  type: 'string',
                                  enum: [
                                    'reps',
                                    'seconds',
                                    'minutes',
                                    'pages',
                                    'items',
                                    'words',
                                    'meters',
                                    'attempts',
                                  ],
                                },
                                { type: 'null' },
                              ),
                              routineActionVariant(
                                { type: 'string', enum: ['custom'] },
                                { type: 'string', minLength: 1, maxLength: 40 },
                              ),
                            ],
                          },
                        },
                        successCriterion: {
                          type: 'string',
                          minLength: 5,
                          maxLength: 300,
                        },
                      },
                    },
                  ],
                },
                progressionRule: { type: 'string', minLength: 8, maxLength: 360 },
                warning: {
                  anyOf: [
                    { type: 'string', minLength: 3, maxLength: 300 },
                    { type: 'null' },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
};

export function createPlanSchema(dailyMinutes) {
  const maximumMinutes = Math.max(1, Math.min(120, Math.round(dailyMinutes)));
  const schema = structuredClone(PLAN_SCHEMA);
  const missionProperties =
    schema.properties.chapters.items.properties.missions.items.properties;
  missionProperties.estimatedMinutes.maximum = maximumMinutes;
  missionProperties.execution.anyOf[1].properties.durationSeconds.maximum =
    maximumMinutes * 60;
  return schema;
}
