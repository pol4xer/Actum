import type { RiskGateResult } from '@/domain/types';

const WARNING_PATTERNS = [
  /самоубий|суицид|самоповреж|убить себя/iu,
  /задерж\w* дыхан\w*.*(?:5|10|15)\s*мин/iu,
  /не есть|голода\w*|анорек|булим/iu,
  /лекарств\w*|дозировк\w*|отменить терап/iu,
  /похуд\w*.*(?:10|15|20)\s*кг.*(?:недел|месяц)/iu,
  /взлом|украсть|оружи\w*|наркотик/iu,
];

export function checkGoalRisk(prompt: string): RiskGateResult {
  if (WARNING_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return {
      safe: false,
      title: 'Для цели нужна аккуратная прогрессия',
      message:
        'Actum покажет существенную оговорку отдельно, но сам план всё равно должен состоять из конкретных встроенных таймеров, счётчиков, чек-листов и полей журнала.',
    };
  }

  return {
    safe: true,
    note: 'Цель можно превратить в полностью отслеживаемый маршрут внутри Actum.',
  };
}
