import type { GeneratedGoal, GoalInput } from '@/domain/types';

import {
  createPlanResponseDtoSchema,
  savedPlanEnvelopeDtoSchema,
  type PlanDto,
  type PlanMetaDto,
} from './api-contract';
import { AIPlannerError, mapServerErrorCode } from './errors';
import { mapPlanDtoToGeneratedGoal } from './generated-goal-mapper';
import type { GenerateGoalOptions, GoalPlanner } from './goal-planner';

export const DEFAULT_AI_URL = 'http://127.0.0.1:8787';

export type GoalPlannerTimeouts = Readonly<{
  quickGenerationMs: number;
  webGenerationMs: number;
  savedPlanRecoveryMs: number;
  gatewayProbeMs: number;
}>;

export const DEFAULT_GOAL_PLANNER_TIMEOUTS: GoalPlannerTimeouts = {
  quickGenerationMs: 14 * 60_000,
  webGenerationMs: 26 * 60_000,
  savedPlanRecoveryMs: 5_000,
  gatewayProbeMs: 3_000,
};

type FetchImplementation = typeof globalThis.fetch;
type GeneratedGoalMapper = (
  input: GoalInput,
  plan: PlanDto,
  meta: PlanMetaDto,
) => GeneratedGoal;

export type HttpGoalPlannerOptions = Readonly<{
  baseUrl?: string;
  fetch?: FetchImplementation;
  timeouts?: Partial<GoalPlannerTimeouts>;
  requestIdFactory?: () => string;
  mapper?: GeneratedGoalMapper;
  logger?: Pick<Console, 'log'>;
}>;

export class HttpGoalPlanner implements GoalPlanner {
  private readonly baseUrl: string;
  private readonly fetch: FetchImplementation;
  private readonly timeouts: GoalPlannerTimeouts;
  private readonly requestIdFactory: () => string;
  private readonly mapper: GeneratedGoalMapper;
  private readonly logger: Pick<Console, 'log'>;

  constructor(options: HttpGoalPlannerOptions = {}) {
    this.baseUrl = resolveAIBaseUrl(options.baseUrl);
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeouts = { ...DEFAULT_GOAL_PLANNER_TIMEOUTS, ...options.timeouts };
    this.requestIdFactory = options.requestIdFactory ?? createClientRequestId;
    this.mapper = options.mapper ?? mapPlanDtoToGeneratedGoal;
    this.logger = options.logger ?? console;
  }

  async generateGoal(
    input: GoalInput,
    options: GenerateGoalOptions = {},
  ): Promise<GeneratedGoal> {
    const controller = new AbortController();
    const requestId = this.requestIdFactory();
    const timeoutMs =
      input.researchMode === 'quick'
        ? this.timeouts.quickGenerationMs
        : this.timeouts.webGenerationMs;
    let timeoutTriggered = false;
    const timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await this.fetch(`${this.baseUrl}/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Actum-Request-Id': requestId,
          ...(options.reuseOnly ? { 'X-Actum-Reuse-Only': 'true' } : {}),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const raw: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message = readServerErrorMessage(raw) ?? 'The AI server could not create a plan.';
        const serverRequestId = readTopLevelRequestId(raw);
        throw new AIPlannerError(
          `${message}\nRequest: ${serverRequestId || requestId}`,
          mapServerErrorCode(raw, response.status),
        );
      }

      const parsed = createPlanResponseDtoSchema(input).safeParse(raw);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        const issuePath = firstIssue?.path.length ? firstIssue.path.join('.') : 'response';
        const responseRequestId = readResponseRequestId(raw) || requestId;
        this.logger.log(
          `[actum-ai] incompatible response request=${responseRequestId} field=${issuePath} issue=${firstIssue?.code || 'unknown'}`,
        );
        throw new AIPlannerError(
          `The plan was created, but the app could not read the "${issuePath}" field.\nRequest: ${responseRequestId}`,
          'INVALID_RESPONSE',
        );
      }

      return this.mapper(input, parsed.data.plan, parsed.data.meta);
    } catch (error) {
      if (error instanceof AIPlannerError) throw error;
      if (timeoutTriggered || controller.signal.aborted) {
        throw new AIPlannerError(
          `The app timed out while waiting for the plan. The server may still be working; retrying with the same settings will reconnect to that request or use its cached result.\nRequest: ${requestId}`,
          'TIMEOUT',
        );
      }

      const gatewayReachable = await this.probeGateway();
      throw new AIPlannerError(
        gatewayReachable
          ? `The connection to the AI server was interrupted, but the server is reachable. Check the "Actum - AI server" window and retry; completed work will be reused.\nRequest: ${requestId}`
          : `The AI server is unavailable at ${this.baseUrl}. Start the project with \`./scripts/dev-ios.sh\` and check the "Actum - AI server" window.\nRequest: ${requestId}`,
        gatewayReachable ? 'CONNECTION_INTERRUPTED' : 'GATEWAY_UNREACHABLE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async recoverLatestSavedGoal(): Promise<GeneratedGoal | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.timeouts.savedPlanRecoveryMs,
    );

    try {
      const response = await this.fetch(`${this.baseUrl}/saved-plan/latest`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error('The local AI server did not return a saved plan.');

      const raw: unknown = await response.json();
      const envelope = savedPlanEnvelopeDtoSchema.safeParse(raw);
      if (!envelope.success) throw new Error('The saved plan has an incompatible format.');
      const { input, plan, meta } = envelope.data;
      const parsed = createPlanResponseDtoSchema(input).safeParse({ plan, meta });
      if (!parsed.success) throw new Error('The saved plan-v7 did not pass client validation.');
      return this.mapper(input, parsed.data.plan, parsed.data.meta);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async probeGateway() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeouts.gatewayProbeMs);
    try {
      const response = await this.fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createHttpGoalPlanner(options: HttpGoalPlannerOptions = {}): GoalPlanner {
  return new HttpGoalPlanner(options);
}

export const defaultGoalPlanner = createHttpGoalPlanner();

export function resolveAIBaseUrl(configuredUrl?: string) {
  return (configuredUrl || process.env.EXPO_PUBLIC_ACTUM_AI_URL || DEFAULT_AI_URL).replace(
    /\/$/,
    '',
  );
}

function createClientRequestId() {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `actum_${stamp}_${random}`;
}

function readServerErrorMessage(raw: unknown) {
  if (!raw || typeof raw !== 'object' || !('error' in raw)) return undefined;
  return typeof raw.error === 'string' ? raw.error : undefined;
}

function readTopLevelRequestId(raw: unknown) {
  if (!raw || typeof raw !== 'object' || !('requestId' in raw)) return undefined;
  return typeof raw.requestId === 'string' ? raw.requestId : undefined;
}

function readResponseRequestId(raw: unknown) {
  if (!raw || typeof raw !== 'object' || !('meta' in raw)) return undefined;
  const meta = raw.meta;
  if (!meta || typeof meta !== 'object' || !('requestId' in meta)) return undefined;
  return typeof meta.requestId === 'string' ? meta.requestId : undefined;
}
