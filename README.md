# Actum

Actum — открываемый в VS Code iPhone-first MVP универсального life-RPG приложения. Пользователь формулирует реальную цель, проходит safety gate, получает маршрут из глав и ежедневных миссий, честно отмечает результат и видит две траектории: реальную и потенциальную.

Это уже интерактивный локальный MVP ядра продукта, а не пустой шаблон. Для первого запуска не нужны аккаунт, Supabase или API-ключ.

## Что работает

- короткий онбординг и договор честности;
- создание героя, архетипа и режима строгости;
- одна главная цель и контролируемые low-risk домены;
- локальный safety gate для опасных, медицинских и экстремальных запросов;
- rule-based планировщик с версиями плана, главами и семью миссиями;
- check-in: «выполнено», «частично», «не получилось» и заметка;
- XP, уровень, энергия, серия, свет мира, buffs/debuffs;
- recovery-flow после пропуска;
- карта пути и журнал событий;
- экран «реальный vs потенциальный» с прозрачной методологией;
- локальное сохранение в SQLite на iOS/Android и `localStorage` в web;
- ежедневное local notification на устройстве;
- полный сброс локальных данных из приложения.

## Требования

- macOS;
- Node.js **22.13 или новее** (рекомендуется актуальный Node.js LTS);
- pnpm 11 или npm;
- Xcode 26.4+ для Expo SDK 57 и iOS Simulator.

Проверьте версии:

```bash
node --version
pnpm --version
xcodebuild -version
```

Системный Node.js 18 не подходит для Expo SDK 57.

## Открыть в VS Code

```bash
cd /Users/pol4xer/Actum
code .
```

Если команда `code` не установлена: откройте VS Code → `File` → `Open Folder…` → выберите папку `Actum`.

## Установка и запуск

В новом терминале активируйте закреплённую для проекта версию Node.js и pnpm:

```bash
nvm use
corepack enable pnpm
pnpm install
```

Для быстрой проверки интерфейса в браузере:

```bash
pnpm web
```

Web-режим использует `localStorage`; SQLite, нативные уведомления и haptics проверяются только на iOS/Android.

Для полноценного запуска на iPhone Simulator:

```bash
pnpm ios
```

`pnpm ios` создаст нативную папку `ios/`, соберёт development build через Xcode и запустит iPhone Simulator.

После первой сборки обычный цикл разработки:

```bash
pnpm start
```

Затем нажмите `i` в терминале Expo, чтобы открыть установленный development build в iOS Simulator.

## Expo Application Services

Локальный проект связан с EAS-проектом `@pol4xer/actum`. Конфигурация сборок находится в `eas.json`:

- `development` — development client для внутреннего тестирования;
- `preview` — production-подобная внутренняя сборка;
- `production` — App Store-сборка с автоматическим увеличением build number.

Проверить аккаунт и привязку:

```bash
npx eas-cli@latest whoami
npx eas-cli@latest project:info
```

Создать первую облачную development-сборку для iOS:

```bash
npx eas-cli@latest build --platform ios --profile development
```

`eas init` и `eas build:configure` только привязывают и настраивают проект. Облачная сборка начинается исключительно после явного запуска `eas build`.

## Проверки

```bash
pnpm typecheck
pnpm check
```

`pnpm check` запускает TypeScript и production export web-версии.

## Структура

```text
src/
├── app/                    # Expo Router: Сегодня, Путь, Двойник, Профиль
├── components/             # UI, goal builder, check-in, герой
├── domain/                 # типы, risk gate и локальный goal engine
├── lib/                    # SQLite/web storage и notifications adapters
├── screens/                # онбординг
└── state/                  # состояние приложения и event updates
```

Подробные границы MVP и путь к production находятся в [`docs/PRODUCT_SCOPE.md`](docs/PRODUCT_SCOPE.md).

## Важные ограничения MVP

Локальный планировщик не выдаёт себя за live research или облачный AI. Он использует контролируемые шаблоны для чтения, обучения, бытовых навыков, организации, простых привычек и умеренного движения. HealthKit, Supabase, AI research pipeline и iOS Widget предусмотрены архитектурой, но не включены в первую локально запускаемую итерацию.

Actum предназначен для self-management и планирования. Он не является медицинским устройством, не диагностирует, не лечит и не гарантирует физический или жизненный результат.
