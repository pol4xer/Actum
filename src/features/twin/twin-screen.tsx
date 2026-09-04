import { StyleSheet, View } from 'react-native';

import { HeroSigil } from '@/components/hero-sigil';
import { ThemedText } from '@/components/themed-text';
import { InfoPopover } from '@/components/ui/info-popover';
import { Card, Pill, ProgressBar, Screen, ScreenHeader } from '@/components/ui/primitives';
import { Palette, Radius, Spacing } from '@/constants/theme';
import { selectTwinProjection } from '@/domain/reward-policy';
import type { ContextInfoSection } from '@/shared/presentation/context-info';
import { useApp } from '@/state';

export default function TwinScreen() {
  const { state } = useApp();

  if (!state.activeGoal || !state.activePlan) {
    return (
      <Screen>
        <ScreenHeader title="Двойник" />
        <Card>
          <ThemedText type="subtitle">Сначала создай цель</ThemedText>
        </Card>
      </Screen>
    );
  }

  const {
    completed,
    partial,
    reported,
    skipped,
    projectedXp,
    actualXp,
    adherence,
    adherenceBand,
    potentialLevel,
    potentialEnergy,
    potentialLight,
  } = selectTwinProjection(state.activePlan.missions, state.checkIns);
  const adherencePercent = Math.round(adherence * 100);
  const info: ContextInfoSection[] = [
    {
      heading: 'Как считается',
      body: `Сравниваются только уже прошедшие дни текущего плана: ${completed} выполнено, ${partial} частично, ${skipped} пропущено.`,
    },
    {
      heading: 'Что означает',
      body:
        'Линия «По плану» показывает игровые очки при полном выполнении. Это ориентир внутри Actum, а не прогноз реального результата.',
    },
  ];

  return (
    <Screen>
      <ScreenHeader
        title="Двойник"
        action={
          <InfoPopover
            title="О двойнике"
            accessibilityLabel="Как считается двойник"
            sections={info}
          />
        }
      />

      <Card style={styles.scoreCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <ThemedText type="subtitle">{adherencePercent}% плана</ThemedText>
            <ThemedText type="small" style={styles.muted}>
              {reported ? `${completed} из ${reported} дней полностью` : 'Начни первый день'}
            </ThemedText>
          </View>
          <Pill tone={adherenceBand === 'aligned' ? 'success' : 'neutral'}>
            {adherenceBand === 'aligned' ? 'в ритме' : 'есть разрыв'}
          </Pill>
        </View>
        <ProgressBar
          value={adherence}
          color={adherenceBand === 'aligned' ? Palette.success : Palette.accent}
          height={8}
        />
      </Card>

      <Card style={styles.twinsCard}>
        <Twin
          label="Сейчас"
          level={state.character.level}
          archetype={state.profile?.archetype}
          dimmed={state.character.worldLight < 20}
        />
        <ThemedText style={styles.arrow}>→</ThemedText>
        <Twin
          label="По плану"
          level={potentialLevel}
          archetype={state.profile?.archetype}
        />
      </Card>

      <View style={styles.comparisons}>
        <ComparisonRow title="Опыт" actual={`${actualXp} XP`} potential={`${projectedXp} XP`} />
        <ComparisonRow
          title="Энергия"
          actual={`${state.character.energy}%`}
          potential={`${potentialEnergy}%`}
        />
        <ComparisonRow
          title="Свет"
          actual={`${state.character.worldLight}%`}
          potential={`${potentialLight}%`}
        />
      </View>
    </Screen>
  );
}

function Twin({
  label,
  level,
  archetype,
  dimmed = false,
}: {
  label: string;
  level: number;
  archetype: Parameters<typeof HeroSigil>[0]['archetype'];
  dimmed?: boolean;
}) {
  return (
    <View style={styles.twin}>
      <HeroSigil archetype={archetype} level={level} size={76} dimmed={dimmed} />
      <ThemedText type="small" style={styles.muted}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">Ур. {level}</ThemedText>
    </View>
  );
}

function ComparisonRow({
  title,
  actual,
  potential,
}: {
  title: string;
  actual: string;
  potential: string;
}) {
  return (
    <View style={styles.comparison}>
      <ThemedText type="smallBold" style={styles.comparisonTitle}>
        {title}
      </ThemedText>
      <ThemedText type="small" style={styles.muted}>
        {actual}
      </ThemedText>
      <ThemedText style={styles.comparisonArrow}>→</ThemedText>
      <ThemedText type="smallBold" style={styles.accent}>
        {potential}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  muted: { color: Palette.textMuted },
  accent: { color: Palette.accent },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  scoreCard: { gap: Spacing.twoHalf },
  twinsCard: {
    minHeight: 148,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  twin: { flex: 1, alignItems: 'center', gap: Spacing.one },
  arrow: { color: Palette.textDim, fontSize: 24 },
  comparisons: { gap: Spacing.two },
  comparison: {
    minHeight: 58,
    borderRadius: Radius.medium,
    backgroundColor: Palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  comparisonTitle: { flex: 1 },
  comparisonArrow: { color: Palette.textDim },
});
