import { performance } from 'node:perf_hooks';

const RESPONSES_URL =
  process.env.ACTUM_OPENAI_RESPONSES_URL || 'https://api.openai.com/v1/responses';
const DEFAULT_HTTP_TIMEOUT_MS = 60_000;
const DEFAULT_STAGE_TIMEOUT_MS = 9 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_RETRIES = 3;
const PROGRESS_LOG_INTERVAL_MS = 30_000;

export class OpenAIRequestError extends Error {
  constructor(
    message,
    {
      status,
      code,
      stage,
      operation,
      durationMs,
      providerResponseId,
      providerRequestId,
      retryAfterMs,
      terminal,
      cause,
    } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OpenAIRequestError';
    this.status = status;
    this.code = code;
    this.stage = stage;
    this.operation = operation;
    this.durationMs = durationMs;
    this.providerResponseId = providerResponseId;
    this.providerRequestId = providerRequestId;
    this.retryAfterMs = retryAfterMs;
    this.terminal = terminal;
  }
}

export async function createOpenAIResponse({
  apiKey,
  body,
  stage = 'unknown',
  timeoutMs = DEFAULT_STAGE_TIMEOUT_MS,
  httpTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onProgress,
  onResponseId,
  resumeResponseId,
}) {
  const startedAt = performance.now();
  const deadlineAt = startedAt + positiveInteger(timeoutMs, DEFAULT_STAGE_TIMEOUT_MS);
  let providerRequestId;
  let payload;
  let responseId = boundedStringOrUndefined(resumeResponseId, 4, 180);

  if (resumeResponseId != null && !responseId) {
    throw providerError('Некорректный ID фонового запроса OpenAI.', {
      status: 502,
      code: 'upstream_invalid_response_id',
      stage,
      operation: 'resume',
      startedAt,
    });
  }

  if (responseId) {
    const resumed = await retrieveWithRetry({
      apiKey,
      responseId,
      stage,
      startedAt,
      deadlineAt,
      httpTimeoutMs,
      onProgress,
    });
    payload = resumed.payload;
    providerRequestId = resumed.providerRequestId;
    reportProgress(onProgress, {
      type: 'resumed',
      stage,
      status: payload?.status || 'unknown',
      responseId,
      providerRequestId,
      elapsedMs: elapsedMs(startedAt),
    });
  } else {
    const created = await requestJson(RESPONSES_URL, {
      apiKey,
      method: 'POST',
      body: { ...body, background: true },
      stage,
      operation: 'create',
      startedAt,
      timeoutMs: requestTimeout(deadlineAt, httpTimeoutMs),
    });
    payload = created.payload;
    providerRequestId = created.providerRequestId;
    responseId = responseIdOrUndefined(payload);
    if (responseId && typeof onResponseId === 'function') {
      onResponseId({
        stage,
        responseId,
        providerRequestId,
        elapsedMs: elapsedMs(startedAt),
      });
    }
    reportProgress(onProgress, {
      type: 'created',
      stage,
      status: payload?.status || 'completed',
      responseId,
      providerRequestId,
      elapsedMs: elapsedMs(startedAt),
    });
  }

  let lastReportedStatus;
  let lastReportedAt = 0;
  while (payload?.status === 'queued' || payload?.status === 'in_progress') {
    if (!responseId) {
      throw providerError('OpenAI не вернул ID фонового запроса.', {
        status: 502,
        code: 'upstream_invalid_response',
        stage,
        operation: 'create',
        startedAt,
        providerRequestId,
      });
    }

    const remainingMs = deadlineAt - performance.now();
    if (remainingMs <= 0) {
      throw providerError('OpenAI не завершил запрос вовремя.', {
        status: 504,
        code: 'upstream_timeout',
        stage,
        operation: 'poll',
        startedAt,
        providerResponseId: responseId,
        providerRequestId,
      });
    }
    await delay(Math.min(positiveInteger(pollIntervalMs, DEFAULT_POLL_INTERVAL_MS), remainingMs));

    const retrieved = await retrieveWithRetry({
      apiKey,
      responseId,
      stage,
      startedAt,
      deadlineAt,
      httpTimeoutMs,
      onProgress,
    });
    payload = retrieved.payload;
    providerRequestId = retrieved.providerRequestId || providerRequestId;

    const now = performance.now();
    if (
      payload?.status !== lastReportedStatus ||
      now - lastReportedAt >= PROGRESS_LOG_INTERVAL_MS
    ) {
      lastReportedStatus = payload?.status;
      lastReportedAt = now;
      reportProgress(onProgress, {
        type: 'status',
        stage,
        status: payload?.status || 'unknown',
        responseId,
        providerRequestId,
        elapsedMs: elapsedMs(startedAt),
      });
    }
  }

  if (payload?.status && payload.status !== 'completed') {
    const terminalMessage =
      payload?.error?.message ||
      payload?.incomplete_details?.reason ||
      `OpenAI завершил запрос со статусом ${payload.status}.`;
    throw providerError(terminalMessage, {
      status: 502,
      code: payload?.error?.code || `response_${payload.status}`,
      stage,
      operation: 'poll',
      startedAt,
      providerResponseId: responseId,
      providerRequestId,
      terminal: true,
    });
  }

  const refusal = contentItems(payload).find((content) => content.type === 'refusal');
  if (refusal) {
    throw providerError(refusal.refusal || 'OpenAI отказался обработать эту цель.', {
      status: 422,
      code: 'refusal',
      stage,
      operation: 'complete',
      startedAt,
      providerResponseId: responseId,
      providerRequestId,
      terminal: true,
    });
  }

  return payload;
}

async function retrieveWithRetry({
  apiKey,
  responseId,
  stage,
  startedAt,
  deadlineAt,
  httpTimeoutMs,
  onProgress,
}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await requestJson(`${RESPONSES_URL}/${encodeURIComponent(responseId)}`, {
        apiKey,
        method: 'GET',
        stage,
        operation: 'poll',
        startedAt,
        timeoutMs: requestTimeout(deadlineAt, httpTimeoutMs),
        providerResponseId: responseId,
      });
    } catch (error) {
      if (
        !(error instanceof OpenAIRequestError) ||
        !isRetryablePollError(error) ||
        attempt >= MAX_POLL_RETRIES
      ) {
        throw error;
      }

      const remainingMs = deadlineAt - performance.now();
      if (remainingMs <= 0) throw error;
      const fallbackDelayMs = Math.min(500 * 2 ** (attempt - 1), 5_000);
      const retryDelayMs = Math.min(error.retryAfterMs ?? fallbackDelayMs, remainingMs);
      reportProgress(onProgress, {
        type: 'poll_retry',
        stage,
        status: 'retrying',
        responseId,
        attempt,
        retryDelayMs,
        elapsedMs: elapsedMs(startedAt),
        error: safeErrorDetails(error),
        providerRequestId: error.providerRequestId,
      });
      await delay(retryDelayMs);
    }
  }
}

async function requestJson(
  url,
  {
    apiKey,
    method,
    body,
    stage,
    operation,
    startedAt,
    timeoutMs,
    providerResponseId,
  },
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));

  try {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw providerError(
        timedOut || controller.signal.aborted
          ? 'Соединение с OpenAI превысило допустимое время.'
          : 'Сетевое соединение с OpenAI прервалось.',
        {
          status: timedOut || controller.signal.aborted ? 504 : 502,
          code:
            timedOut || controller.signal.aborted
              ? 'upstream_timeout'
              : 'upstream_network_error',
          stage,
          operation,
          startedAt,
          providerResponseId,
          cause,
        },
      );
    }

    const providerRequestId = boundedStringOrUndefined(
      response.headers.get('x-request-id'),
      4,
      180,
    );
    const text = await response.text().catch((cause) => {
      const readTimedOut = timedOut || controller.signal.aborted;
      throw providerError(
        readTimedOut
          ? 'Чтение ответа OpenAI превысило допустимое время.'
          : 'Не удалось прочитать ответ OpenAI.',
        {
          status: readTimedOut ? 504 : 502,
          code: readTimedOut ? 'upstream_timeout' : 'upstream_read_error',
          stage,
          operation,
          startedAt,
          providerResponseId,
          providerRequestId,
          cause,
        },
      );
    });
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (cause) {
        throw providerError('OpenAI вернул нечитаемый ответ.', {
          status: 502,
          code: 'upstream_invalid_json',
          stage,
          operation,
          startedAt,
          providerResponseId,
          providerRequestId,
          cause,
        });
      }
    }

    if (!response.ok) {
      throw providerError(payload?.error?.message || `OpenAI API error ${response.status}`, {
        status: response.status,
        code: payload?.error?.code || `openai_http_${response.status}`,
        stage,
        operation,
        startedAt,
        providerResponseId,
        providerRequestId,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      });
    }

    if (!payload || typeof payload !== 'object') {
      throw providerError('OpenAI вернул пустой ответ.', {
        status: 502,
        code: 'upstream_invalid_response',
        stage,
        operation,
        startedAt,
        providerResponseId,
        providerRequestId,
      });
    }

    return { payload, providerRequestId };
  } finally {
    clearTimeout(timeout);
  }
}

function providerError(message, options) {
  return new OpenAIRequestError(message, {
    ...options,
    durationMs: elapsedMs(options.startedAt),
  });
}

function isRetryablePollError(error) {
  return (
    error.code === 'upstream_network_error' ||
    error.code === 'upstream_timeout' ||
    error.status === 429 ||
    (typeof error.status === 'number' && error.status >= 500)
  );
}

function requestTimeout(deadlineAt, configuredTimeoutMs) {
  return Math.max(
    1,
    Math.min(
      positiveInteger(configuredTimeoutMs, DEFAULT_HTTP_TIMEOUT_MS),
      Math.max(1, deadlineAt - performance.now()),
    ),
  );
}

function reportProgress(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(event);
  } catch {
    // Logging must never interrupt a paid provider request.
  }
}

function responseIdOrUndefined(payload) {
  return boundedStringOrUndefined(payload?.id, 4, 180);
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function elapsedMs(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, durationMs)));
}

export function safeErrorDetails(error) {
  const cause = error instanceof Error ? error.cause : undefined;
  const rootCause = cause instanceof Error ? cause.cause : undefined;
  return {
    name: safeToken(error?.name),
    code: safeToken(error?.code),
    causeName: safeToken(cause?.name),
    causeCode: safeToken(cause?.code),
    rootCauseName: safeToken(rootCause?.name),
    rootCauseCode: safeToken(rootCause?.code),
  };
}

export function extractOutputText(payload) {
  return contentItems(payload).find((content) => content.type === 'output_text')?.text;
}

export function extractWebSources(payload) {
  const seen = new Set();
  const sources = [];

  for (const content of contentItems(payload)) {
    for (const annotation of content.annotations || []) {
      if (annotation.type !== 'url_citation') continue;
      const citation = annotation.url_citation || annotation;
      if (typeof citation.url !== 'string') continue;
      const url = citation.url.trim();
      if (url.length > 2_000 || seen.has(url)) continue;
      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) continue;
      } catch {
        continue;
      }
      seen.add(url);
      const rawTitle =
        typeof citation.title === 'string' && citation.title.trim()
          ? citation.title.trim()
          : url;
      sources.push({
        title: rawTitle.slice(0, 300),
        url,
      });
    }
  }

  return sources.slice(0, 8);
}

export function extractWebSearchQueries(payload) {
  if (!Array.isArray(payload?.output)) return [];

  const seen = new Set();
  const queries = [];
  for (const item of payload.output) {
    if (item?.type !== 'web_search_call') continue;
    const candidates = [
      item?.action?.query,
      ...(Array.isArray(item?.action?.queries) ? item.action.queries : []),
      item?.query,
      ...(Array.isArray(item?.queries) ? item.queries : []),
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const query = candidate.trim().replace(/\s+/gu, ' ');
      if (query.length < 2 || query.length > 1_000) continue;
      const normalized = query.normalize('NFKC').toLocaleLowerCase('en-US');
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      queries.push(query);
    }
  }
  return queries;
}

export function responseMeta(payload) {
  const usage = payload?.usage || {};
  const webSearchQueries = extractWebSearchQueries(payload);
  return {
    providerResponseId: boundedStringOrUndefined(payload?.id, 4, 180),
    inputTokens: nonNegativeIntegerOrUndefined(usage.input_tokens),
    outputTokens: nonNegativeIntegerOrUndefined(usage.output_tokens),
    totalTokens: nonNegativeIntegerOrUndefined(usage.total_tokens),
    webSearchCount: webSearchQueries.length,
    webSearchCallCount: Array.isArray(payload?.output)
      ? payload.output.filter((item) => item?.type === 'web_search_call').length
      : 0,
  };
}

function contentItems(payload) {
  if (!Array.isArray(payload?.output)) return [];
  return payload.output.flatMap((item) => (Array.isArray(item?.content) ? item.content : []));
}

function boundedStringOrUndefined(value, minLength, maxLength) {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength
    ? value
    : undefined;
}

function nonNegativeIntegerOrUndefined(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function safeToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:_-]{1,80}$/.test(value)
    ? value
    : undefined;
}
