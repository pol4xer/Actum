import { useEffect, useState, type ReactNode } from 'react';
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
import { goalDurationLabel } from '@/domain/goal-program';
import type { GeneratedGoal, Mission } from '@/domain/types';
import { formatCalendarDate } from '@/lib/calendar-date';
import { actionableExecutionBlocks } from '@/shared/presentation/execution-visibility';
import { presentMissionDay, type MissionActionPresentation } from '@/shared/presentation/mission-actions';
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
import {
  RETRY_LIMIT_HELP,
  RETRY_LIMIT_OPTIONS,
  RETRY_LIMIT_QUESTION,
  estimatedTargetCycleLabel,
  retryLimitLabel,
} from './program-labels';
import { ProgramRoadmap } from './program-roadmap';
import {
  GOAL_NOT_FEASIBLE_MESSAGE,
  RETRY_CAP_TOO_SHORT_MESSAGE,
  SAVED_RESPONSE_RETRY_LABEL,
  SAVED_RESPONSE_REVIEW_MESSAGE,
  isFeasibilityPlannerError,
  shouldOfferPlannerRetry,
  type AIPlannerErrorCode,
} from './errors';
import {
  useGoalBuilderController,
  type GoalBuilderStage,
} from './use-goal-builder-controller';

const MINUTES = [10, 20, 30, 45, 60];

export function GoalBuilder({ planner }: { planner?: GoalPlanner } = {}) {
  const { createGoal } = useApp();
  const {
    stage,
    prompt,
    setPrompt,
    baseline,
    setBaseline,
    duration,
    setDuration,
    dailyMinutes,
    setDailyMinutes,
    currentLevel,
    setCurrentLevel,
    researchMode,
    preview,
    savedPreview,
    generationError,
    generationErrorCode,
    detailsComplete,
    continueFromIntent,
    backToIntent,
    editDetails,
    generateGoal,
    retryGeneration,
    openSavedPlan,
    acceptPlan,
  } = useGoalBuilderController({ onAcceptGoal: createGoal, planner });
  const [showPlanDetails, setShowPlanDetails] = useState(false);
  const [expandedPreviewMissionId, setExpandedPreviewMissionId] = useState<string>();

  useEffect(() => {
    if (stage === 'review') return;
    setShowPlanDetails(false);
    setExpandedPreviewMissionId(undefined);
  }, [stage]);

  const screenContext = goalBuilderContextSections({
    stage,
    researchMode,
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
                ? 'Настроим план'
                : stage === 'generating'
                  ? 'Собираю план'
                  : stage === 'error'
                    ? 'План пока не пришёл'
                    : showPlanDetails
                      ? 'План по дням'
                      : 'План готов'
          }
          action={stage === 'review' ? undefined : <InfoPopover title="Об этом шаге" sections={screenContext} />}
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
                Примеры
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
                  <ThemedText type="smallBold">План уже сохранён</ThemedText>
                  <InfoPopover
                    title="Почему это бесплатно?"
                    sections={[
                      {
                        body: `${savedPreview.goal.title} · ${savedPreview.plan.targetCycleNumber ? `лимит ${retryLimitLabel(savedPreview.goal.program.duration)}` : `срок старого плана ${goalDurationLabel(savedPreview.goal.program.duration)}`}. План уже сохранён на устройстве и откроется без повторного web-поиска или GPT-запроса.`,
                      },
                    ]}
                  />
                </View>
                <AppButton label="Открыть план" onPress={openSavedPlan} />
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
              title="С чего начинаешь? · обязательно"
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
              title={RETRY_LIMIT_QUESTION}
              help={[
                {
                  body: RETRY_LIMIT_HELP,
                },
              ]}>
              <View style={styles.levelList}>
                {RETRY_LIMIT_OPTIONS.map((option) => (
                  <LevelChoice
                    key={option.value}
                    label={option.label}
                    selected={duration === option.value}
                    onPress={() => setDuration(option.value)}
                  />
                ))}
              </View>
            </Question>

            <Question title="Сколько минут в день?">
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

            <Question title="Твой опыт">
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

            <View style={styles.buttonRow}>
              <AppButton label="Назад" variant="ghost" onPress={backToIntent} />
              <AppButton
                label="Собрать план"
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
              <Pill tone="warning">{generationErrorBadge(generationErrorCode)}</Pill>
              <InfoPopover title="Что произошло?" sections={screenContext} />
            </View>
            <ThemedText type="subtitle">{generationErrorTitle(generationErrorCode)}</ThemedText>
            {shouldOfferPlannerRetry(generationErrorCode) ? (
              <AppButton
                label={
                  generationErrorCode === 'INVALID_RESPONSE'
                    ? SAVED_RESPONSE_RETRY_LABEL
                    : 'Повторить запрос к GPT'
                }
                onPress={retryGeneration}
              />
            ) : null}
            <AppButton label="Изменить параметры" variant="ghost" onPress={editDetails} />
          </Card>
        ) : null}

        {stage === 'review' && preview ? (
          showPlanDetails ? (
            <>
              <View style={styles.planDetailsHeader}>
                <ThemedText type="smallBold" style={styles.flex}>
                  {preview.goal.title}
                </ThemedText>
                <InfoPopover title="О плане" sections={planInfoWithoutSafety(preview)} />
              </View>

              <ProgramRoadmap
                program={preview.goal.program}
                targetCycleNumber={preview.plan.targetCycleNumber}
              />

              <View style={styles.dayList}>
                {preview.plan.missions.map((mission, index) => {
                  const expanded = expandedPreviewMissionId === mission.id;
                  return (
                    <PlanDayPreview
                      key={mission.id}
                      mission={mission}
                      index={index}
                      expanded={expanded}
                      onToggle={() =>
                        setExpandedPreviewMissionId(expanded ? undefined : mission.id)
                      }
                    />
                  );
                })}
              </View>

              <View style={styles.buttonRow}>
                <AppButton
                  label="Назад"
                  variant="ghost"
                  onPress={() => {
                    setShowPlanDetails(false);
                    setExpandedPreviewMissionId(undefined);
                  }}
                />
                <AppButton label="Начать" onPress={acceptPlan} style={styles.flex} />
              </View>
            </>
          ) : (
            <>
              <Card accent style={styles.readyCard}>
                <View style={styles.readyTop}>
                  <ThemedText type="subtitle" numberOfLines={2} style={styles.flex}>
                    {preview.goal.title}
                  </ThemedText>
                  <InfoPopover title="О плане" sections={planInfoWithoutSafety(preview)} />
                </View>
                <View style={styles.planMeta}>
                  <Meta
                    value={estimatedTargetCycleLabel(preview.plan.targetCycleNumber) ?? '—'}
                    label="ориентир"
                  />
                  <Meta
                    value={retryLimitLabel(preview.goal.program.duration)}
                    label="лимит"
                  />
                  <Meta value={`${preview.plan.dailyMinutes} мин`} label="в день" />
                </View>
              </Card>

              <View style={styles.reviewActions}>
                <AppButton label="Начать" onPress={acceptPlan} />
                <AppButton
                  label="Посмотреть план"
                  variant="secondary"
                  onPress={() => setShowPlanDetails(true)}
                />
                <AppButton label="Изменить" variant="ghost" onPress={editDetails} />
              </View>
            </>
          )
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}


function PlanDayPreview({
  mission,
  index,
  expanded,
  onToggle,
}: {
  mission: Mission;
  index: number;
  expanded: boolean;
  onToggle(): void;
}) {
  return (
    <Card style={styles.dayCard}>
      <View style={styles.dayHeaderRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Свернуть' : 'Раскрыть'} день ${mission.dayNumber ?? index + 1}: ${mission.title}`}
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={({ pressed }) => [styles.dayHeaderButton, pressed && styles.pressed]}>
          <View style={styles.sequence}>
            <ThemedText type="smallBold" style={styles.sequenceText}>
              {mission.dayNumber ?? index + 1}
            </ThemedText>
          </View>
          <View style={styles.missionCopy}>
            <ThemedText type="eyebrow" style={styles.missionDate}>
              {missionCalendarLabel(mission, index)}
            </ThemedText>
            <ThemedText type="smallBold">{mission.title}</ThemedText>
            <ThemedText type="small" style={styles.muted}>
              {formatMissionDuration(mission, { inAppRecordLabel: 'отметок' })}
            </ThemedText>
          </View>
          <ThemedText style={styles.dayChevron}>{expanded ? '⌃' : '⌄'}</ThemedText>
        </Pressable>
        {expanded ? (
          <InfoPopover
            title={`О дне ${mission.dayNumber ?? index + 1}`}
            accessibilityLabel={`Показать пояснения к дню ${mission.dayNumber ?? index + 1}`}
            sections={missionPreviewContextSections(mission)}
          />
        ) : null}
      </View>

      {expanded ? <MissionActionDetails mission={mission} /> : null}
    </Card>
  );
}

function MissionActionDetails({ mission }: { mission: Mission }) {
  const presentation = presentMissionDay(mission);
  return (
    <View style={styles.expandedDay}>
      {presentation.actions.map((action, index) => (
        <ActionBlock key={action.id} action={action} index={index} />
      ))}
      <Criterion text={presentation.dayCriterion} day />
    </View>
  );
}

function ActionBlock({
  action,
  index,
}: {
  action: MissionActionPresentation;
  index: number;
}) {
  return (
    <View style={styles.actionBlock}>
      <ThemedText type="smallBold">
        {index + 1}. {action.title}
      </ThemedText>
      {action.dose ? (
        <ThemedText type="smallBold" style={styles.actionDose}>
          {action.dose}
        </ThemedText>
      ) : null}
      {action.items?.map((item, itemIndex) => (
        <ThemedText key={`${item}-${itemIndex}`} type="small">
          {itemIndex + 1}. {item}
        </ThemedText>
      ))}
      {action.instruction ? <ThemedText type="small">{action.instruction}</ThemedText> : null}
      <Criterion text={action.criterion} />
    </View>
  );
}

function Criterion({ text, day = false }: { text?: string; day?: boolean }) {
  if (!text?.trim()) return null;
  return (
    <View style={day ? styles.dayCriterion : styles.criterion}>
      <ThemedText type="eyebrow" style={styles.muted}>
        {day ? 'День выполнен' : 'Готово, если'}
      </ThemedText>
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

function planInfoWithoutSafety(preview: GeneratedGoal): ContextInfoSection[] {
  return planContextSections(preview.plan, {
    baseline: preview.goal.baseline,
    targetTimeline: preview.goal.targetTimeline,
  }).filter((section) => section.heading !== 'Безопасность' && section.tone !== 'warning');
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

function goalBuilderContextSections({
  stage,
  researchMode,
  generationError,
  generationErrorCode,
}: {
  stage: GoalBuilderStage;
  researchMode: 'quick' | 'web';
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
  return sections;
}

function missionPreviewContextSections(mission: Mission): ContextInfoSection[] {
  const sections = missionContextSections(mission).filter(
    (section) => section.heading !== 'Предупреждение' && section.heading !== 'Критерий дня',
  );
  if (mission.execution?.kind !== 'in_app') return sections;

  return [
    ...sections,
    ...actionableExecutionBlocks(mission.execution.blocks).flatMap((block) =>
      executionBlockContextSections(block).map((section) => ({
        ...section,
        heading: `${block.title} · ${section.heading ?? 'расчёт'}`,
      })),
    ),
  ];
}

function errorRetryContext(code?: AIPlannerErrorCode): ContextInfoSection | undefined {
  if (isFeasibilityPlannerError(code)) {
    return {
      heading: 'Без нового запроса к планировщику',
      body:
        code === 'RETRY_CAP_TOO_SHORT'
          ? 'Research сохранён, а сборка плана не запускалась. При смене только лимита Actum переиспользует этот research.'
          : 'Research сохранён, а сборка плана не запускалась. Измени цель или исходный результат, если хочешь выполнить новый расчёт.',
    };
  }
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

function generationErrorBadge(code?: AIPlannerErrorCode): string {
  switch (code) {
    case 'INVALID_RESPONSE':
      return 'Ответ не прочитан';
    case 'SAVED_RESPONSE_UNAVAILABLE':
      return 'Ответ уже не сохранён';
    case 'RETRY_CAP_TOO_SHORT':
      return 'Срок слишком короткий';
    case 'GOAL_NOT_FEASIBLE':
      return 'Цель не подтверждена';
    case 'TIMEOUT':
    case 'UPSTREAM_TIMEOUT':
      return 'Долгая генерация';
    case 'CONNECTION_INTERRUPTED':
      return 'Связь прервана';
    case 'GATEWAY_UNREACHABLE':
      return 'Сервер недоступен';
    default:
      return 'Ошибка OpenAI';
  }
}

function generationErrorTitle(code?: AIPlannerErrorCode): string {
  switch (code) {
    case 'INVALID_RESPONSE':
      return SAVED_RESPONSE_REVIEW_MESSAGE;
    case 'SAVED_RESPONSE_UNAVAILABLE':
      return 'Новый запрос не был отправлен';
    case 'RETRY_CAP_TOO_SHORT':
      return RETRY_CAP_TOO_SHORT_MESSAGE;
    case 'GOAL_NOT_FEASIBLE':
      return GOAL_NOT_FEASIBLE_MESSAGE;
    case 'TIMEOUT':
    case 'UPSTREAM_TIMEOUT':
      return 'План ещё не завершён';
    default:
      return 'Не удалось получить план';
  }
}

function missionCalendarLabel(mission: Mission, index: number) {
  const dayNumber = mission.dayNumber ?? index + 1;
  const dateLabel = formatCalendarDate(mission.scheduledDate, 'long');
  if (!dateLabel) return `День ${dayNumber}`;
  return `День ${dayNumber} · ${dateLabel}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  choiceActive: {
    borderColor: Palette.accent,
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
  },
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
  levelChoiceActive: {
    borderColor: Palette.accent,
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
  },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: Palette.textDim },
  radioActive: { borderWidth: 5, borderColor: Palette.violetSoft },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  generatingCard: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  errorCard: { gap: Spacing.three, borderColor: 'rgba(199, 120, 0, 0.24)' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  readyCard: { gap: Spacing.three },
  readyTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  reviewActions: { gap: Spacing.two },
  planDetailsHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  planMeta: {
    flexDirection: 'row',
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
  },
  meta: { flex: 1, gap: 3 },
  dayList: { gap: Spacing.two },
  dayCard: { gap: 0, padding: Spacing.twoHalf },
  dayHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dayHeaderButton: {
    flex: 1,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
  },
  dayChevron: { color: Palette.textMuted, fontSize: 20 },
  expandedDay: {
    gap: Spacing.two,
    paddingTop: Spacing.twoHalf,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
  },
  actionBlock: {
    gap: Spacing.one,
    padding: Spacing.twoHalf,
    borderRadius: Radius.small,
    backgroundColor: Palette.surfaceSoft,
  },
  actionDose: { color: Palette.cyan },
  criterion: {
    gap: 2,
    paddingTop: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
  },
  dayCriterion: {
    gap: 2,
    padding: Spacing.twoHalf,
    borderRadius: Radius.small,
    backgroundColor: Palette.surfaceSoft,
  },
  sequence: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 122, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 122, 255, 0.2)',
  },
  sequenceText: { color: Palette.goldBright },
  missionCopy: { flex: 1, gap: 2 },
  missionDate: { color: Palette.violetSoft },
});
