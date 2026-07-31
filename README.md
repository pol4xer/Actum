# Actum

Actum — iPhone-first MVP life-RPG приложения. Пользователь пишет цель обычными словами, GPT превращает её в структурированный маршрут, а приложение сразу показывает главы, миссии, check-in, последствия и прогресс героя.

Это намеренно простой MVP: Expo-приложение, локальное хранение и маленький Node-прокси к OpenAI. Supabase, аккаунты, сложный research pipeline и production-инфраструктура пока не нужны.

## Что уже работает

- онбординг, герой, архетип и режим строгости;
- свободная формулировка одной главной цели;
- запрос цели в OpenAI Responses API с видимым request ID и usage-метаданными;
- настоящий web-research с цитируемыми источниками или быстрый режим без поиска;
- GPT-план из глав, пошаговых миссий и таймеров в формате, который понимает приложение;
- экран проверки плана перед принятием;
- локальный fallback, если GPT недоступен;
- check-in: «выполнено», «частично», «не выполнено» и заметка;
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

Обычный запуск теперь делается одной командой:

```bash
cd /Users/pol4xer/Actum
./scripts/dev-ios.sh
```

Скрипт сам применит Node из `.nvmrc`, откроет два окна macOS Terminal, запустит AI-сервер, Metro и iOS Simulator. Перед запуском он корректно перезапустит старые процессы Actum на портах `8787` и `8081`; процесс из другой папки скрипт не завершит.

Если development build ещё не установлен в Simulator или после добавления нативной зависимости нужна пересборка:

```bash
./scripts/dev-ios.sh --rebuild
```

Проверить конфигурацию без открытия Terminal и Simulator:

```bash
./scripts/dev-ios.sh --dry-run
```

То же самое можно запустить как `pnpm dev:ios`, если текущий терминал уже использует Node 22. Основной вариант `./scripts/dev-ios.sh` сам загружает nvm и не зависит от Node, выбранного в исходном терминале.

Ручной запуск остаётся запасным вариантом.

Терминал 1 — локальный AI-сервер:

```bash
nvm use
pnpm ai:server
```

Успешный старт выглядит так:

```text
Actum AI server: http://127.0.0.1:8787 · gpt-5.6 · OpenAI key loaded
[actum-ai] prompt=actum-plan-2026-07-31 contract=plan-v2 transport=background-polling durable_state=ready
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

Haptics автоматически отключены в Simulator и остаются включены на физическом iPhone, поэтому симулятор больше не должен заполнять терминал ошибками `hapticpatternlibrary.plist`.

Таймер считает по абсолютному времени: если приложение ненадолго свернуть, после возврата он покажет правильный остаток или завершённое состояние. Фоновое уведомление при заблокированном экране в этот MVP не входит.

При каждом реальном запросе сервер печатает этапы `received → researching → planning → completed`, локальный request ID, OpenAI response ID, фоновые статусы `queued/in_progress/completed`, количество web-поисков, токены и время. Сетевой сбой теперь содержит `stage`, `operation`, HTTP/status code и безопасную цепочку причины — например `UND_ERR_HEADERS_TIMEOUT`; ключ, Authorization header и текст цели в лог не попадают. Usage нужно смотреть в том OpenAI API Project, которому принадлежит `sk-proj-...` ключ; это не история и не подписка ChatGPT.

Защита от повторных списаний работает на нескольких уровнях:

- уже идущий одинаковый запрос получает `inflight_join` и не запускает вторую генерацию;
- завершённый web-research сохраняется на 2 часа сразу после поиска, поэтому ошибка planning и повтор не запускают новый поиск (`research_cache_hit`);
- созданный background response сохраняется по его OpenAI ID: после сбоя polling повтор продолжает GET того же задания (`resume_pending`), а не делает новый платный POST;
- завершённый ответ этапа хранится 2 часа: если локальная проверка JSON не прошла, повтор проверяет тот же ответ (`stage_result_cache_hit`), не создавая ещё одну генерацию;
- готовый план сохраняется на 30 минут и возвращается как `cache_hit` без обращения к OpenAI.

Состояние защиты атомарно хранится в локальном `.actum/ai-state.json` (файл исключён из Git), поэтому `response_id`, кэши и блокировка неоднозначного POST переживают обычный перезапуск сервера и launcher. Перед каждым новым платным POST guard записывается на диск; после получения ID он заменяется resumable-заданием. Неистёкшие записи не вытесняются при большом числе целей. Если state-файл повреждён или недоступен для записи, сервер работает fail-closed и блокирует новые платные запросы с кодом `durable_state_unavailable`. Если соединение оборвалось до получения response ID, одинаковый запрос блокируется на 2 часа (`ambiguous_create`): Actum не пытается угадать, принял ли OpenAI платное задание, и не рискует вторым списанием. Безопасно повторяются только GET-проверки уже созданного background response. Одновременно сервер допускает не больше двух разных генераций.

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
цель + время + точка старта + режим исследования
→ локальный scripts/ai-server.mjs
→ OpenAI Responses API + web_search
→ исследовательский бриф и реальные URL-цитаты
→ отдельный structured-output запрос планировщика
→ строгий JSON-план
→ главы, шаги, таймеры и миссии Actum
→ пользователь принимает план
→ план сохраняется локально
```

Режим `Web research` включён по умолчанию: модель сначала ищет и анализирует источники, а затем отдельным запросом строит JSON-план. `Быстрый GPT` пропускает поиск. Оба OpenAI-этапа запускаются через background mode и опрашиваются по response ID, поэтому многоминутная работа не держится на одном хрупком HTTP-соединении.

Локальный risk-check ничего не запрещает: он только показывает заметное предупреждение. Запрос всё равно можно отправить, но ограничения и возможный отказ самого OpenAI API не обходятся.

## Проверки

```bash
pnpm typecheck
pnpm test:ai
pnpm check
```

`pnpm test:ai` использует фальшивый OpenAI, не открывает сетевые сокеты и не тратит API-деньги. Он воспроизводит сбои POST и polling, переимпортирует сервер как после рестарта и проверяет дисковое восстановление guard/response ID/кэшей, resume по тому же response ID, сохранение research, `inflight_join` и кэш готового плана. `pnpm check` запускает TypeScript, этот тест и production export web-версии.

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
scripts/ai-server.mjs      # локальный gateway и наблюдаемость запросов
scripts/ai/contracts/      # стабильный JSON-контракт плана
scripts/ai/prompts/        # независимо редактируемые research/plan prompts
scripts/ai/providers/      # адаптер Responses API
src/
├── app/                   # Сегодня, Путь, Двойник, Профиль
├── components/            # goal builder, mission runner, timer, check-in и UI
├── domain/                # локальный fallback и игровые типы
├── lib/ai-planner.ts      # вызов proxy и перевод GPT-плана в Actum
├── lib/                   # storage и notifications adapters
├── constants/theme.ts     # палитра, шрифты, интервалы и радиусы для смены visual style
├── screens/               # онбординг
└── state/                 # локальное состояние приложения
```

Дальнейшие границы MVP описаны в [`docs/PRODUCT_SCOPE.md`](docs/PRODUCT_SCOPE.md).
