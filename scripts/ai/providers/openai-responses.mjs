const RESPONSES_URL = 'https://api.openai.com/v1/responses';

export class OpenAIRequestError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'OpenAIRequestError';
    this.status = status;
    this.code = code;
  }
}

export async function createOpenAIResponse({ apiKey, body }) {
  const response = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new OpenAIRequestError(
      payload?.error?.message || `OpenAI API error ${response.status}`,
      { status: response.status, code: payload?.error?.code },
    );
  }

  const refusal = contentItems(payload).find((content) => content.type === 'refusal');
  if (refusal) {
    throw new OpenAIRequestError(refusal.refusal || 'OpenAI отказался обработать эту цель.', {
      status: 422,
      code: 'refusal',
    });
  }

  return payload;
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
      if (typeof citation.url !== 'string' || !/^https?:\/\//i.test(citation.url)) continue;
      if (seen.has(citation.url)) continue;
      seen.add(citation.url);
      sources.push({
        title:
          typeof citation.title === 'string' && citation.title.trim()
            ? citation.title.trim()
            : citation.url,
        url: citation.url,
      });
    }
  }

  return sources.slice(0, 8);
}

export function responseMeta(payload) {
  const usage = payload?.usage || {};
  return {
    providerResponseId: typeof payload?.id === 'string' ? payload.id : undefined,
    inputTokens: numberOrUndefined(usage.input_tokens),
    outputTokens: numberOrUndefined(usage.output_tokens),
    totalTokens: numberOrUndefined(usage.total_tokens),
    webSearchCount: Array.isArray(payload?.output)
      ? payload.output.filter((item) => item?.type === 'web_search_call').length
      : 0,
  };
}

function contentItems(payload) {
  if (!Array.isArray(payload?.output)) return [];
  return payload.output.flatMap((item) => (Array.isArray(item?.content) ? item.content : []));
}

function numberOrUndefined(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
