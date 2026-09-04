import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./typescript-extension-loader.mjs', import.meta.url));

const { presentMissionDay } = await import('@/shared/presentation/mission-actions');

test('day presentation hides safety-only gates and keeps executable dosage', () => {
  const mission = {
    id: 'day-1',
    chapterId: 'chapter-1',
    sequence: 1,
    dayNumber: 1,
    title: 'Тренировка',
    description: 'Описание дня',
    type: 'practice',
    estimatedMinutes: 10,
    xp: 10,
    outcome: 'pending',
    execution: {
      kind: 'in_app',
      successCriterion:
        'Все рабочие блоки выполнены, без гипервентиляции и тревожных симптомов.',
      blocks: [
        {
          kind: 'checklist',
          title: 'Проверка безопасности',
          items: ['Нет головокружения.', 'Практика только на суше.'],
          estimatedSeconds: 60,
          successCriterion: 'Все условия отмечены.',
        },
        {
          kind: 'timer',
          title: 'Рабочий подход',
          instruction:
            'Задержи дыхание. После сигнала дыши обычно. При головокружении прекрати блок.',
          sets: 3,
          durationSecondsPerSet: 30,
          restSeconds: 90,
          successCriterion: 'Три подхода завершены и без тревожных симптомов.',
        },
      ],
    },
  };

  assert.deepEqual(presentMissionDay(mission), {
    actions: [
      {
        id: 'timer-0',
        title: 'Рабочий подход',
        dose: '3 × 30 сек · отдых 90 сек',
        instruction: 'Задержи дыхание. После сигнала дыши обычно.',
        criterion: 'Три подхода завершены.',
      },
    ],
    dayCriterion: 'Все рабочие блоки выполнены.',
  });
});

test('day presentation keeps persisted routine plans readable', () => {
  const mission = {
    id: 'legacy-day',
    chapterId: 'chapter-1',
    sequence: 2,
    title: 'Планка',
    description: 'Сделай комплекс.',
    type: 'practice',
    estimatedMinutes: 10,
    xp: 10,
    outcome: 'pending',
    completionCriterion: 'Все подходы завершены.',
    execution: {
      kind: 'routine',
      actions: [
        {
          title: 'Планка',
          instruction: 'Держи корпус ровно.',
          sets: 3,
          quantity: 30,
          workSecondsPerSet: 30,
          unit: 'seconds',
          restSeconds: 60,
          successCriterion: 'Выполнены три подхода.',
        },
      ],
    },
  };

  assert.deepEqual(presentMissionDay(mission).actions, [
    {
      id: 'routine-0',
      title: 'Планка',
      dose: '3 × 30 сек · отдых 1 мин',
      instruction: 'Держи корпус ровно.',
      criterion: 'Выполнены три подхода.',
    },
  ]);
});
