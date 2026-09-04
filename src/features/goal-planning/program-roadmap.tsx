import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { Card, Pill, ProgressBar } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { goalDurationLabel } from '@/domain/goal-program';
import type { GoalProgram } from '@/domain/types';
import { formatMetricValue } from '@/shared/presentation/plan-formatters';

export function ProgramRoadmap({
  program,
  initiallyExpanded = false,
}: {
  program: GoalProgram;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const completed = program.completedCycles.length;
  const completedCycleNumbers = new Set(
    program.completedCycles.map((cycle) => cycle.cycleNumber),
  );

  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? 'Скрыть' : 'Показать'} весь маршрут`}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        <View style={styles.headerCopy}>
          <ThemedText type="smallBold">Весь маршрут</ThemedText>
          <ThemedText type="small" style={styles.muted}>
            {goalDurationLabel(program.duration)} · {program.totalCycles}{' '}
            {program.totalCycles === 1 ? 'цикл' : 'циклов'}
          </ThemedText>
        </View>
        <ThemedText style={styles.chevron}>{expanded ? '⌃' : '⌄'}</ThemedText>
      </Pressable>

      <ProgressBar value={completed / program.totalCycles} color={Palette.accent} />

      {expanded ? (
        <View style={styles.list}>
          {program.roadmap.map((milestone) => {
            const isCompleted = completedCycleNumbers.has(milestone.cycleNumber);
            const isCurrent =
              milestone.cycleNumber === program.activeCycle && !isCompleted;
            const target = formatMetricValue(milestone.targetValue, milestone.targetUnit);
            return (
              <View
                key={milestone.cycleNumber}
                style={[styles.row, isCurrent && styles.currentRow]}>
                <View style={[styles.number, isCurrent && styles.currentNumber]}>
                  <ThemedText type="smallBold" style={isCurrent && styles.currentNumberText}>
                    {isCompleted ? '✓' : milestone.cycleNumber}
                  </ThemedText>
                </View>
                <View style={styles.rowCopy}>
                  <View style={styles.titleRow}>
                    <ThemedText type="smallBold" numberOfLines={2} style={styles.flex}>
                      {milestone.title}
                    </ThemedText>
                    {isCurrent ? <Pill tone="gold">сейчас</Pill> : null}
                  </View>
                  {target ? (
                    <ThemedText type="small" style={styles.target}>
                      Ориентир: {target}
                    </ThemedText>
                  ) : null}
                </View>
                <InfoPopover
                  title={`Цикл ${milestone.cycleNumber}`}
                  accessibilityLabel={`Показать фокус цикла ${milestone.cycleNumber}`}
                  sections={[{ body: milestone.focus }]}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.twoHalf },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerCopy: { flex: 1, gap: 2 },
  muted: { color: Palette.textMuted },
  pressed: { opacity: 0.72 },
  chevron: { color: Palette.textDim, fontSize: 22 },
  list: { gap: Spacing.one },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.medium,
    backgroundColor: Palette.surfaceSoft,
  },
  currentRow: { borderWidth: 1, borderColor: Palette.accent },
  number: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.surface,
  },
  currentNumber: { backgroundColor: Palette.accent },
  currentNumberText: { color: '#FFFFFF' },
  rowCopy: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  target: { color: Palette.accent },
  flex: { flex: 1 },
});
