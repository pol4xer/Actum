import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASELINE_PARSER_VERSION } from '../contracts/parse-baseline.mjs';
import { PLAN_CONTRACT_VERSION } from '../contracts/plan-v1.mjs';
import { PLAN_VALIDATOR_VERSION } from '../contracts/validate-plan.mjs';
import { PROMPT_VERSION, RESEARCH_PROMPT_VERSION } from '../prompts/plan-v1.mjs';

export const MAX_CONCURRENT_PLANS = 2;
export const RESEARCH_TIMEOUT_MS = 12 * 60_000;
export const PLANNING_TIMEOUT_MS = 12 * 60_000;

/**
 * Runtime configuration is intentionally created by the composition root.
 * Query-string imports are used to model a process restart in tests, so reading
 * process.env at this factory boundary keeps each imported server independent.
 */
export function createRuntimeConfig({ env = process.env, serverModuleUrl } = {}) {
  if (typeof serverModuleUrl !== 'string') {
    throw new TypeError('serverModuleUrl is required');
  }

  const model = env.OPENAI_MODEL || 'gpt-5.6';
  const researchModel = env.OPENAI_RESEARCH_MODEL || model;
  const cacheIdentity = Object.freeze({
    promptVersion: PROMPT_VERSION,
    researchPromptVersion: RESEARCH_PROMPT_VERSION,
    contractVersion: PLAN_CONTRACT_VERSION,
    validatorVersion: PLAN_VALIDATOR_VERSION,
    baselineParserVersion: BASELINE_PARSER_VERSION,
    model,
    researchModel,
  });

  return Object.freeze({
    port: Number(env.ACTUM_AI_PORT || 8787),
    host: env.ACTUM_AI_HOST || '127.0.0.1',
    model,
    researchModel,
    openAIApiKey: env.OPENAI_API_KEY,
    stateFile:
      env.ACTUM_AI_STATE_FILE ||
      resolve(dirname(fileURLToPath(serverModuleUrl)), '..', '.actum', 'ai-state.json'),
    cacheIdentity,
  });
}
