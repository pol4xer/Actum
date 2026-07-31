import { createServer } from 'node:http';

const PORT = Number(process.env.ACTUM_AI_PORT || 8787);
const HOST = process.env.ACTUM_AI_HOST || '127.0.0.1';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const planSchema = {
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
      maxItems: 5,
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
              required: ['title', 'description', 'type', 'estimatedMinutes', 'xp'],
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
                estimatedMinutes: { type: 'integer', minimum: 5, maximum: 120 },
                xp: { type: 'integer', minimum: 10, maximum: 60 },
              },
            },
          },
        },
      },
    },
  },
};

const server = createServer(async (request, response) => {
  setCors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true, configured: Boolean(OPENAI_API_KEY), model: MODEL });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/plan') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }
  if (!OPENAI_API_KEY) {
    sendJson(response, 503, { error: 'Добавь OPENAI_API_KEY в файл .env.local и перезапусти AI-сервер.' });
    return;
  }

  try {
    const input = await readJson(request);
    validateInput(input);
    const plan = await requestPlan(input);
    sendJson(response, 200, { plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка AI-сервера.';
    sendJson(response, 500, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  const status = OPENAI_API_KEY ? 'OpenAI key loaded' : 'OPENAI_API_KEY is missing';
  console.log(`Actum AI server: http://${HOST}:${PORT} · ${MODEL} · ${status}`);
});

async function requestPlan(input) {
  const apiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: 'low' },
      store: false,
      safety_identifier: 'actum-local-mvp',
      instructions:
        'Ты продуктовый планировщик Actum. Отвечай по-русски. Преврати одну обычную личную цель в конкретный, реалистичный игровой маршрут: ровно 3 главы по 2–3 миссии, идущие по порядку. Каждая миссия должна помещаться в указанный дневной лимит. Не пиши мотивационную воду. Не обещай медицинский, финансовый или гарантированный жизненный результат. sourceLabels — короткие названия принципов или подходов, на которых построен план; не выдумывай ссылки.',
      input: JSON.stringify({
        goal: input.prompt.trim(),
        startingPoint: input.currentLevel,
        minutesPerMission: input.dailyMinutes,
        horizonDays: input.horizonDays,
      }),
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'actum_goal_plan',
          strict: true,
          schema: planSchema,
        },
      },
    }),
  });

  const payload = await apiResponse.json();
  if (!apiResponse.ok) {
    throw new Error(payload?.error?.message || `OpenAI API error ${apiResponse.status}`);
  }

  const refusal = payload.output
    ?.flatMap((item) => item.content || [])
    .find((content) => content.type === 'refusal');
  if (refusal) throw new Error(refusal.refusal || 'GPT отказался строить этот план.');

  const outputText = payload.output
    ?.flatMap((item) => item.content || [])
    .find((content) => content.type === 'output_text')?.text;
  if (!outputText) throw new Error('GPT не вернул структурированный план.');
  return JSON.parse(outputText);
}

function validateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Некорректный запрос.');
  if (typeof input.prompt !== 'string' || input.prompt.trim().length < 5) {
    throw new Error('Цель слишком короткая.');
  }
  if (![10, 20, 30].includes(input.dailyMinutes)) throw new Error('Некорректный лимит времени.');
  if (![7, 14, 28].includes(input.horizonDays)) throw new Error('Некорректный горизонт.');
  if (!['starting', 'some-experience', 'returning'].includes(input.currentLevel)) {
    throw new Error('Некорректная точка старта.');
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20_000) reject(new Error('Запрос слишком большой.'));
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Некорректный JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
