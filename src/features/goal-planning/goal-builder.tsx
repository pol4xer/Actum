import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { AppButton, Card, Pill, Screen, ScreenHeader } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import type { Mission, RoutineUnit } from '@/domain/types';
import { formatCalendarDate } from '@/lib/calendar-date';
import {
  formatMissionDuration,
} from '@/shared/presentation/plan-formatters';
import {
  executionBlockContextSections,
  missionContextSections,
  planContextSections,
  type ContextInfoSection,
} from '@/shared/presentation/context-info';
import { useApp } from '@/state';

import type { GoalPlanner } from './goal-planner';
import type { AIPlannerErrorCode } from './errors';
import {
  useGoalBuilderController,
  type GoalBuilderStage,
} from './use-goal-builder-controller';

const MINUTES = [10, 20, 30, 45, 60];
const HORIZONS = [
  { value: 7, label: '7 дней' },
  { value: 14, label: '2 недели' },
  { value: 30, label: '30 дней' },
];

export function GoalBuilder({ planner }: { planner?: GoalPlanner } = {}) {
  const { createGoal } = useApp();
  const {
    stage,
    prompt,
    setPrompt,
    baseline,
    setBaseline,
    targetTimeline,
    setTargetTimeline,
    dailyMinutes,
    setDailyMinutes,
    horizonDays,
    setHorizonDays,
    currentLevel,
    setCurrentLevel,
    researchMode,
    setResearchMode,
    preview,
    savedPreview,
    generationError,
    generationErrorCode,
    risk,
    detailsComplete,
    continueFromIntent,
    backToIntent,
    editDetails,
    generateGoal,
    retryGeneration,
    openSavedPlan,
    acceptPlan,
  } = useGoalBuilderController({ onAcceptGoal: createGoal, planner });
  const screenContext = goalBuilderContextSections({
    stage,
    researchMode,
    riskTitle: risk.safe ? undefined : risk.title,
    riskMessage: risk.safe ? undefined : risk.message,
    safe: risk.safe,
    generationError,
    generationErrorCode,
  });

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <ScreenHeader
          eyebrow={`Новая цель · ${stage === 'intent' ? '1' : stage === 'details' ? '2' : '3'} из 3`}
          title={
            stage === 'intent'
              ? 'Что хочешь изменить?'
              : stage === 'details'
                ? 'Сделаем цель реальной'
                : stage === 'generating'
                  ? 'GPT собирает маршрут'
                  : stage === 'error'
                    ? 'План пока не пришёл'
                      : 'Твой первый маршрут'
          }
          action={<InfoPopover title="Об этом шаге" sections={screenContext} />}
        />

        {stage === 'intent' ? (
          <>
            <TextInput
              accessibilityLabel="Формулировка цели"
              autoFocus
              multiline
              onChangeText={setPrompt}
              placeholder="Например: хочу дочитать книгу, научиться готовить пять блюд или разобрать документы"
              placeholderTextColor={Palette.textDim}
              style={styles.promptInput}
              textAlignVertical="top"
              value={prompt}
            />
            <View style={styles.exampleBlock}>
              <ThemedText type="eyebrow" style={styles.muted}>
                Подходящие для MVP цели
              </ThemedText>
              <View style={styles.exampleWrap}>
                {['Дочитать книгу', 'Выучить основы испанского', 'Разобрать документы'].map(
                  (example) => (
                    <Pressable
                      key={example}
                      onPress={() => setPrompt(example)}
                      style={({ pressed }) => [styles.example, pressed && styles.pressed]}>
                      <ThemedText type="small">{example}</ThemedText>
                    </Pressable>
                  ),
                )}
              </View>
            </View>
            {savedPreview ? (
              <Card accent>
                <View style={styles.cardTop}>
                  <Pill tone="success">сохранённый план</Pill>
                  <InfoPopover
                    title="Почему это бесплатно?"
                    sections={[
                      {
                        body: `${savedPreview.goal.title} · ${savedPreview.plan.horizonDays} дней. План уже сохранён на устройстве и откроется без повторного web-поиска или GPT-запроса.`,
                      },
                    ]}
                  />
                </View>
                <ThemedText type="subtitle">Сохранённый исследованный план найден</ThemedText>
                <AppButton
                  label="Открыть сохранённый план"
                  onPress={openSavedPlan}
                />
              </Card>
            ) : null}
            <AppButton
              label="Продолжить"
              disabled={prompt.trim().length < 5}
              onPress={continueFromIntent}
            />
          </>
        ) : null}

        {stage === 'details' ? (
          <>
            <Question
              title="Текущая измеренная точка · обязательно"
              help={[
                {
                  body: 'Укажи число и единицу, если они известны. GPT сохранит исходную формулировку и отдельно нормализует метрику.',
                },
              ]}>
              <TextInput
                accessibilityLabel="Текущая измеренная точка"
                maxLength={500}
                multiline
                onChangeText={setBaseline}
                placeholder="Например: сейчас читаю 8 страниц за 20 минут или удерживаю планку 45 секунд"
                placeholderTextColor={Palette.textDim}
                style={[styles.detailInput, styles.baselineInput]}
                textAlignVertical="top"
                value={baseline}
              />
            </Question>

            <Question
              title="Срок большой цели · обязательно"
              help={[
                {
                  body: 'Подробный календарь покроет первый выбранный горизонт, а этот срок останется направлением всей цели.',
                },
              ]}>
              <TextInput
                accessibilityLabel="Срок большой цели"
                maxLength={80}
                onChangeText={setTargetTimeline}
                placeholder="Например: 6 месяцев или к 1 июня"
                placeholderTextColor={Palette.textDim}
                style={styles.detailInput}
                value={targetTimeline}
              />
            </Question>

            <Question title="Сколько времени реально есть в день?">
              <ChoiceRow>
                {MINUTES.map((value) => (
                  <Choice
                    key={value}
                    label={`${value} мин`}
                    selected={dailyMinutes === value}
                    onPress={() => setDailyMinutes(value)}
                  />
                ))}
              </ChoiceRow>
            </Question>

            <Question title="Какой первый горизонт?">
              <ChoiceRow>
                {HORIZONS.map((option) => (
                  <Choice
                    key={option.value}
                    label={option.label}
                    selected={horizonDays === option.value}
                    onPress={() => setHorizonDays(option.value)}
                  />
                ))}
              </ChoiceRow>
            </Question>

            <Question title="Опыт относительно цели">
              <View style={styles.levelList}>
                <LevelChoice
                  label="Начинаю с нуля"
                  selected={currentLevel === 'starting'}
                  onPress={() => setCurrentLevel('starting')}
                />
                <LevelChoice
                  label="Есть небольшой опыт"
                  selected={currentLevel === 'some-experience'}
                  onPress={() => setCurrentLevel('some-experience')}
                />
                <LevelChoice
                  label="Возвращаюсь после паузы"
                  selected={currentLevel === 'returning'}
                  onPress={() => setCurrentLevel('returning')}
                />
              </View>
            </Question>

            <Question
              title="Насколько глубоко исследовать цель?"
              help={[
                {
                  body:
                    researchMode === 'web'
                      ? 'OpenAI сначала изучит web-источники, затем отдельным шагом соберёт структурированный маршрут. Это дольше и дороже одного запроса.'
                      : 'Один запрос без web-поиска. Подходит для быстрой проверки идеи.',
                },
              ]}>
              <ChoiceRow>
                <Choice
                  label="Web research"
                  selected={researchMode === 'web'}
                  onPress={() => setResearchMode('web')}
                />
                <Choice
                  label="Быстрый GPT"
                  selected={researchMode === 'quick'}
                  onPress={() => setResearchMode('quick')}
                />
              </ChoiceRow>
            </Question>

            <View style={styles.buttonRow}>
              <AppButton label="Назад" variant="ghost" onPress={backToIntent} />
              <AppButton
                label={researchMode === 'web' ? 'Исследовать и собрать' : 'Собрать с GPT'}
                disabled={!detailsComplete}
                onPress={generateGoal}
                style={styles.flex}
              />
            </View>
          </>
        ) : null}

        {stage === 'generating' ? (
          <Card accent style={styles.generatingCard}>
            <ActivityIndicator color={Palette.goldBright} size="large" />
            <ThemedText type="subtitle" style={styles.center}>
              Собираю реальные шаги…
            </ThemedText>
          </Card>
        ) : null}

        {stage === 'error' ? (
          <Card style={styles.errorCard}>
            <View style={styles.cardTop}>
              <Pill tone="warning">
                {generationErrorCode === 'INVALID_RESPONSE'
                  ? 'Ответ не прочитан'
                  : generationErrorCode === 'SAVED_RESPONSE_UNAVAILABLE'
                    ? 'Ответ уже не сохранён'
                  : generationErrorCode === 'TIMEOUT' || generationErrorCode === 'UPSTREAM_TIMEOUT'
                    ? 'Долгая генерация'
                    : generationErrorCode === 'CONNECTION_INTERRUPTED'
                      ? 'Связь прервана'
                      : generationErrorCode === 'GATEWAY_UNREACHABLE'
                        ? 'Сервер недоступен'
                        : 'Ошибка OpenAI'}
              </Pill>
              <InfoPopover title="Что произошло?" sections={screenContext} />
            </View>
            <ThemedText type="subtitle">
              {generationErrorCode === 'INVALID_RESPONSE'
                ? 'План сохранён и ждёт повторной проверки'
                : generationErrorCode === 'SAVED_RESPONSE_UNAVAILABLE'
                  ? 'Новый запрос не был отправлен'
                : generationErrorCode === 'TIMEOUT' || generationErrorCode === 'UPSTREAM_TIMEOUT'
                  ? 'План ещё не завершён'
                  : 'Не удалось получить план'}
            </ThemedText>
            {generationErrorCode !== 'SAVED_RESPONSE_UNAVAILABLE' ? (
              <AppButton
                label={
                  generationErrorCode === 'INVALID_RESPONSE'
                    ? 'Проверить сохранённый план · без GPT'
                    : 'Повторить запрос к GPT'
                }
                onPress={retryGeneration}
              />
            ) : null}
            <AppButton label="Изменить параметры" variant="ghost" onPress={editDetails} />
          </Card>
        ) : null}

        {stage === 'review' && preview ? (
          <>
            <Card accent>
              <View style={styles.cardTop}>
                <Pill tone="success">план готов</Pill>
                <InfoPopover
                  title="О плане"
                  sections={[
                    ...planContextSections(preview.plan, {
                      baseline: preview.goal.baseline,
                      targetTimeline: preview.goal.targetTimeline,
                    }),
                    ...(!risk.safe
                      ? [
                          {
                            heading: risk.title,
                            body: risk.message,
                            tone: 'warning' as const,
                          },
                        ]
                      : []),
                  ]}
                />
              </View>
              <ThemedText type="subtitle">{preview.goal.title}</ThemedText>
              <View style={styles.planMeta}>
                <Meta value={`${dailyMinutes} мин`} label="в день" />
                <Meta value={`${horizonDays}`} label="дней" />
                <Meta value={`${preview.plan.missions.length}`} label="дней в плане" />
              </View>
            </Card>

            <View style={styles.section}>
              <ThemedText type="eyebrow" style={styles.muted}>
                Календарь · все дни
              </ThemedText>
              {preview.plan.missions.map((mission, index) => (
                <View key={mission.id} style={styles.missionPreview}>
                  <View style={styles.sequence}>
                    <ThemedText type="smallBold" style={styles.sequenceText}>
                      {mission.dayNumber ?? index + 1}
                    </ThemedText>
                  </View>
                  <View style={styles.missionCopy}>
                    <ThemedText type="eyebrow" style={styles.missionDate}>
                      {missionCalendarLabel(mission, index)}
                    </ThemedText>
                    <View style={styles.missionTitleRow}>
                      <ThemedText type="smallBold" style={styles.flex}>
                        {mission.title}
                      </ThemedText>
                      <InfoPopover
                        title={`День ${mission.dayNumber ?? index + 1}`}
                        accessibilityLabel={`Показать пояснение к дню ${mission.dayNumber ?? index + 1}`}
                        sections={missionPreviewContextSections(mission)}
                      />
                    </View>
                    <ThemedText type="small" style={styles.muted}>
                      {formatMissionDuration(mission, { inAppRecordLabel: 'отметок' })} ·{' '}
                      {mission.xp} XP
                    </ThemedText>
                    {mission.execution?.kind === 'in_app' ? (
                      <ThemedText type="small" style={styles.prescriptionPreview}>
                        {[
                          ...mission.execution.blocks.map((block) =>
                            inAppBlockActionPreview(block),
                          ),
                          `✓ День засчитан: ${mission.execution.successCriterion}`,
                        ].join('\n')}
                      </ThemedText>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.buttonRow}>
              <AppButton label="Изменить" variant="ghost" onPress={editDetails} />
              <AppButton label="Принять план" icon="✦" onPress={acceptPlan} style={styles.flex} />
            </View>
          </>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Question({
  title,
  help,
  children,
}: {
  title: string;
  help?: readonly ContextInfoSection[];
  children: ReactNode;
}) {
  return (
    <View style={styles.question}>
      <View style={styles.questionTitleRow}>
        <ThemedText type="smallBold" style={styles.flex}>
          {title}
        </ThemedText>
        {help ? (
          <InfoPopover
            title={title.replace(' · обязательно', '')}
            accessibilityLabel={`Показать пояснение: ${title}`}
            sections={help}
          />
        ) : null}
      </View>
      {children}
    </View>
  );
}

function ChoiceRow({ children }: { children: ReactNode }) {
  return <View style={styles.choiceRow}>{children}</View>;
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceActive,
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" style={selected && styles.choiceTextActive}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function LevelChoice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.levelChoice,
        selected && styles.levelChoiceActive,
        pressed && styles.pressed,
      ]}>
      <View style={[styles.radio, selected && styles.radioActive]} />
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

function Meta({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.meta}>
      <ThemedText type="subtitle" style={styles.gold}>
        {value}
      </ThemedText>
      <ThemedText type="eyebrow" style={styles.muted}>
        {label}
      </ThemedText>
    </View>
  );
}

function inAppBlockActionPreview(
  block: Extract<NonNullable<Mission['execution']>, { kind: 'in_app' }>['blocks'][number],
) {
  if (block.kind === 'timer') {
    return `• ${block.title}: ${block.instruction} · ${block.sets}×${formatCompactDuration(block.durationSecondsPerSet)}, отдых ${formatCompactDuration(block.restSeconds)}\n  ✓ ${block.successCriterion}`;
  }
  if (block.kind === 'counter') {
    const unit = routineUnitLabel(block.unit, block.unitLabel);
    return `• ${block.title}: ${block.instruction} · ${block.sets}×${block.targetPerSet} ${unit}, время подхода ${formatCompactDuration(block.workSecondsPerSet)}, отдых ${formatCompactDuration(block.restSeconds)}${block.tempo ? ` · темп: ${block.tempo}` : ''}\n  ✓ ${block.successCriterion}`;
  }
  if (block.kind === 'checklist') {
    return `• ${block.title}: ${block.items.join('; ')} · ориентир ${formatCompactDuration(block.estimatedSeconds)}\n  ✓ ${block.successCriterion}`;
  }
  return `• ${block.title}: ${block.prompt} · ${block.minCharacters}–${block.maxCharacters} знаков · ориентир ${formatCompactDuration(block.estimatedSeconds)}\n  ✓ ${block.successCriterion}`;
}

function goalBuilderContextSections({
  stage,
  researchMode,
  riskTitle,
  riskMessage,
  safe,
  generationError,
  generationErrorCode,
}: {
  stage: GoalBuilderStage;
  researchMode: 'quick' | 'web';
  riskTitle?: string;
  riskMessage?: string;
  safe: boolean;
  generationError?: string;
  generationErrorCode?: AIPlannerErrorCode;
}): ContextInfoSection[] {
  const sections: ContextInfoSection[] = [];
  if (stage === 'intent') {
    sections.push({ body: 'Опиши одну главную цель обычными словами.' });
  } else if (stage === 'details') {
    sections.push({ body: 'Ограничения нужны, чтобы получить конкретный подневный план.' });
  } else if (stage === 'generating') {
    sections.push({
      body:
        researchMode === 'web'
          ? 'Сначала идёт web-поиск, затем отдельная сборка плана. Это может занять несколько минут.'
          : 'Выполняется один GPT-запрос без web-поиска.',
    });
  } else if (stage === 'error' && generationError) {
    sections.push({ heading: 'Техническая деталь', body: generationError, tone: 'warning' });
    const retryContext = errorRetryContext(generationErrorCode);
    if (retryContext) sections.push(retryContext);
  } else if (stage === 'review') {
    sections.push({ body: 'Проверь календарь действий и прими его, если нагрузка подходит.' });
  }
  if (!safe && riskTitle && riskMessage) {
    sections.push({ heading: riskTitle, body: riskMessage, tone: 'warning' });
  }
  return sections;
}

function missionPreviewContextSections(mission: Mission): ContextInfoSection[] {
  const sections = missionContextSections(mission);
  if (mission.execution?.kind !== 'in_app') return sections;

  return [
    ...sections,
    ...mission.execution.blocks.flatMap((block) =>
      executionBlockContextSections(block).map((section) => ({
        ...section,
        heading: `${block.title} · ${section.heading ?? 'расчёт'}`,
      })),
    ),
  ];
}

function errorRetryContext(code?: AIPlannerErrorCode): ContextInfoSection | undefined {
  if (code === 'INVALID_RESPONSE') {
    return {
      heading: 'Без нового платного запроса',
      body:
        'Ответ OpenAI уже сохранён. Кнопка повторно проверит именно его в reuse-only режиме и не создаст новый OpenAI response.',
    };
  }
  if (code === 'SAVED_RESPONSE_UNAVAILABLE') {
    return {
      heading: 'Новый запрос не отправлен',
      body:
        'Сохранённый ответ уже нельзя бесплатно восстановить, поэтому автоматического повтора нет. Новый платный запрос возможен только после явного возвращения к параметрам и запуска генерации.',
    };
  }
  if (
    code === 'TIMEOUT' ||
    code === 'UPSTREAM_TIMEOUT' ||
    code === 'CONNECTION_INTERRUPTED' ||
    code === 'GATEWAY_UNREACHABLE'
  ) {
    return {
      heading: 'Что сделает повтор',
      body:
        'AI gateway переиспользует сохранённые research, response ID и завершённые платные этапы, если они уже существуют. Если платный этап ещё не был создан, явный повтор может запустить его.',
    };
  }
  if (code) {
    return {
      heading: 'Стоимость повтора',
      body: 'Эта ошибка не гарантирует сохранённый ответ. Явный повтор может создать новый платный OpenAI response.',
      tone: 'warning',
    };
  }
  return undefined;
}

function formatCompactDuration(seconds: number) {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} мин` : `${seconds} сек`;
}

function routineUnitLabel(unit: RoutineUnit, custom?: string) {
  if (unit === 'custom') return custom || 'ед.';
  const labels: Record<Exclude<RoutineUnit, 'custom'>, string> = {
    reps: 'повт.',
    seconds: 'сек',
    minutes: 'мин',
    pages: 'стр.',
    items: 'элем.',
    words: 'слов',
    meters: 'м',
    attempts: 'попыток',
  };
  return labels[unit];
}

function missionCalendarLabel(mission: Mission, index: number) {
  const dayNumber = mission.dayNumber ?? index + 1;
  const dateLabel = formatCalendarDate(mission.scheduledDate, 'long');
  if (!dateLabel) return `День ${dayNumber}`;
  return `День ${dayNumber} · ${dateLabel}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  prescriptionPreview: { color: Palette.cyan, lineHeight: 20 },
  muted: { color: Palette.textMuted },
  violet: { color: Palette.violetSoft },
  gold: { color: Palette.goldBright },
  warning: { color: Palette.warning },
  center: { textAlign: 'center' },
  fullWidth: { width: '100%' },
  pressed: { opacity: 0.7 },
  promptInput: {
    minHeight: 180,
    borderRadius: Radius.large,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    padding: Spacing.three,
    color: Palette.text,
    fontSize: 18,
    lineHeight: 27,
  },
  detailInput: {
    minHeight: 54,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twoHalf,
    color: Palette.text,
    fontSize: 16,
    lineHeight: 23,
  },
  baselineInput: { minHeight: 112 },
  exampleBlock: { gap: Spacing.two },
  exampleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  example: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surfaceSoft,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  question: { gap: Spacing.two, marginBottom: Spacing.two },
  questionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  choiceRow: { flexDirection: 'row', gap: Spacing.two },
  choice: {
    flex: 1,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
  },
  choiceActive: { borderColor: Palette.gold, backgroundColor: '#2A2419' },
  choiceTextActive: { color: Palette.goldBright },
  levelList: { gap: Spacing.two },
  levelChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
    minHeight: 54,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    paddingHorizontal: Spacing.three,
  },
  levelChoiceActive: { borderColor: Palette.violet, backgroundColor: '#1D1A32' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: Palette.textDim },
  radioActive: { borderWidth: 5, borderColor: Palette.violetSoft },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  generatingCard: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  errorCard: { gap: Spacing.three, borderColor: '#5B4228' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planMeta: {
    flexDirection: 'row',
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
  },
  meta: { flex: 1, gap: 3 },
  section: { gap: Spacing.two },
  missionPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
    minHeight: 64,
    borderRadius: Radius.medium,
    backgroundColor: Palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    padding: Spacing.twoHalf,
  },
  sequence: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2B251A',
    borderWidth: 1,
    borderColor: '#5D4B2B',
  },
  sequenceText: { color: Palette.goldBright },
  missionCopy: { flex: 1, gap: 2 },
  missionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  missionDate: { color: Palette.violetSoft },
});
