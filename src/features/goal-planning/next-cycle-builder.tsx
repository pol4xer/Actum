import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { AppButton, Card, Pill } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import type { GeneratedGoal, Goal, PlanVersion } from '@/domain/types';

import {
  AIPlannerError,
  RESEARCH_CACHE_UNAVAILABLE_MESSAGE,
  shouldOfferPlannerRetry,
  type AIPlannerErrorCode,
} from './errors';
import { defaultGoalPlanner } from './http-goal-planner';
import type { GoalPlanner } from './goal-planner';
import { createNextCycleInput, reusableResearchAnchor } from './next-cycle-input';

export function NextCycleBuilder({
  goal,
  plan,
  onAccept,
  planner = defaultGoalPlanner,
}: {
  goal: Goal;
  plan: PlanVersion;
  onAccept(generated: GeneratedGoal): void;
  planner?: GoalPlanner;
}) {
  const program = goal.program;
  const nextCycle = program.activeCycle + 1;
  const latestMeasured = [...program.completedCycles]
    .reverse()
    .find((cycle) => cycle.measuredValue != null && cycle.unit);
  const suggestedBaseline = useMemo(
    () =>
      latestMeasured?.measuredValue != null && latestMeasured.unit
        ? editableBaseline(latestMeasured.measuredValue, latestMeasured.unit)
        : plan.baseline?.userStatement ?? goal.baseline?.userStatement ?? '',
    [goal.baseline?.userStatement, latestMeasured, plan.baseline?.userStatement],
  );
  const [baseline, setBaseline] = useState(suggestedBaseline);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<AIPlannerErrorCode>();
  const usesSavedResearch = Boolean(reusableResearchAnchor(plan));
  const hasUnlinkableResearch =
    plan.research.method === 'openai-web-research-v1' && !usesSavedResearch;

  const generate = async () => {
    if (loading || baseline.trim().length < 2) return;
    setLoading(true);
    setError('');
    setErrorCode(undefined);
    try {
      onAccept(await planner.generateGoal(createNextCycleInput(goal, plan, baseline)));
    } catch (reason) {
      const plannerError = reason instanceof AIPlannerError ? reason : undefined;
      setErrorCode(plannerError?.code);
      setError(
        plannerError
          ? plannerError.message
          : 'Could not create the next cycle.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card accent style={styles.card}>
      <View style={styles.topRow}>
        <Pill tone="success">cycle complete</Pill>
        <InfoPopover
          title="Next cycle"
          sections={[
            {
              body: usesSavedResearch
                ? 'Actum will use the saved web research and send one new request to adapt your activities.'
                : hasUnlinkableResearch
                  ? 'The saved web research cannot be linked to this cycle. Actum will send only an adaptation request, without starting a new search.'
                  : 'No web research has been done for this goal. Only an adaptation request will be sent.',
            },
          ]}
        />
      </View>
      <ThemedText type="title">Month {nextCycle}</ThemedText>
      <ThemedText type="small" style={styles.muted}>
        Check your current result to set the starting point for the next 30 days.
      </ThemedText>
      <TextInput
        accessibilityLabel="Current result after the completed cycle"
        maxLength={500}
        onChangeText={setBaseline}
        placeholder="For example: 1 minute 20 seconds"
        placeholderTextColor={Palette.textDim}
        style={styles.input}
        value={baseline}
      />
      {error ? (
        <View style={styles.errorRow}>
          <ThemedText type="small" style={styles.error} numberOfLines={2}>
            {errorCode === 'RESEARCH_CACHE_UNAVAILABLE'
              ? RESEARCH_CACHE_UNAVAILABLE_MESSAGE
              : 'Plan not received yet'}
          </ThemedText>
          <InfoPopover
            title="Generation error"
            sections={[
              { body: error, tone: 'warning' },
              ...(errorCode === 'RESEARCH_CACHE_UNAVAILABLE'
                ? [{ body: 'To start new research, choose Settings → New goal.' }]
                : []),
            ]}
          />
        </View>
      ) : null}
      {shouldOfferPlannerRetry(errorCode) ? (
        <AppButton
          label={`Create month ${nextCycle}`}
          loading={loading}
          disabled={baseline.trim().length < 2}
          onPress={generate}
        />
      ) : null}
    </Card>
  );
}

function editableBaseline(value: number, unit: string) {
  const labels: Record<string, string> = {
    seconds: 'seconds',
    reps: 'reps',
    pages: 'pages',
    items: 'items',
    words: 'words',
    meters: 'meters',
    attempts: 'attempts',
  };
  return `${value} ${labels[unit] ?? unit}`;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.twoHalf },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  muted: { color: Palette.textMuted },
  input: {
    minHeight: 54,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Palette.line,
    backgroundColor: Palette.surface,
    paddingHorizontal: Spacing.three,
    color: Palette.text,
    fontSize: 16,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  error: { color: Palette.danger, flex: 1 },
});
