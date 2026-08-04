export type AIPlannerErrorCode =
  | 'TIMEOUT'
  | 'GATEWAY_UNREACHABLE'
  | 'CONNECTION_INTERRUPTED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'REFUSAL'
  | 'INVALID_REQUEST'
  | 'SAVED_RESPONSE_UNAVAILABLE'
  | 'INVALID_RESPONSE';

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

  if (code === 'refusal' || status === 422) return 'REFUSAL';
  if (code === 'saved_response_unavailable') return 'SAVED_RESPONSE_UNAVAILABLE';
  if (code === 'upstream_timeout' || status === 504) return 'UPSTREAM_TIMEOUT';
  if (
    code === 'upstream_invalid_plan_contract' ||
    code === 'upstream_invalid_plan_json' ||
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
