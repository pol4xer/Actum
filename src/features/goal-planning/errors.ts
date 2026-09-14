export type AIPlannerErrorCode =
  | 'TIMEOUT'
  | 'GATEWAY_UNREACHABLE'
  | 'CONNECTION_INTERRUPTED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'REFUSAL'
  | 'INVALID_REQUEST'
  | 'SAVED_RESPONSE_UNAVAILABLE'
  | 'RESEARCH_CACHE_UNAVAILABLE'
  | 'RETRY_CAP_TOO_SHORT'
  | 'GOAL_NOT_FEASIBLE'
  | 'INVALID_RESPONSE';

export const RESEARCH_CACHE_UNAVAILABLE_MESSAGE =
  'Saved research is unavailable. No new search was started.';
export const RETRY_CAP_TOO_SHORT_MESSAGE = 'Choose a longer time limit.';
export const GOAL_NOT_FEASIBLE_MESSAGE =
  'Research could not confirm that this goal is achievable within a year.';
export const SAVED_RESPONSE_REVIEW_MESSAGE =
  'The response is saved and ready for another validation attempt';
export const SAVED_RESPONSE_RETRY_LABEL = 'Validate saved response · no GPT request';

export function isFeasibilityPlannerError(
  code: AIPlannerErrorCode | undefined,
): code is 'RETRY_CAP_TOO_SHORT' | 'GOAL_NOT_FEASIBLE' {
  return code === 'RETRY_CAP_TOO_SHORT' || code === 'GOAL_NOT_FEASIBLE';
}

export function shouldOfferPlannerRetry(code: AIPlannerErrorCode | undefined): boolean {
  return (
    code !== 'SAVED_RESPONSE_UNAVAILABLE' &&
    code !== 'RESEARCH_CACHE_UNAVAILABLE' &&
    !isFeasibilityPlannerError(code)
  );
}

export class AIPlannerError extends Error {
  readonly code: AIPlannerErrorCode;

  constructor(message: string, code: AIPlannerErrorCode) {
    super(message);
    this.name = 'AIPlannerError';
    this.code = code;
  }
}

export function mapServerErrorCode(raw: unknown, status: number): AIPlannerErrorCode {
  const code =
    raw && typeof raw === 'object' && 'code' in raw && typeof raw.code === 'string'
      ? raw.code
      : undefined;

  if (code === 'research_target_exceeds_retry_cap') return 'RETRY_CAP_TOO_SHORT';
  if (code === 'research_target_not_feasible') return 'GOAL_NOT_FEASIBLE';
  if (code === 'refusal' || status === 422) return 'REFUSAL';
  if (code === 'saved_response_unavailable') return 'SAVED_RESPONSE_UNAVAILABLE';
  if (code === 'research_cache_unavailable') return 'RESEARCH_CACHE_UNAVAILABLE';
  if (code === 'upstream_timeout' || status === 504) return 'UPSTREAM_TIMEOUT';
  if (
    code === 'upstream_invalid_plan_contract' ||
    code === 'upstream_invalid_plan_json' ||
    code === 'upstream_invalid_research_contract' ||
    code === 'upstream_invalid_research_json' ||
    code === 'upstream_missing_plan' ||
    code === 'upstream_missing_research_brief' ||
    code === 'upstream_insufficient_research_searches' ||
    code === 'upstream_missing_research_sources'
  ) {
    return 'INVALID_RESPONSE';
  }
  if (status === 400) return 'INVALID_REQUEST';
  return 'UPSTREAM_ERROR';
}
