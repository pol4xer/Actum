# Actum

Actum — iPhone-first MVP life-RPG приложения. Пользователь пишет цель обычными словами, GPT превращает её в структурированный маршрут, а приложение сразу показывает главы, миссии, check-in, последствия и прогресс героя.

Это намеренно простой MVP: Expo-приложение, локальное хранение и маленький Node-прокси к OpenAI. Supabase, аккаунты, сложный research pipeline и production-инфраструктура пока не нужны.

## Что уже работает

- онбординг, герой, архетип и режим строгости;
- свободная формулировка одной главной цели;
- запрос цели в OpenAI Responses API;
- GPT-план из глав и конкретных миссий в формате, который понимает приложение;
- экран проверки плана перед принятием;
- локальный fallback, если GPT недоступен;
- check-in: «выполнено», «частично», «не получилось» и заметка;
- XP, уровень, энергия, серия, свет мира, buffs/debuffs и recovery-flow;
- карта пути, журнал и сравнение «реальный vs потенциальный»;
- AsyncStorage на iOS/Android, `localStorage` в web;
- локальные уведомления и haptics;
- development build для iOS через Expo/Xcode.

## Требования

- macOS;
- Node.js 22.13+; проект закреплён на Node 22.22.3;
- pnpm 11;
- Xcode 26.4+ для Expo SDK 57 и iOS Simulator;
- собственный OpenAI API key для GPT-планов.

Проверь версии:

```bash
nvm use
node --version
pnpm --version
xcodebuild -version
```

## Первый запуск

Открой проект в VS Code:

```bash
cd /Users/pol4xer/Actum
code .
```

Все команды `pnpm` ниже запускай только из этой папки. Перед запуском можно проверить `pwd`: он должен вернуть `/Users/pol4xer/Actum`. Если в выводе появляются `opencv`, `webdriverio` или предложение `pnpm approve-builds`, останови команду — это зависимости другого проекта из домашней папки, к Actum они не относятся.

Установи зависимости:

```bash
nvm use
corepack enable pnpm
pnpm install
```

Создай локальный env-файл, который Git не коммитит:

```bash
cp .env.example .env.local
```

Открой `.env.local` в VS Code и вставь свой ключ:

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6
EXPO_PUBLIC_ACTUM_AI_URL=http://127.0.0.1:8787
```

Ключ создаётся в [OpenAI API dashboard](https://platform.openai.com/api-keys). Не вставляй его в `EXPO_PUBLIC_*`: тогда он попадёт в мобильный bundle.

## Запуск MVP

Нужны два терминала VS Code.

Терминал 1 — локальный AI-сервер:

```bash
nvm use
pnpm ai:server
```

Успешный старт выглядит так:

```text
Actum AI server: http://127.0.0.1:8787 · gpt-5.6 · OpenAI key loaded
```

Терминал 2 — приложение:

```bash
nvm use
pnpm ios
```

После первой нативной сборки обычно достаточно:

```bash
pnpm start
```

и клавиши `i` в терминале Expo.

Для быстрой проверки интерфейса в браузере:

```bash
pnpm web
```

Если AI-сервер или ключ недоступны, экран покажет понятную ошибку и кнопку «Использовать локальный план» — основной игровой цикл всё равно можно проверить.

Если в Simulator уже сохранена старая цель, открой «Профиль» → «Начать другую цель». Профиль и XP останутся, а текущий маршрут будет очищен.

### Физический iPhone

Для Simulator подходит `127.0.0.1`. Для физического iPhone телефон и Mac должны быть в одной доверенной Wi-Fi сети. В `.env.local` укажи LAN IP Mac и разреши серверу слушать локальную сеть:

```dotenv
EXPO_PUBLIC_ACTUM_AI_URL=http://192.168.x.x:8787
ACTUM_AI_HOST=0.0.0.0
```

Это только dev-режим. Не открывай порт 8787 в интернет.

## Как проходит запрос

```text
цель + время + точка старта
→ локальный scripts/ai-server.mjs
→ OpenAI Responses API
→ строгий JSON-план
→ главы и миссии Actum
→ пользователь принимает план
→ план сохраняется локально
```

Сейчас GPT делает практический plan generation, но не выполняет глубокий web-research и не подбирает проверенные ссылки. Это следующая итерация после проверки основной хотелки.

## Проверки

```bash
pnpm typecheck
pnpm check
```

`pnpm check` запускает TypeScript и production export web-версии.

## Expo Application Services

Проект связан с EAS-проектом `@pol4xer/actum`. Профили находятся в `eas.json`: `development`, `preview`, `production`.

Проверить привязку:

```bash
npx eas-cli@latest whoami
npx eas-cli@latest project:info
```

Облачная development-сборка запускается отдельно:

```bash
npx eas-cli@latest build --platform ios --profile development
```

Текущий локальный AI-сервер не доступен такой сборке извне. Для TestFlight его позже нужно будет развернуть как маленький backend; для локального MVP это не требуется.

## Структура

```text
scripts/ai-server.mjs      # простой локальный proxy к OpenAI
src/
├── app/                   # Сегодня, Путь, Двойник, Профиль
├── components/            # goal builder, check-in и UI
├── domain/                # локальный fallback и игровые типы
├── lib/ai-planner.ts      # вызов proxy и перевод GPT-плана в Actum
├── lib/                   # storage и notifications adapters
├── screens/               # онбординг
└── state/                 # локальное состояние приложения
```

Дальнейшие границы MVP описаны в [`docs/PRODUCT_SCOPE.md`](docs/PRODUCT_SCOPE.md).
