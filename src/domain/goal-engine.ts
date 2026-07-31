import {
  GeneratedGoal,
  GoalDomain,
  GoalInput,
  Mission,
  MissionType,
  QuestChapter,
  RiskGateResult,
} from '@/domain/types';

const BLOCKED_PATTERNS = [
  /самоубий|суицид|самоповреж|убить себя/i,
  /задерж\w* дыхан\w*.*(?:5|10|15)\s*мин/i,
  /не есть|голода\w*|анорек|булим/i,
  /лекарств\w*|дозировк\w*|отменить терап/i,
  /похуд\w*.*(?:10|15|20)\s*кг.*(?:недел|месяц)/i,
  /взлом|украсть|оружи\w*|наркотик/i,
];

const DOMAIN_PATTERNS: Array<[GoalDomain, RegExp]> = [
  ['read', /книг|читать|прочесть|чтени/i],
  ['learn', /учить|изучить|язык|курс|экзамен|теори/i],
  ['practice', /готовить|рисовать|играть|научиться|навык|практик/i],
  ['organize', /разобрать|порядок|организ|документ|планир|уборк/i],
  ['move', /ходить|бег|планк|тренир|двиг|зарядк|фитнес/i],
  ['habit', /привычк|каждый день|регулярно|режим/i],
];

type MissionSeed = {
  title: string;
  description: string;
  type: MissionType;
  minutesFactor?: number;
};

const TEMPLATES: Record<GoalDomain, { metric: string; summary: string; missions: MissionSeed[] }> = {
  read: {
    metric: '7 спокойных сессий чтения',
    summary: 'Создадим устойчивый ритм чтения без марафонов и чувства вины.',
    missions: missionSeeds(
      ['Подготовить место', 'Выбери книгу, убери отвлекающее и отметь удобное время.', 'prepare'],
      ['Первая тихая сессия', 'Читай в комфортном темпе. Остановись, пока ещё хочется продолжать.', 'read'],
      ['Вернуться к тексту', 'Продолжи с последней заметки и выдели одну мысль.', 'read'],
      ['Закрепить контекст', 'Прочитай и запиши одним предложением, что осталось в памяти.', 'reflect'],
      ['Сессия без счётчика', 'Сегодня важна только встреча с книгой, не число страниц.', 'read'],
      ['Собрать нить', 'Просмотри закладки и продолжи чтение.', 'read'],
      ['Проверка ритма', 'Коротко оцени: какое время и место сработали лучше всего?', 'check'],
    ),
  },
  learn: {
    metric: '7 учебных подходов с проверкой понимания',
    summary: 'Разобьём тему на короткие циклы: понять, вспомнить, применить.',
    missions: missionSeeds(
      ['Карта неизвестного', 'Запиши, что уже знаешь и какие три вопроса хочешь закрыть.', 'prepare'],
      ['Один ключевой блок', 'Изучи только первый базовый концепт, затем закрой источник.', 'learn'],
      ['Вспомнить без подсказки', 'Объясни вчерашнюю идею своими словами.', 'reflect'],
      ['Мини-применение', 'Сделай один маленький пример или упражнение.', 'practice'],
      ['Найти слабое место', 'Отметь один вопрос, где объяснение пока распадается.', 'check'],
      ['Второй учебный блок', 'Разбери следующий концепт и свяжи его с первым.', 'learn'],
      ['Недельная проверка', 'Ответь на исходные вопросы без просмотра материалов.', 'submit'],
    ),
  },
  practice: {
    metric: '7 осознанных практических повторений',
    summary: 'Навык растёт через небольшие повторения и быструю обратную связь.',
    missions: missionSeeds(
      ['Подготовить инструменты', 'Сделай старт следующей практики максимально простым.', 'prepare'],
      ['Базовое повторение', 'Выполни самый простой элемент навыка медленно и внимательно.', 'practice'],
      ['Повтор с фокусом', 'Повтори, следя только за одной выбранной деталью.', 'practice'],
      ['Разбор ошибки', 'Найди одну неточность и преврати её в подсказку.', 'reflect'],
      ['Короткая серия', 'Сделай три спокойных повтора без требования идеала.', 'practice'],
      ['Небольшая вариация', 'Измени одно условие, сохранив базовую технику.', 'practice'],
      ['Контрольная попытка', 'Сделай один цельный проход и отметь следующий микро-шаг.', 'submit'],
    ),
  },
  organize: {
    metric: '7 завершённых зон или решений',
    summary: 'Уменьшим перегрузку: одна зона, одно решение, один видимый результат.',
    missions: missionSeeds(
      ['Выбрать границу', 'Определи одну небольшую зону, которую реально закончить сегодня.', 'prepare'],
      ['Убрать очевидное', 'Удаляй только мусор и явные дубликаты — без сложных решений.', 'organize'],
      ['Собрать похожее', 'Сгруппируй предметы или файлы по назначению.', 'organize'],
      ['Решить пять вещей', 'Для пяти элементов выбери: оставить, переместить или убрать.', 'organize'],
      ['Дать месту имя', 'Назначь понятное постоянное место одной категории.', 'organize'],
      ['Закрыть хвост', 'Заверши один оставшийся маленький участок.', 'organize'],
      ['Зафиксировать правило', 'Запиши одно простое правило, которое сохранит порядок.', 'check'],
    ),
  },
  move: {
    metric: '7 безопасных сессий движения',
    summary: 'Начнём с умеренной нагрузки и самонаблюдения, без медицинских обещаний.',
    missions: missionSeeds(
      ['Проверка готовности', 'Выбери безопасный формат и остановись при боли или недомогании.', 'check'],
      ['Лёгкий старт', 'Двигайся в разговорном темпе, оставляя запас сил.', 'move'],
      ['Повтор без рекорда', 'Повтори лёгкую сессию, не увеличивая всё сразу.', 'move'],
      ['День восстановления', 'Сделай мягкую разминку или спокойную прогулку.', 'recover'],
      ['Добавить немного', 'Увеличь только один параметр и не более чем слегка.', 'move'],
      ['Стабильная сессия', 'Повтори удачный объём и оцени самочувствие после.', 'move'],
      ['Проверить неделю', 'Отметь энергию, комфорт и подходящий уровень нагрузки.', 'reflect'],
    ),
  },
  habit: {
    metric: '7 честных контактов с новой привычкой',
    summary: 'Привяжем минимальное действие к стабильному контексту.',
    missions: missionSeeds(
      ['Найти якорь', 'Выбери уже существующее событие, после которого начнётся действие.', 'prepare'],
      ['Сделать минимум', 'Выполни настолько маленькую версию, что трудно отказаться.', 'practice'],
      ['Повторить в контексте', 'Начни после того же якоря и остановись после минимума.', 'practice'],
      ['Убрать трение', 'Подготовь среду для следующего повтора заранее.', 'prepare'],
      ['Честный повтор', 'Сделай минимум; больше — только если есть ресурс.', 'practice'],
      ['Проверить устойчивость', 'Оцени, помогает ли выбранный якорь начинать.', 'check'],
      ['Закрепить правило', 'Сформулируй гибкое правило продолжения на следующую неделю.', 'reflect'],
    ),
  },
};

function missionSeeds(...tuples: Array<[string, string, MissionType]>): MissionSeed[] {
  return tuples.map(([title, description, type]) => ({ title, description, type }));
}

function classifyGoal(prompt: string): GoalDomain {
  return DOMAIN_PATTERNS.find(([, pattern]) => pattern.test(prompt))?.[0] ?? 'habit';
}

export function checkGoalRisk(prompt: string): RiskGateResult {
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return {
      safe: false,
      title: 'Для цели нужна аккуратная прогрессия',
      message:
        'Actum не блокирует генерацию: короткая оговорка останется отдельно, а основной план должен содержать конкретные действия, объём и прогрессию.',
    };
  }

  return {
    safe: true,
    note: 'Цель относится к разрешённым доменам низкого или среднего риска.',
  };
}

export function buildGoal(input: GoalInput): GeneratedGoal {
  const domain = classifyGoal(input.prompt);
  const template = TEMPLATES[domain];
  const now = new Date();
  const stamp = now.getTime().toString(36);
  const targetDate = new Date(now.getTime() + input.horizonDays * 86_400_000);
  const chapterIds = [`chapter-${stamp}-1`, `chapter-${stamp}-2`, `chapter-${stamp}-3`];
  const chapters: QuestChapter[] = [
    { id: chapterIds[0], title: 'Глава I · Вход', subtitle: 'Снизить трение и начать', order: 1 },
    { id: chapterIds[1], title: 'Глава II · Ритм', subtitle: 'Повторить и заметить', order: 2 },
    { id: chapterIds[2], title: 'Глава III · Закрепление', subtitle: 'Проверить и продолжить', order: 3 },
  ];

  const missions: Mission[] = template.missions.map((seed, index) => ({
    id: `mission-${stamp}-${index + 1}`,
    chapterId: chapterIds[index < 2 ? 0 : index < 5 ? 1 : 2],
    sequence: index + 1,
    title: seed.title,
    description: seed.description,
    type: seed.type,
    estimatedMinutes: Math.max(5, Math.round(input.dailyMinutes * (seed.minutesFactor ?? 1))),
    xp: 18 + index * 2,
    outcome: 'pending',
    steps: [seed.description],
    execution: { kind: 'manual' },
  }));

  const title = input.prompt.trim().replace(/[.!?]+$/, '');

  return {
    goal: {
      id: `goal-${stamp}`,
      rawPrompt: input.prompt.trim(),
      title: title.charAt(0).toUpperCase() + title.slice(1),
      domain,
      targetDate: targetDate.toISOString(),
      targetMetric: template.metric,
      status: 'active',
      createdAt: now.toISOString(),
    },
    plan: {
      id: `plan-${stamp}-v1`,
      version: 1,
      createdAt: now.toISOString(),
      dailyMinutes: input.dailyMinutes,
      horizonDays: input.horizonDays,
      summary: template.summary,
      chapters,
      missions,
      research: {
        method: 'local-curated-v1',
        confidence: domain === 'move' ? 'medium' : 'high',
        safetyNotes: [
          'План не заменяет медицинскую, психологическую или профессиональную помощь.',
          domain === 'move'
            ? 'Нагрузка намеренно умеренная: остановись при боли, головокружении или ухудшении самочувствия.'
            : 'План использует небольшие действия и допускает перестройку после честного check-in.',
        ],
        assumptions: [
          `Доступно около ${input.dailyMinutes} минут в день.`,
          `Стартовый режим: ${
            input.currentLevel === 'starting'
              ? 'начинаю с нуля'
              : input.currentLevel === 'returning'
                ? 'возвращаюсь после паузы'
                : 'есть небольшой опыт'
          }.`,
        ],
        sourceLabels: [
          'Контролируемая библиотека low-risk шаблонов Actum',
          'Микро-шаги и гибкие implementation intentions',
          'Правила безопасного fallback для MVP',
        ],
      },
    },
  };
}
