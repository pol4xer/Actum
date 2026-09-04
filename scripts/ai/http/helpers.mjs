import { randomUUID } from 'node:crypto';

import { parseTrustedTarget } from '../contracts/parse-baseline.mjs';
import { programDurationConfig } from '../contracts/program-duration.mjs';

const INPUT_KEYS = new Set([
  'prompt',
  'currentLevel',
  'baseline',
  'duration',
  'dailyMinutes',
  'researchMode',
  'cycleNumber',
  'programContext',
]);

export function validateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Некорректный запрос.');
  if (Object.hasOwn(input, 'targetTimeline') || Object.hasOwn(input, 'horizonDays')) {
    throw new Error('Устаревший формат запроса. Выбери фиксированный срок программы.');
  }
  if (Object.keys(input).some((key) => !INPUT_KEYS.has(key))) {
    throw new Error('Запрос содержит неподдерживаемые поля.');
  }
  if (typeof input.prompt !== 'string' || input.prompt.trim().length < 5) {
    throw new Error('Цель слишком короткая.');
  }
  if (input.prompt.trim().length > 1000) throw new Error('Цель слишком длинная.');
  if (![10, 20, 30, 45, 60].includes(input.dailyMinutes)) {
    throw new Error('Некорректный лимит времени.');
  }
  const durationConfig = programDurationConfig(input.duration);
  if (!durationConfig) throw new Error('Некорректный срок программы.');
  const cycleNumber = input.cycleNumber ?? 1;
  if (
    !Number.isInteger(cycleNumber) ||
    cycleNumber < 1 ||
    cycleNumber > durationConfig.totalCycles
  ) {
    throw new Error('Некорректный номер цикла.');
  }
  if (!['starting', 'some-experience', 'returning'].includes(input.currentLevel)) {
    throw new Error('Некорректная точка старта.');
  }
  if (typeof input.baseline !== 'string' || input.baseline.trim().length < 2) {
    throw new Error('Опиши текущую измеренную точку старта.');
  }
  if (input.baseline.trim().length > 500) {
    throw new Error('Описание точки старта слишком длинное.');
  }
  if (input.researchMode != null && !['quick', 'web'].includes(input.researchMode)) {
    throw new Error('Некорректный режим исследования.');
  }
  if (input.programContext != null) {
    if (
      typeof input.programContext !== 'object' ||
      Array.isArray(input.programContext)
    ) {
      throw new Error('Некорректный контекст программы.');
    }
    if (JSON.stringify(input.programContext).length > 20_000) {
      throw new Error('Контекст программы слишком большой.');
    }
    if (
      !input.programContext.target ||
      !Array.isArray(input.programContext.roadmap) ||
      !Array.isArray(input.programContext.completedCycles)
    ) {
      throw new Error('Контекст программы неполный.');
    }
  }
  validateAssessmentCapacity(input, cycleNumber);
}

function validateAssessmentCapacity(input, cycleNumber) {
  const currentMilestone = input.programContext?.roadmap?.[cycleNumber - 1];
  const maximum = input.dailyMinutes * 60;
  const programTarget = input.programContext?.target ?? parseTrustedTarget(input.prompt);
  const candidates = [
    currentMilestone && isSecondsUnit(currentMilestone.targetUnit)
      ? { value: currentMilestone.targetValue, unit: 'seconds' }
      : null,
    isSecondsUnit(programTarget?.unit) ? programTarget : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const value = candidate.value;
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('Контрольная длительность должна быть целым числом секунд не меньше 1.');
    }
    if (value > maximum) {
      throw new Error(
        `Контрольный замер ${value} сек. не помещается в дневной лимит ${maximum} сек. Увеличь лимит времени.`,
      );
    }
  }
}

function isSecondsUnit(value) {
  if (typeof value !== 'string') return false;
  return /^(?:seconds?|secs?|sec|s|сек|секунд(?:а|ы|у|е|ой|ами|ах)?)$/iu.test(
    value.trim(),
  );
}

export function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > 20_000) {
        settled = true;
        reject(new Error('Запрос слишком большой.'));
      }
    });
    request.on('end', () => {
      if (settled) return;
      try {
        settled = true;
        resolve(JSON.parse(body));
      } catch {
        settled = true;
        reject(new Error('Некорректный JSON.'));
      }
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Actum-Request-Id, X-Actum-Reuse-Only',
  );
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

export function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function requestIdFromRequest(request) {
  const rawHeader = request.headers?.['x-actum-request-id'];
  const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof candidate === 'string' && /^actum_[A-Za-z0-9_-]{8,80}$/.test(candidate)) {
    return candidate;
  }
  return `actum_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
