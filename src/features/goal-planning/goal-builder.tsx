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
          eyebrow={`New goal · ${stage === 'intent' ? '1' : stage === 'details' ? '2' : '3'} of 3`}
          title={
            stage === 'intent'
              ? 'What would you like to change?'
              : stage === 'details'
                ? 'Set up your plan'
                : stage === 'generating'
                  ? 'Creating your plan'
                  : stage === 'error'
                    ? 'Still waiting for your plan'
                    : showPlanDetails
                      ? 'Your daily plan'
                      : 'Your plan is ready'
          }
          action={stage === 'review' ? undefined : <InfoPopover title="About this step" sections={screenContext} />}
        />

        {stage === 'intent' ? (
          <>
            <TextInput
              accessibilityLabel="Your goal"
              autoFocus
              multiline
              onChangeText={setPrompt}
              placeholder="For example: finish a book, learn to cook five meals, or organize my documents"
              placeholderTextColor={Palette.textDim}
              style={styles.promptInput}
              textAlignVertical="top"
              value={prompt}
            />
            <View style={styles.exampleBlock}>
              <ThemedText type="eyebrow" style={styles.muted}>
                Examples
              </ThemedText>
              <View style={styles.exampleWrap}>
                {['Finish a book', 'Learn basic Spanish', 'Organize documents'].map(
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
                  <ThemedText type="smallBold">Your plan is saved</ThemedText>
                  <InfoPopover
                    title="Why is this free?"
                    sections={[
                      {
                        body: `${savedPreview.goal.title} · ${savedPreview.plan.targetCycleNumber ? `limit ${retryLimitLabel(savedPreview.goal.program.duration)}` : `legacy plan duration ${goalDurationLabel(savedPreview.goal.program.duration)}`}. This plan is saved on your device and opens without another web search or GPT request.`,
                      },
                    ]}
                  />
                </View>
                <AppButton label="Open plan" onPress={openSavedPlan} />
              </Card>
            ) : null}
            <AppButton
              label="Continue"
              disabled={prompt.trim().length < 5}
              onPress={continueFromIntent}
            />
          </>
        ) : null}

        {stage === 'details' ? (
          <>
            <Question
              title="Where are you starting? · required"
              help={[
                {
                  body: 'Include a number and unit if you know them. GPT will keep your original description and identify a measurable baseline.',
                },
              ]}>
              <TextInput
                accessibilityLabel="Current measured baseline"
                maxLength={500}
                multiline
                onChangeText={setBaseline}
                placeholder="For example: I read 8 pages in 20 minutes, or hold a plank for 45 seconds"
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

            <Question title="How many minutes a day?">
              <ChoiceRow>
                {MINUTES.map((value) => (
                  <Choice
                    key={value}
                    label={`${value} min`}
                    selected={dailyMinutes === value}
                    onPress={() => setDailyMinutes(value)}
                  />
                ))}
              </ChoiceRow>
            </Question>

            <Question title="Your experience">
              <View style={styles.levelList}>
                <LevelChoice
                  label="Starting from scratch"
                  selected={currentLevel === 'starting'}
                  onPress={() => setCurrentLevel('starting')}
                />
                <LevelChoice
                  label="Some experience"
                  selected={currentLevel === 'some-experience'}
                  onPress={() => setCurrentLevel('some-experience')}
                />
                <LevelChoice
                  label="Returning after a break"
                  selected={currentLevel === 'returning'}
                  onPress={() => setCurrentLevel('returning')}
                />
              </View>
            </Question>

            <View style={styles.buttonRow}>
              <AppButton label="Back" variant="ghost" onPress={backToIntent} />
              <AppButton
                label="Create plan"
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
              Creating practical steps…
            </ThemedText>
          </Card>
        ) : null}

        {stage === 'error' ? (
          <Card style={styles.errorCard}>
            <View style={styles.cardTop}>
              <Pill tone="warning">{generationErrorBadge(generationErrorCode)}</Pill>
              <InfoPopover title="What happened?" sections={screenContext} />
            </View>
            <ThemedText type="subtitle">{generationErrorTitle(generationErrorCode)}</ThemedText>
            {shouldOfferPlannerRetry(generationErrorCode) ? (
              <AppButton
                label={
                  generationErrorCode === 'INVALID_RESPONSE'
                    ? SAVED_RESPONSE_RETRY_LABEL
                    : 'Retry GPT request'
                }
                onPress={retryGeneration}
              />
            ) : null}
            <AppButton label="Edit settings" variant="ghost" onPress={editDetails} />
          </Card>
        ) : null}

        {stage === 'review' && preview ? (
          showPlanDetails ? (
            <>
              <View style={styles.planDetailsHeader}>
                <ThemedText type="smallBold" style={styles.flex}>
                  {preview.goal.title}
                </ThemedText>
                <InfoPopover title="About this plan" sections={planInfoWithoutSafety(preview)} />
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
                  label="Back"
                  variant="ghost"
                  onPress={() => {
                    setShowPlanDetails(false);
                    setExpandedPreviewMissionId(undefined);
                  }}
                />
                <AppButton label="Start" onPress={acceptPlan} style={styles.flex} />
              </View>
            </>
          ) : (
            <>
              <Card accent style={styles.readyCard}>
                <View style={styles.readyTop}>
                  <ThemedText type="subtitle" numberOfLines={2} style={styles.flex}>
                    {preview.goal.title}
                  </ThemedText>
                  <InfoPopover title="About this plan" sections={planInfoWithoutSafety(preview)} />
                </View>
                <View style={styles.planMeta}>
                  <Meta
                    value={estimatedTargetCycleLabel(preview.plan.targetCycleNumber) ?? '—'}
                    label="target"
                  />
                  <Meta
                    value={retryLimitLabel(preview.goal.program.duration)}
                    label="limit"
                  />
                  <Meta value={`${preview.plan.dailyMinutes} min`} label="per day" />
                </View>
              </Card>

              <View style={styles.reviewActions}>
                <AppButton label="Start" onPress={acceptPlan} />
                <AppButton
                  label="View plan"
                  variant="secondary"
                  onPress={() => setShowPlanDetails(true)}
                />
                <AppButton label="Edit" variant="ghost" onPress={editDetails} />
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
          accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} day ${mission.dayNumber ?? index + 1}: ${mission.title}`}
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
              {formatMissionDuration(mission, { inAppRecordLabel: 'check-ins' })}
            </ThemedText>
          </View>
          <ThemedText style={styles.dayChevron}>{expanded ? '⌃' : '⌄'}</ThemedText>
        </Pressable>
        {expanded ? (
          <InfoPopover
            title={`About day ${mission.dayNumber ?? index + 1}`}
            accessibilityLabel={`Show details for day ${mission.dayNumber ?? index + 1}`}
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
        {day ? 'Day complete' : 'Done when'}
      </ThemedText>
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

function planInfoWithoutSafety(preview: GeneratedGoal): ContextInfoSection[] {
  return planContextSections(preview.plan, {
    baseline: preview.goal.baseline,
    targetTimeline: preview.goal.targetTimeline,
  }).filter((section) => section.heading !== 'Safety' && section.tone !== 'warning');
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
            title={title.replace(' · required', '')}
            accessibilityLabel={`Show explanation: ${title}`}
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
    sections.push({ body: 'Describe one main goal in your own words.' });
  } else if (stage === 'details') {
    sections.push({ body: 'These details help create a specific plan for each day.' });
  } else if (stage === 'generating') {
    sections.push({
      body:
        researchMode === 'web'
          ? 'Web research comes first, followed by plan creation. This may take a few minutes.'
          : 'One GPT request is running without web research.',
    });
  } else if (stage === 'error' && generationError) {
    sections.push({ heading: 'Technical details', body: generationError, tone: 'warning' });
    const retryContext = errorRetryContext(generationErrorCode);
    if (retryContext) sections.push(retryContext);
  } else if (stage === 'review') {
    sections.push({ body: 'Review the daily activities and start when the workload feels right.' });
  }
  return sections;
}

function missionPreviewContextSections(mission: Mission): ContextInfoSection[] {
  const sections = missionContextSections(mission).filter(
    (section) => section.heading !== 'Warning' && section.heading !== 'Daily completion criterion',
  );
  if (mission.execution?.kind !== 'in_app') return sections;

  return [
    ...sections,
    ...actionableExecutionBlocks(mission.execution.blocks).flatMap((block) =>
      executionBlockContextSections(block).map((section) => ({
        ...section,
        heading: `${block.title} · ${section.heading ?? 'calculation'}`,
      })),
    ),
  ];
}

function errorRetryContext(code?: AIPlannerErrorCode): ContextInfoSection | undefined {
  if (isFeasibilityPlannerError(code)) {
    return {
      heading: 'No new planning request',
      body:
        code === 'RETRY_CAP_TOO_SHORT'
          ? 'Research is saved, and plan creation has not started. If you only change the continuation limit, Actum will reuse this research.'
          : 'Research is saved, and plan creation has not started. Change your goal or baseline to request a new calculation.',
    };
  }
  if (code === 'INVALID_RESPONSE') {
    return {
      heading: 'No new paid request',
      body:
        'The OpenAI response is already saved. This button validates that same response again without creating a new OpenAI response.',
    };
  }
  if (code === 'SAVED_RESPONSE_UNAVAILABLE') {
    return {
      heading: 'No new request sent',
      body:
        'The saved response can no longer be recovered for free, so there is no automatic retry. To start a new paid request, return to settings and choose Create plan.',
    };
  }
  if (
    code === 'TIMEOUT' ||
    code === 'UPSTREAM_TIMEOUT' ||
    code === 'CONNECTION_INTERRUPTED' ||
    code === 'GATEWAY_UNREACHABLE'
  ) {
    return {
      heading: 'What retrying does',
      body:
        'The AI gateway reuses saved research, response IDs, and completed paid stages when available. Retrying may start a paid stage if it has not been created yet.',
    };
  }
  if (code) {
    return {
      heading: 'Retry cost',
      body: 'This error does not guarantee a saved response. Retrying may create a new paid OpenAI response.',
      tone: 'warning',
    };
  }
  return undefined;
}

function generationErrorBadge(code?: AIPlannerErrorCode): string {
  switch (code) {
    case 'INVALID_RESPONSE':
      return 'Response could not be read';
    case 'SAVED_RESPONSE_UNAVAILABLE':
      return 'Saved response unavailable';
    case 'RETRY_CAP_TOO_SHORT':
      return 'Time limit too short';
    case 'GOAL_NOT_FEASIBLE':
      return 'Goal not confirmed';
    case 'TIMEOUT':
    case 'UPSTREAM_TIMEOUT':
      return 'Generation taking longer';
    case 'CONNECTION_INTERRUPTED':
      return 'Connection interrupted';
    case 'GATEWAY_UNREACHABLE':
      return 'Server unavailable';
    default:
      return 'OpenAI error';
  }
}

function generationErrorTitle(code?: AIPlannerErrorCode): string {
  switch (code) {
    case 'INVALID_RESPONSE':
      return SAVED_RESPONSE_REVIEW_MESSAGE;
    case 'SAVED_RESPONSE_UNAVAILABLE':
      return 'No new request was sent';
    case 'RETRY_CAP_TOO_SHORT':
      return RETRY_CAP_TOO_SHORT_MESSAGE;
    case 'GOAL_NOT_FEASIBLE':
      return GOAL_NOT_FEASIBLE_MESSAGE;
    case 'TIMEOUT':
    case 'UPSTREAM_TIMEOUT':
      return 'Plan is not finished yet';
    default:
      return 'Could not get a plan';
  }
}

function missionCalendarLabel(mission: Mission, index: number) {
  const dayNumber = mission.dayNumber ?? index + 1;
  const dateLabel = formatCalendarDate(mission.scheduledDate, 'long');
  if (!dateLabel) return `Day ${dayNumber}`;
  return `Day ${dayNumber} · ${dateLabel}`;
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
