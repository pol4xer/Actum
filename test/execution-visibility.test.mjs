import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./typescript-extension-loader.mjs', import.meta.url));

const {
  actionableExecutionBlocks,
  isSafetyOnlyExecutionBlock,
  presentExecutionSection,
  withoutExecutionSafetyCopy,
} = await import('@/shared/presentation/execution-visibility');

test('legacy safety gates are removed without hiding real instructions', () => {
  const safety = {
    kind: 'checklist',
    title: 'Проверка безопасности',
    items: [
      'Практика проходит только на суше.',
      'До начала нет головокружения или тошноты.',
    ],
    estimatedSeconds: 30,
    successCriterion: 'Оба условия отмечены.',
  };
  const timer = {
    kind: 'timer',
    title: 'Рабочий подход',
    instruction: 'Удерживай положение.',
    sets: 3,
    durationSecondsPerSet: 30,
    restSeconds: 60,
    successCriterion: 'Три подхода завершены.',
  };
  const usefulChecklist = {
    kind: 'checklist',
    title: 'Собрать рабочее место',
    items: ['Убрать бумаги', 'Разложить документы по двум стопкам'],
    estimatedSeconds: 120,
    successCriterion: 'Оба действия выполнены.',
  };

  assert.equal(isSafetyOnlyExecutionBlock(safety), true);
  assert.equal(isSafetyOnlyExecutionBlock(timer), false);
  assert.equal(isSafetyOnlyExecutionBlock(usefulChecklist), false);
  assert.deepEqual(
    actionableExecutionBlocks([safety, timer, usefulChecklist]),
    [timer, usefulChecklist],
  );
});

test('preflight wording is hidden only when it contains safety copy', () => {
  assert.equal(
    isSafetyOnlyExecutionBlock({
      kind: 'checklist',
      title: 'Проверка готовности',
      items: ['До начала нет боли или головокружения.'],
      estimatedSeconds: 15,
      successCriterion: 'Пункт отмечен.',
    }),
    true,
  );
  assert.equal(
    isSafetyOnlyExecutionBlock({
      kind: 'checklist',
      title: 'Проверка готовности документов',
      items: ['Паспорт лежит в папке.'],
      estimatedSeconds: 15,
      successCriterion: 'Пункт отмечен.',
    }),
    false,
  );
});

test('legacy safety chapter titles become neutral without exposing their context', () => {
  assert.deepEqual(presentExecutionSection('Безопасный старт'), {
    title: 'старт',
    showContext: false,
  });
  assert.deepEqual(presentExecutionSection('Консолидация'), {
    title: 'Консолидация',
    showContext: true,
  });
});

test('legacy warnings are removed from action copy without losing the action', () => {
  assert.equal(
    withoutExecutionSafetyCopy(
      'После обычного вдоха задержи дыхание. После сигнала дыши обычно. При головокружении прекрати блок.',
    ),
    'После обычного вдоха задержи дыхание. После сигнала дыши обычно.',
  );
  assert.equal(
    withoutExecutionSafetyCopy(
      'Все подходы завершены с обычным дыханием в паузах и без тревожных симптомов.',
    ),
    'Все подходы завершены с обычным дыханием в паузах.',
  );
  assert.equal(
    withoutExecutionSafetyCopy('Практика проходит в безопасном месте.'),
    undefined,
  );
});
