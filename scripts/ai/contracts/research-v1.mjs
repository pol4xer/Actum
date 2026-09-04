export const MAX_RESEARCH_CYCLES = 12;

export const RESEARCH_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['brief', 'earliestTargetCycleNumber', 'feasibilityReason'],
  properties: {
    brief: { type: 'string', minLength: 80, maxLength: 12_000 },
    earliestTargetCycleNumber: {
      anyOf: [
        { type: 'integer', minimum: 1, maximum: MAX_RESEARCH_CYCLES },
        { type: 'null' },
      ],
    },
    feasibilityReason: { type: 'string', minLength: 8, maxLength: 1_000 },
  },
});

export function parseResearchConclusion(outputText) {
  let value;
  try {
    value = JSON.parse(outputText);
  } catch (cause) {
    throw new ResearchContractError('Web-research вернул нечитаемый JSON.', {
      code: 'upstream_invalid_research_json',
      cause,
    });
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('research', 'ожидается объект');
  }
  const expectedKeys = new Set(RESEARCH_SCHEMA.required);
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) fail(`research.${key}`, 'поле не поддерживается');
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) fail(`research.${key}`, 'обязательное поле отсутствует');
  }

  assertBoundedString(value.brief, 'research.brief', 80, 12_000);
  assertBoundedString(value.feasibilityReason, 'research.feasibilityReason', 8, 1_000);
  if (
    value.earliestTargetCycleNumber !== null &&
    (!Number.isInteger(value.earliestTargetCycleNumber) ||
      value.earliestTargetCycleNumber < 1 ||
      value.earliestTargetCycleNumber > MAX_RESEARCH_CYCLES)
  ) {
    fail(
      'research.earliestTargetCycleNumber',
      `ожидается целый номер цикла от 1 до ${MAX_RESEARCH_CYCLES} или null`,
    );
  }
  return value;
}

export class ResearchContractError extends Error {
  constructor(message, { code = 'upstream_invalid_research_contract', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ResearchContractError';
    this.code = code;
  }
}

function assertBoundedString(value, path, minimum, maximum) {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) {
    fail(path, `ожидается строка длиной от ${minimum} до ${maximum} символов`);
  }
}

function fail(path, message) {
  throw new ResearchContractError(`${path}: ${message}`);
}
