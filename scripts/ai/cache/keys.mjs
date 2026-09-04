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
        duration: input.duration,
        cycleNumber: input.cycleNumber ?? 1,
        dailyMinutes: input.dailyMinutes,
        programContext: input.programContext ?? null,
        researchMode: input.researchMode === 'quick' ? 'quick' : 'web',
      }),
    )
    .digest('hex');
}

export function createResearchCacheKey(input, identity) {
  const researchAnchor = createResearchAnchor(input);
  return createHash('sha256')
    .update(
      JSON.stringify({
        researchPromptVersion: identity.researchPromptVersion,
        baselineParserVersion: identity.baselineParserVersion,
        researchModel: identity.researchModel,
        researchAnchor,
        researchMode: input.researchMode === 'quick' ? 'quick' : 'web',
      }),
    )
    .digest('hex');
}

export function createResearchAnchor(input) {
  const supplied = input.programContext?.researchAnchor;
  if (supplied != null) {
    if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) {
      throw new TypeError('Invalid research anchor');
    }
    return supplied;
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        prompt: normalizedIdentityText(input.prompt),
        currentLevel: input.currentLevel,
        baseline: normalizedIdentityText(input.baseline),
        dailyMinutes: input.dailyMinutes,
      }),
    )
    .digest('hex');
}

function normalizedIdentityText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU')
    : '';
}

export function providerStageKey(cacheKey, stage) {
  return `${stage}\u0000${cacheKey}`;
}
