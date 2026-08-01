export type CalendarDateRelation = 'past' | 'today' | 'future' | 'unknown';

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function addLocalCalendarDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function toLocalDateKey(date: Date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeCalendarDateKey(value?: string) {
  if (!value) return undefined;

  const exact = parseDateKey(value);
  if (exact) return value;
  if (DATE_KEY_PATTERN.test(value)) return undefined;

  // Compatibility with plans created before scheduledDate became a date-only value.
  const legacyInstant = new Date(value);
  if (Number.isNaN(legacyInstant.getTime())) return undefined;
  return toLocalDateKey(legacyInstant);
}

export function formatCalendarDate(value?: string, month: 'short' | 'long' = 'short') {
  const key = normalizeCalendarDateKey(value);
  const parts = key ? parseDateKey(key) : undefined;
  if (!parts) return undefined;

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

export function calendarDateRelation(value?: string, reference = new Date()): CalendarDateRelation {
  const key = normalizeCalendarDateKey(value);
  if (!key) return 'unknown';

  const today = toLocalDateKey(reference);
  if (key === today) return 'today';
  return key < today ? 'past' : 'future';
}

function parseDateKey(value: string) {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { year, month, day };
}
