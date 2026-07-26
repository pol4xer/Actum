# Product scope: Actum MVP

## Как два исходных документа сведены в один продукт

Первый документ задаёт рабочую среду: TypeScript, React Native, Expo Router, development build, Xcode как iOS-компилятор и VS Code/Cursor как основной редактор.

Второй документ задаёт продукт: универсальный goal engine с договором честности, связью «действие → последствия», research/safety стадией, миссиями, recovery-flow и двойником «реальный vs потенциальный».

Текущий репозиторий объединяет оба уровня. Это не production-ready App Store приложение и не пустой каркас. Это вертикальный local-first MVP, на котором можно проверить главную продуктовую петлю:

```text
договор честности
→ герой
→ одна цель
→ safety gate
→ план
→ миссия
→ честный check-in
→ награда / последствие
→ реальный vs потенциальный
```

## Реализовано сейчас

| Слой | Реализация |
|---|---|
| UI | Expo Router, четыре вкладки, iPhone-first тёмная тема |
| Goal intake | свободная формулировка + время, горизонт, точка старта |
| Risk gate | локальные правила для явных high-risk запросов |
| Plan composer | контролируемые шаблоны по шести low-risk доменам |
| Game loop | XP, уровни, энергия, серия, свет, buffs/debuffs |
| Check-in | completed / partial / skipped + заметка |
| Recovery | отдельный микро-шаг после пропуска |
| Potential twin | детерминированная игровая проекция текущей версии плана |
| Persistence | SQLite KV на native, localStorage на web |
| Notifications | ежедневное локальное напоминание после разрешения |

## Архитектурные границы

Доменная логика не зависит от экранов. `src/domain/goal-engine.ts` сейчас является локальным адаптером. В production его результат должен приходить из серверного pipeline:

```text
goal intake
→ moderation / risk gate
→ research dossier
→ plan composer
→ projection engine
```

Структура `Goal`, `PlanVersion`, `Mission`, `CheckIn` и журнал событий уже позволяет заменить локальный адаптер серверным, не переписывая пользовательский цикл.

## Намеренно отложено

- Supabase Auth/Postgres/RLS и синхронизация;
- серверная AI orchestration и registry источников;
- production-grade moderation и human review queue;
- нативный WidgetKit extension / App Intents;
- HealthKit;
- push notifications;
- голосовой ввод;
- несколько параллельных целей;
- социальные функции и монетизация.

## Следующий production milestone

1. Зафиксировать API-контракт для `GoalResearchDossier` и `PlanVersion`.
2. Добавить Supabase schema, anonymous/local-first migration и RLS.
3. Перенести risk gate и plan generation в server-only job pipeline.
4. Добавить версионирование/replan после серии check-in.
5. Реализовать Widget Snapshot и WidgetKit extension.
6. Добавить unit tests домена и device tests persistence/notifications.

## Safety

MVP блокирует очевидные опасные и медицинские запросы, но этот список не является достаточной production-модерацией. До внешнего тестирования нужен отдельный red-team corpus, серверная классификация, safe fallback и локализованные тексты кризисной поддержки. Нельзя показывать непроверенные номера помощи: они должны определяться по стране пользователя через надёжный актуальный источник.
