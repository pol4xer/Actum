# Архитектура Actum

Цель этой структуры — менять навигацию, внешний вид, AI-провайдера, контракт плана,
локальное хранение и механику выполнения миссий независимо друг от друга. Модульность
здесь задаётся не количеством папок, а направлением зависимостей и узкими публичными API.

## Направление зависимостей

```text
src/app                  Expo Router entrypoints и composition root
  ↓
src/features/*           пользовательские сценарии и экраны
  ↓
src/state                application store, команды и persistence orchestration
  ↓
src/domain               чистые типы, правила и state machines

src/features/* ───────→ src/shared       общие presentation helpers
src/state ─────────────→ src/lib         platform adapters

scripts/ai-server.mjs    server composition root
  ↓
scripts/ai/*             contracts, prompts, provider, cache/state/http modules
```

Обратные импорты запрещены. `domain` не знает о React, Expo, сети, storage или Node.
Клиент `src/**` и локальный Node gateway `scripts/**` не импортируют друг друга.

Эти правила проверяет `test/architecture.test.mjs`. Проверка запускается внутри
`pnpm test:ai` и не позволяет незаметно вернуть бизнес-логику в route-файл или связать
два feature через их внутренние файлы.

## Клиентские модули

### `src/app`

Файлы маршрутов — однослойные entrypoints. Например, `src/app/journey.tsx` только
экспортирует публичный API `@/features/journey`. Поэтому смена Expo Router layout или
пути не требует переносить код экрана, а экран можно тестировать без Router.

`_layout.tsx` — единственный composition root клиента: он подключает провайдеры,
навигацию, hydration gate и глобальную конфигурацию.

### `src/features`

Каждая папка представляет самостоятельный пользовательский сценарий:

- `goal-planning` — форма цели, controller, порт планировщика, HTTP-адаптер, DTO-контракт
  и mapper в доменную модель;
- `mission-session` — runner и журнал одной сессии;
- `check-in` — итоговая оценка выполненной миссии;
- `home`, `journey`, `twin`, `settings`, `onboarding` — самостоятельные экраны.

Внешний код импортирует feature только через `src/features/<name>/index.ts`. Внутри
feature используются относительные импорты. Если одному feature нужен другой, он также
использует только его `index.ts`, а не внутренний компонент.

### `src/domain`

Здесь находятся долговечные правила, не зависящие от UI:

- `mission-run.ts` — создание, проверка и сводка сохранённой сессии;
- `mission-run-machine.ts` — детерминированные переходы preparing/work/rest/review/finish;
- `types.ts` — канонические TypeScript-типы доменной модели.

State machine принимает время аргументом. Поэтому таймеры можно тестировать без React,
Simulator и реального ожидания.

### `src/state`

State разделён на отдельные ответственности:

- `app-state-defaults.ts` — начальное состояние и версия aggregate;
- `app-state-codec.ts` — storage key, проверка, миграции и восстановление;
- `app-state.ts` — чистый reducer и compatibility re-exports;
- `app-commands.ts` — application use cases с injected clock;
- `app-state-repository.ts` — порт сохранения aggregate;
- `use-persistent-app-state.ts` — hydration и сериализованная очередь записи;
- `app-context.tsx` — совместимый React facade, который только собирает эти части.

Платформенный storage передаётся repository как `KeyValueStorage`. Замена AsyncStorage,
добавление SQLite или синхронизация не требуют менять reducer и feature UI.

### `src/lib` и `src/shared`

`lib` содержит платформенные adapters (`storage.*`, `notifications.*`, haptics) и чистые
низкоуровневые utilities. Platform suffixes `.native`/`.web` выбирает Expo bundler.

`shared/presentation` содержит только общие правила отображения: подписи архетипов,
форматирование baseline, источника и длительности миссии. `mission-actions.ts` приводит
новые и старые контракты плана к единому подневному виду, а
`execution-visibility.ts` отсекает неисполняемые блоки старых планов и очищает их
пользовательское представление без изменения сохранённых данных. `context-info.ts`
выбирает объяснения и provenance, которые можно спрятать за `?`, не затронув
исполняемые инструкции, дозировки и критерии. Универсальный
`components/ui/info-popover.tsx` отвечает только за показ и доступность. Поэтому стиль
подсказки, политика отбора текста и бизнес-контракт плана меняются независимо.

## AI gateway

`scripts/ai-server.mjs` остаётся process/composition root и сохраняет совместимый HTTP API:

- `GET /health`;
- `GET /saved-plan/latest`;
- `POST /plan`.

AI-аспекты разнесены по назначению:

- `scripts/ai/prompts` — independently versioned research/plan instructions;
- `scripts/ai/contracts` — provider JSON Schema, baseline parser и независимый validator;
- `scripts/ai/providers` — transport OpenAI Responses API;
- `scripts/ai/config/runtime.mjs` — runtime и cache identity;
- `scripts/ai/cache/keys.mjs` — детерминированные ключи этапов;
- `scripts/ai/state/durable-state.mjs` — durable billing ledger и TTL-кэши;
- `scripts/ai/http/helpers.mjs` — input/JSON/CORS/request-ID boundary.

Prompt, schema и validator намеренно не объединяются в одну реализацию: независимый
validator остаётся второй линией проверки результата модели.

Критический инвариант gateway: durable guard записывается до платного POST, затем на диск
записывается response ID, а completed raw response сохраняется до локальной валидации.
Рефакторинг модулей не имеет права менять этот порядок или формат `.actum/ai-state.json`
без отдельной миграции и fault-injection tests.

## Где менять отдельные аспекты

| Что меняется | Основной владелец | Что не должно меняться |
|---|---|---|
| Цвета, интервалы, радиусы | `src/constants/theme.ts` | domain, AI, storage |
| Общие UI primitives | `src/components/ui` | маршруты, pipeline |
| Контекст за `?` | `src/shared/presentation/context-info.ts` | исполняемые поля плана, AI-кэш |
| Подневное представление и видимость старых блоков | `src/shared/presentation/mission-actions.ts`, `execution-visibility.ts` | сохранённый plan, OpenAI |
| Экран/сценарий | `src/features/<name>` | Router и другие feature internals |
| Навигационный путь | `src/app` | реализация feature |
| Переходы runner | `src/domain/mission-run-machine.ts` | React view, persistence adapter |
| Награды и проекция героя | domain policy/selectors | reducer и Twin не дублируют числа |
| Формат хранения | `src/state/app-state-codec.ts` + repository migration | feature UI |
| iOS/web storage | `src/lib/storage.*` | reducer, commands |
| Текст AI-инструкций | `scripts/ai/prompts` + version bump | мобильный UI |
| JSON plan contract | server contract + client DTO contract + version bump | HTTP transport |
| OpenAI transport/model | provider/config adapter | plan mapper, screens |
| DTO → `GeneratedGoal` | `src/features/goal-planning` mapper | fetch и view |

## Инварианты совместимости

1. `APP_STATE_STORAGE_KEY` остаётся стабильным; schema меняется только с миграцией.
2. Сохранённые plan-v1–plan-v4 продолжают открываться через legacy runner.
3. `plan-v5` содержит только исполняемые in-app blocks.
4. Изменение prompt/contract/validator/parser/model меняет соответствующий cache key.
5. `reuseOnly` никогда не открывает путь создания нового OpenAI response.
6. Route-файлы кроме `_layout.tsx` остаются тонкими.
7. Межмодульный импорт идёт через публичный `index.ts`.
8. Серверная JSON Schema и клиентская Zod-схема plan-v5 структурно совпадают для всех
   поддерживаемых дневных лимитов и горизонтов.

## Как добавить новый feature

1. Создать `src/features/<name>/` и публичный `index.ts`.
2. Держать view, controller и feature-specific adapter раздельно, если присутствуют все
   три ответственности.
3. Общие бизнес-правила вынести в `domain`, общие display helpers — в `shared`.
4. Подключить feature в тонком route или в существующем composition root.
5. Добавить тесты поведения и запустить `pnpm check`; architecture test проверит границы.
