export const BASELINE_PARSER_VERSION = 'numeric-metric-v2';

const MAXIMUM_PREFIX =
  /(?:рекорд|максимум|максимальн|лучший|personal\s+best|record|maximum|max\b|(?:^|\W)m\s*=?)/iu;
const DURATION_CONTEXT =
  /(?:рекорд|максимум|максимальн|лучший|задерж|удерж|планк|длительност|таймер|время|сейчас\s+могу|personal\s+best|record|maximum|max\b|hold|plank|duration|timer|time)/iu;
const EXPLICIT_HOLD_VERB_CONTEXT =
  /(?:^|[^\p{L}])держ(?:у|ишь|ит|им|ите|ат|ать|ал(?:а|и)?)(?=$|[^\p{L}])/iu;
const NON_DURATION_COLON_CONTEXT =
  /(?:сч[её]т|матч|игр|соотношен|масштаб|score|match|game|ratio|scale)/iu;

export function parseTrustedBaseline(statement) {
  return parseTrustedMetric(statement, { preferMaximum: true });
}

export function parseTrustedTarget(statement) {
  return parseTrustedMetric(statement, { preferMaximum: false });
}

function parseTrustedMetric(statement, { preferMaximum }) {
  if (typeof statement !== 'string') return null;
  const text = statement.trim();
  if (!text) return null;

  const candidates = [];
  const addCandidate = (match, value, unit) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (!Number.isFinite(value) || value < 0) return;
    if (/^(?:\s*\/|\s+per\b|\s+в\s+(?:сек|мин|час))/iu.test(text.slice(end))) return;
    if (candidates.some((candidate) => start < candidate.end && end > candidate.start)) return;

    const prefixWindow = text.slice(Math.max(0, start - 56), start);
    const delimiterIndex = Math.max(
      prefixWindow.lastIndexOf(','),
      prefixWindow.lastIndexOf(';'),
      prefixWindow.lastIndexOf('.'),
      prefixWindow.lastIndexOf('!'),
      prefixWindow.lastIndexOf('?'),
      prefixWindow.lastIndexOf('\n'),
    );
    const prefix = prefixWindow.slice(delimiterIndex + 1);
    candidates.push({
      value,
      unit,
      start,
      end,
      score: preferMaximum && MAXIMUM_PREFIX.test(prefix) ? 100 : 0,
    });
  };

  for (const match of text.matchAll(/(\d{1,4})\s*:\s*(\d{1,2})/gu)) {
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const clause = clauseAround(text, start, end);
    if (
      seconds < 60 &&
      (DURATION_CONTEXT.test(clause) || EXPLICIT_HOLD_VERB_CONTEXT.test(clause)) &&
      !NON_DURATION_COLON_CONTEXT.test(clause)
    ) {
      addCandidate(match, minutes * 60 + seconds, 'seconds');
    }
  }

  const minutesAndSeconds =
    /(\d+(?:[.,]\d+)?)\s*(?:мин(?:ут(?:а|ы|у)?)?\.?|minutes?|mins?)(?![\p{L}])(?:\s*(?:и\s*)?(\d+(?:[.,]\d+)?)\s*(?:сек(?:унд(?:а|ы|у)?)?\.?|seconds?|secs?)(?![\p{L}]))?/giu;
  for (const match of text.matchAll(minutesAndSeconds)) {
    const minutes = decimal(match[1]);
    const seconds = match[2] == null ? 0 : decimal(match[2]);
    if (seconds < 60) addCandidate(match, minutes * 60 + seconds, 'seconds');
  }

  collectUnit(text, /(\d+(?:[.,]\d+)?)\s*(?:сек(?:унд(?:а|ы|у)?)?\.?|seconds?|secs?)(?![\p{L}])/giu, 'seconds', 1, addCandidate);
  collectUnit(text, /(\d+(?:[.,]\d+)?)\s*(?:повтор(?:а|ов|ения|ений)?|reps?|repetitions?)(?![\p{L}])/giu, 'reps', 1, addCandidate);
  collectUnit(text, /(\d+(?:[.,]\d+)?)\s*(?:стр(?:аниц(?:а|ы|у)?)?\.?|pages?)(?![\p{L}])/giu, 'pages', 1, addCandidate);
  collectUnit(text, /(\d+(?:[.,]\d+)?)\s*(?:элемент(?:а|ов)?|items?)(?![\p{L}])/giu, 'items', 1, addCandidate);
  collectUnit(text, /(\d+(?:[.,]\d+)?)\s*(?:слов(?:о|а)?|words?)(?![\p{L}])/giu, 'words', 1, addCandidate);
  collectUnit(text, /(\d+(?:[.,]\d+)?)\s*(?:попыт(?:ка|ки|ку|ок)|attempts?)(?![\p{L}])/giu, 'attempts', 1, addCandidate);
  collectUnit(text, /(\d+(?:[.,]\d+)?)\s*(?:км|kilometers?|kilometres?)(?![\p{L}])/giu, 'meters', 1000, addCandidate);
  collectUnit(text, /(\d+(?:[.,]\d+)?)\s*(?:м(?:етр(?:а|ов)?)?|meters?|metres?)(?![\p{L}])/giu, 'meters', 1, addCandidate);

  candidates.sort((left, right) => right.score - left.score || left.start - right.start);
  const bestScore = candidates[0]?.score;
  const bestCandidates = candidates.filter((candidate) => candidate.score === bestScore);
  const distinctBest = new Set(
    bestCandidates.map((candidate) => `${candidate.unit}:${candidate.value}`),
  );
  if (distinctBest.size > 1) return null;
  const selected = bestCandidates[0];
  return selected ? { value: selected.value, unit: selected.unit } : null;
}

function collectUnit(text, pattern, unit, multiplier, addCandidate) {
  for (const match of text.matchAll(pattern)) {
    addCandidate(match, decimal(match[1]) * multiplier, unit);
  }
}

function clauseAround(text, start, end) {
  const left = text.slice(0, start);
  const right = text.slice(end);
  const clauseStart = Math.max(
    left.lastIndexOf(','),
    left.lastIndexOf(';'),
    left.lastIndexOf('.'),
    left.lastIndexOf('!'),
    left.lastIndexOf('?'),
    left.lastIndexOf('\n'),
  ) + 1;
  const rightDelimiters = [',', ';', '.', '!', '?', '\n']
    .map((delimiter) => right.indexOf(delimiter))
    .filter((index) => index >= 0);
  const clauseEnd = rightDelimiters.length ? end + Math.min(...rightDelimiters) : text.length;
  return text.slice(clauseStart, clauseEnd);
}

function decimal(value) {
  return Number(String(value).replace(',', '.'));
}
