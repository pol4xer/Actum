export const PLAN_CONTRACT_VERSION = 'plan-v2';

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
                'xp',
                'steps',
                'execution',
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
                xp: { type: 'integer', minimum: 10, maximum: 60 },
                steps: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 6,
                  items: { type: 'string', minLength: 2, maxLength: 260 },
                },
                execution: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind', 'durationSeconds'],
                  properties: {
                    kind: { type: 'string', enum: ['manual', 'timer'] },
                    durationSeconds: {
                      anyOf: [
                        { type: 'integer', minimum: 1, maximum: 7200 },
                        { type: 'null' },
                      ],
                    },
                  },
                },
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
