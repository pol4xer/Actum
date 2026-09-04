import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { Card, Pill, ProgressBar } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { goalDurationLabel } from '@/domain/goal-program';
import type { GoalProgram } from '@/domain/types';

import { estimatedTargetCycleLabel, retryLimitLabel } from './program-labels';
import {
  createProgramRoadmapPresentation,
  roadmapMilestoneMetricLabel,
  type ProgramRoadmapMilestone,
} from './program-roadmap-model';

export function ProgramRoadmap({
  program,
  targetCycleNumber,
  initiallyExpanded = false,
}: {
  program: GoalProgram;
  targetCycleNumber?: number;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [reserveExpanded, setReserveExpanded] = useState(false);
  const targetCycleLabel = estimatedTargetCycleLabel(targetCycleNumber);
  const achievementCycleLabel = estimatedTargetCycleLabel(
    program.achievement?.cycleNumber,
  );
  const presentation = createProgramRoadmapPresentation(program, targetCycleNumber);

  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? 'Скрыть' : 'Показать'} ${targetCycleLabel ? 'план по месяцам' : 'весь маршрут'}`}
        onPress={() => {
          setExpanded((value) => !value);
          if (expanded) setReserveExpanded(false);
        }}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        <View style={styles.headerCopy}>
          <ThemedText type="smallBold">
            {targetCycleLabel ? 'План по месяцам' : 'Весь маршрут'}
          </ThemedText>
          <ThemedText type="small" style={styles.muted}>
            {achievementCycleLabel
              ? `Цель достигнута: ${achievementCycleLabel.toLocaleLowerCase('ru-RU')}`
              : targetCycleLabel
              ? `Ориентир: ${targetCycleLabel.toLocaleLowerCase('ru-RU')} · лимит ${retryLimitLabel(program.duration)}`
              : `${goalDurationLabel(program.duration)} · ${program.totalCycles} ${program.totalCycles === 1 ? 'цикл' : 'циклов'}`}
          </ThemedText>
        </View>
        <ThemedText style={styles.chevron}>{expanded ? '⌃' : '⌄'}</ThemedText>
      </Pressable>

      <ProgressBar value={presentation.progress} color={Palette.accent} />

      {expanded ? (
        <View style={styles.expandedContent}>
          <View style={styles.list}>
            {presentation.primaryMilestones.map((item) => (
              <MilestoneRow
                key={item.milestone.cycleNumber}
                item={item}
                current={item.milestone.cycleNumber === program.activeCycle}
                target={
                  !program.achievement &&
                  item.milestone.cycleNumber === targetCycleNumber
                }
              />
            ))}
          </View>

          {presentation.reserveMilestones.length ? (
            <View style={styles.reserveSection}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: reserveExpanded }}
                accessibilityLabel={`${reserveExpanded ? 'Скрыть' : 'Показать'} резервные месяцы`}
                onPress={() => setReserveExpanded((value) => !value)}
                style={({ pressed }) => [styles.reserveToggle, pressed && styles.pressed]}>
                <ThemedText type="smallBold">Резерв, если цель не достигнута</ThemedText>
                <ThemedText type="small" style={styles.muted}>
                  {presentation.reserveMilestones.length} мес. {reserveExpanded ? '⌃' : '⌄'}
                </ThemedText>
              </Pressable>
              {reserveExpanded ? (
                <View style={styles.list}>
                  {presentation.reserveMilestones.map((item) => (
                    <MilestoneRow
                      key={item.milestone.cycleNumber}
                      item={item}
                      current={false}
                      target={false}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function MilestoneRow({
  item,
  current,
  target,
}: {
  item: ProgramRoadmapMilestone;
  current: boolean;
  target: boolean;
}) {
  const { milestone, result } = item;
  const completed = Boolean(result);
  const achieved = Boolean(item.achievement);
  const isCurrent = current && !completed && !achieved;
  const metricLabel = roadmapMilestoneMetricLabel(item);
  return (
    <View style={[styles.row, isCurrent && styles.currentRow]}>
      <View style={[styles.number, isCurrent && styles.currentNumber]}>
        <ThemedText type="smallBold" style={isCurrent && styles.currentNumberText}>
          {milestone.cycleNumber}
        </ThemedText>
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.titleRow}>
          <ThemedText type="smallBold" numberOfLines={2} style={styles.flex}>
            {milestone.title}
          </ThemedText>
          {isCurrent ? <Pill tone="gold">сейчас</Pill> : null}
          {achieved ? <Pill tone="success">цель достигнута</Pill> : null}
          {completed && !achieved ? <Pill>месяц пройден</Pill> : null}
          {target ? <Pill>ориентир</Pill> : null}
        </View>
        {metricLabel ? (
          <ThemedText type="small" style={styles.metric}>
            {metricLabel}
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
  expandedContent: { gap: Spacing.two },
  list: { gap: Spacing.one },
  reserveSection: {
    gap: Spacing.one,
    paddingTop: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.line,
  },
  reserveToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  metric: { color: Palette.textMuted },
  flex: { flex: 1 },
});
