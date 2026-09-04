export const PROGRAM_DURATIONS = Object.freeze({
  month: Object.freeze({ totalCycles: 1, totalDays: 30 }),
  'half-year': Object.freeze({ totalCycles: 6, totalDays: 180 }),
  year: Object.freeze({ totalCycles: 12, totalDays: 365 }),
});

export const CYCLE_DAYS = 30;

export function programDurationConfig(duration) {
  return PROGRAM_DURATIONS[duration];
}
