import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./typescript-extension-loader.mjs', import.meta.url));

const {
  actionableExecutionBlocks,
  containsExecutionSafetyCopy,
  isSafetyOnlyExecutionBlock,
  presentExecutionSection,
  withoutExecutionSafetyCopy,
} = await import('@/shared/presentation/execution-visibility');

test('English symptom matching preserves painting checklists and ordinary action words', () => {
  const artChecklist = {
    kind: 'checklist',
    title: 'Readiness',
    items: ['Choose a painting topic', 'Sketch a painting idea'],
    estimatedSeconds: 120,
    successCriterion: 'A topic and a sketch are ready.',
  };

  assert.equal(isSafetyOnlyExecutionBlock(artChecklist), false);
  assert.deepEqual(actionableExecutionBlocks([artChecklist]), [artChecklist]);
  for (const copy of [
    ...artChecklist.items,
    'Repaint the cabinet.',
    'Seize the opportunity to practice.',
    'Practice seizing an opportunity.',
  ]) {
    assert.equal(containsExecutionSafetyCopy(copy), false, copy);
    assert.equal(withoutExecutionSafetyCopy(copy), copy);
  }
});

test('English symptom matching still identifies real safety-only checklist items', () => {
  const safetyChecklist = {
    kind: 'checklist',
    title: 'Readiness',
    items: [
      'No pain.',
      'No painful movement.',
      'No dizziness.',
      'No nausea.',
      'Do not start while dizzy.',
      'Do not start while nauseous.',
      'Do not start while nauseated.',
      'No seizures.',
      'No other symptoms.',
      'Do not start while symptomatic.',
      'Avoid hyperventilation.',
      'Do not hyperventilate.',
    ],
    estimatedSeconds: 30,
    successCriterion: 'All conditions checked.',
  };
  for (const copy of safetyChecklist.items) {
    assert.equal(containsExecutionSafetyCopy(copy), true, copy);
  }
  assert.equal(isSafetyOnlyExecutionBlock(safetyChecklist), true);
  assert.deepEqual(actionableExecutionBlocks([safetyChecklist]), []);
});

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

test('safety-themed universal work is never treated as a disposable warning gate', () => {
  const accountSecurity = {
    kind: 'checklist',
    title: 'Проверка безопасности аккаунта',
    items: ['Включи двухфакторную аутентификацию', 'Сохрани резервные коды'],
    estimatedSeconds: 120,
    successCriterion: 'Оба действия выполнены.',
  };
  const safeTechnique = {
    kind: 'checklist',
    title: 'Безопасная техника планки',
    items: ['Поставь локти под плечами', 'Сохрани прямую линию корпуса'],
    estimatedSeconds: 60,
    successCriterion: 'Оба действия выполнены.',
  };

  assert.equal(isSafetyOnlyExecutionBlock(accountSecurity), false);
  assert.equal(isSafetyOnlyExecutionBlock(safeTechnique), false);
  assert.deepEqual(actionableExecutionBlocks([accountSecurity, safeTechnique]), [
    accountSecurity,
    safeTechnique,
  ]);
  assert.equal(
    withoutExecutionSafetyCopy('Создай безопасный пароль. Изучи медицинскую терминологию.'),
    'Создай безопасный пароль. Изучи медицинскую терминологию.',
  );
});

test('legacy safety-only chapters become neutral without hiding universal safety work', () => {
  assert.deepEqual(presentExecutionSection('Safety', 'Stop if you feel dizzy.'), {
    title: 'Start',
    showContext: false,
  });
  assert.deepEqual(presentExecutionSection('Безопасный старт', 'Проверь самочувствие до начала.'), {
    title: 'старт',
    showContext: false,
  });
  assert.deepEqual(presentExecutionSection('Безопасность аккаунта', 'Включи двухфакторную защиту.'), {
    title: 'Безопасность аккаунта',
    showContext: true,
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
