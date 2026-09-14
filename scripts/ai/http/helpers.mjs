import { randomUUID } from 'node:crypto';

import {
  parseTrustedBaseline,
  parseTrustedTarget,
} from '../contracts/parse-baseline.mjs';
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
  if (!input || typeof input !== 'object') throw new Error('Invalid request.');
  if (Object.hasOwn(input, 'targetTimeline') || Object.hasOwn(input, 'horizonDays')) {
    throw new Error('Outdated request format. Choose a program continuation limit.');
  }
  if (Object.keys(input).some((key) => !INPUT_KEYS.has(key))) {
    throw new Error('The request contains unsupported fields.');
  }
  if (typeof input.prompt !== 'string' || input.prompt.trim().length < 5) {
    throw new Error('The goal is too short.');
  }
  if (input.prompt.trim().length > 1000) throw new Error('The goal is too long.');
  if (![10, 20, 30, 45, 60].includes(input.dailyMinutes)) {
    throw new Error('Invalid time budget.');
  }
  const durationConfig = programDurationConfig(input.duration);
  if (!durationConfig) throw new Error('Invalid program continuation limit.');
  const cycleNumber = input.cycleNumber ?? 1;
  if (
    !Number.isInteger(cycleNumber) ||
    cycleNumber < 1 ||
    cycleNumber > durationConfig.totalCycles
  ) {
    throw new Error('Invalid cycle number.');
  }
  if (!['starting', 'some-experience', 'returning'].includes(input.currentLevel)) {
    throw new Error('Invalid starting point.');
  }
  if (typeof input.baseline !== 'string' || input.baseline.trim().length < 2) {
    throw new Error('Describe your current measured baseline.');
  }
  if (input.baseline.trim().length > 500) {
    throw new Error('The baseline description is too long.');
  }
  if (input.researchMode != null && !['quick', 'web'].includes(input.researchMode)) {
    throw new Error('Invalid research mode.');
  }
  if (input.programContext != null) {
    if (
      typeof input.programContext !== 'object' ||
      Array.isArray(input.programContext)
    ) {
      throw new Error('Invalid program context.');
    }
    if (JSON.stringify(input.programContext).length > 20_000) {
      throw new Error('The program context is too large.');
    }
    if (
      !input.programContext.target ||
      !Array.isArray(input.programContext.roadmap) ||
      !Array.isArray(input.programContext.completedCycles)
    ) {
      throw new Error('The program context is incomplete.');
    }
    if (
      input.programContext.researchAnchor != null &&
      (typeof input.programContext.researchAnchor !== 'string' ||
        !/^[a-f0-9]{64}$/.test(input.programContext.researchAnchor))
    ) {
      throw new Error('Invalid program research anchor.');
    }
    if (
      input.programContext.targetCycleNumber != null &&
      (!Number.isInteger(input.programContext.targetCycleNumber) ||
        input.programContext.targetCycleNumber < 1 ||
        input.programContext.targetCycleNumber > durationConfig.totalCycles)
    ) {
      throw new Error('Invalid target cycle in the program context.');
    }
  }
  if (
    cycleNumber > 1 &&
    input.researchMode !== 'quick' &&
    !/^[a-f0-9]{64}$/.test(input.programContext?.researchAnchor ?? '')
  ) {
    throw new Error(
      'The next cycle is blocked without its original research anchor: no new web search was started.',
    );
  }
  validateAssessmentCapacity(input, cycleNumber);
  validateSupportedMetricDirection(input);
}

/**
 * The current runner records timer/counter success as "at least the prescribed value".
 * Reject a locally recognizable decreasing metric before any paid provider request rather
 * than returning a plan the client cannot honestly complete.
 */
function validateSupportedMetricDirection(input) {
  const baseline = parseTrustedBaseline(input.baseline);
  const target = input.programContext?.target ?? parseTrustedTarget(input.prompt);
  const unitsMatch =
    typeof baseline?.unit === 'string' &&
    typeof target?.unit === 'string' &&
    baseline.unit.trim().toLocaleLowerCase('ru-RU') ===
      target.unit.trim().toLocaleLowerCase('ru-RU');
  const roadmapShowsDecrease =
    Array.isArray(input.programContext?.roadmap) &&
    input.programContext.roadmap.some(
      (milestone) =>
        Number.isFinite(target?.value) &&
        Number.isFinite(milestone?.targetValue) &&
        typeof milestone?.targetUnit === 'string' &&
        typeof target?.unit === 'string' &&
        milestone.targetUnit.trim().toLocaleLowerCase('ru-RU') ===
          target.unit.trim().toLocaleLowerCase('ru-RU') &&
        milestone.targetValue > target.value,
    );

  if (
    (unitsMatch && Number.isFinite(baseline.value) && Number.isFinite(target.value) &&
      target.value < baseline.value) ||
    roadmapShowsDecrease
  ) {
    throw new Error(
      'Decreasing numeric goals are not yet supported by the built-in runner. Describe a measurable action whose value should increase.',
    );
  }
}

function validateAssessmentCapacity(input, cycleNumber) {
  const currentMilestone = input.programContext?.roadmap?.[cycleNumber - 1];
  const maximum = input.dailyMinutes * 60;
  const programTarget = input.programContext?.target ?? parseTrustedTarget(input.prompt);
  if (
    Number.isFinite(programTarget?.value) &&
    programTarget.value === 0 &&
    typeof programTarget.unit === 'string' &&
    !isSecondsUnit(programTarget.unit)
  ) {
    throw new Error(
      'A counter goal of 0 does not create an executable action. Enter a positive target value.',
    );
  }
  const candidates = [
    currentMilestone && isSecondsUnit(currentMilestone.targetUnit)
      ? { value: currentMilestone.targetValue, unit: 'seconds' }
      : null,
    isSecondsUnit(programTarget?.unit) ? programTarget : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const value = candidate.value;
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('The assessment duration must be an integer of at least 1 second.');
    }
    if (value > maximum) {
      throw new Error(
        `The ${value}-second assessment does not fit the ${maximum}-second daily budget. Increase the time budget.`,
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
        reject(new Error('The request is too large.'));
      }
    });
    request.on('end', () => {
      if (settled) return;
      try {
        settled = true;
        resolve(JSON.parse(body));
      } catch {
        settled = true;
        reject(new Error('Invalid JSON.'));
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
