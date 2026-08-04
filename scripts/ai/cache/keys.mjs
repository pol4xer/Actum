import { createHash } from 'node:crypto';

export function createPlanCacheKey(input, identity) {
  const usesWebResearch = input.researchMode !== 'quick';
  return createHash('sha256')
    .update(
      JSON.stringify({
        promptVersion: identity.promptVersion,
        researchPromptVersion: usesWebResearch ? identity.researchPromptVersion : 'not-used',
        contractVersion: identity.contractVersion,
        validatorVersion: identity.validatorVersion,
        baselineParserVersion: identity.baselineParserVersion,
        model: identity.model,
        researchModel: usesWebResearch ? identity.researchModel : 'not-used',
        prompt: input.prompt.trim(),
        currentLevel: input.currentLevel,
        baseline: input.baseline.trim(),
        targetTimeline: input.targetTimeline.trim(),
        dailyMinutes: input.dailyMinutes,
        horizonDays: input.horizonDays,
        researchMode: input.researchMode === 'quick' ? 'quick' : 'web',
      }),
    )
    .digest('hex');
}

export function createResearchCacheKey(input, identity) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        researchPromptVersion: identity.researchPromptVersion,
        baselineParserVersion: identity.baselineParserVersion,
        researchModel: identity.researchModel,
        prompt: input.prompt.trim(),
        currentLevel: input.currentLevel,
        baseline: input.baseline.trim(),
        targetTimeline: input.targetTimeline.trim(),
        dailyMinutes: input.dailyMinutes,
        horizonDays: input.horizonDays,
        researchMode: input.researchMode === 'quick' ? 'quick' : 'web',
      }),
    )
    .digest('hex');
}

export function providerStageKey(cacheKey, stage) {
  return `${stage}\u0000${cacheKey}`;
}
