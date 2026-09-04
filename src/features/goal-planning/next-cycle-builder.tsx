import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { AppButton, Card, Pill } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import type { GeneratedGoal, Goal, PlanVersion } from '@/domain/types';

import { AIPlannerError } from './errors';
import { defaultGoalPlanner } from './http-goal-planner';
import type { GoalPlanner } from './goal-planner';
import { createNextCycleInput } from './next-cycle-input';

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
  const usesSavedResearch =
    plan.version >= 6 && plan.research.method === 'openai-web-research-v1';
  const hasLegacyResearch =
    plan.version < 6 && plan.research.method === 'openai-web-research-v1';

  const generate = async () => {
    if (loading || baseline.trim().length < 2) return;
    setLoading(true);
    setError('');
    try {
      onAccept(await planner.generateGoal(createNextCycleInput(goal, plan, baseline)));
    } catch (reason) {
      setError(
        reason instanceof AIPlannerError
          ? reason.message
          : 'Не удалось собрать следующий цикл.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card accent style={styles.card}>
      <View style={styles.topRow}>
        <Pill tone="success">цикл завершён</Pill>
        <InfoPopover
          title="Следующий цикл"
          sections={[
            {
              body: usesSavedResearch
                ? 'Actum использует сохранённый web-research и отправит только новый запрос на адаптацию заданий.'
                : hasLegacyResearch
                  ? 'Это старый план. Чтобы не запускать новый web-поиск без подтверждения, Actum отправит только запрос на адаптацию заданий.'
                  : 'Для этой цели web-research ранее не выполнялся. Будет отправлен только запрос на адаптацию заданий.',
            },
          ]}
        />
      </View>
      <ThemedText type="title">Месяц {nextCycle}</ThemedText>
      <ThemedText type="small" style={styles.muted}>
        Проверь текущий результат — от него будут рассчитаны следующие 30 дней.
      </ThemedText>
      <TextInput
        accessibilityLabel="Текущий результат после завершённого цикла"
        maxLength={500}
        onChangeText={setBaseline}
        placeholder="Например: 1 минута 20 секунд"
        placeholderTextColor={Palette.textDim}
        style={styles.input}
        value={baseline}
      />
      {error ? (
        <View style={styles.errorRow}>
          <ThemedText type="small" style={styles.error} numberOfLines={2}>
            План пока не получен
          </ThemedText>
          <InfoPopover title="Ошибка генерации" sections={[{ body: error, tone: 'warning' }]} />
        </View>
      ) : null}
      <AppButton
        label={`Собрать месяц ${nextCycle}`}
        loading={loading}
        disabled={baseline.trim().length < 2}
        onPress={generate}
      />
    </Card>
  );
}

function editableBaseline(value: number, unit: string) {
  const labels: Record<string, string> = {
    seconds: 'секунд',
    reps: 'повторений',
    pages: 'страниц',
    items: 'элементов',
    words: 'слов',
    meters: 'метров',
    attempts: 'попыток',
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
