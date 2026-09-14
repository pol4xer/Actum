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
        <ScreenHeader title="Twin" />
        <Card>
          <ThemedText type="subtitle">Create a goal first</ThemedText>
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
      heading: 'How it is calculated',
      body: `Only past days in the current plan are compared: ${completed} completed, ${partial} partial, and ${skipped} skipped.`,
    },
    {
      heading: 'What it means',
      body:
        'The “On plan” projection shows the game points you would earn by completing every day. It is a reference within Actum, not a prediction of real-world results.',
    },
  ];

  return (
    <Screen>
      <ScreenHeader
        title="Twin"
        action={
          <InfoPopover
            title="About your twin"
            accessibilityLabel="How the twin is calculated"
            sections={info}
          />
        }
      />

      <Card style={styles.scoreCard}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <ThemedText type="subtitle">{adherencePercent}% adherence</ThemedText>
            <ThemedText type="small" style={styles.muted}>
              {reported ? `${completed} of ${reported} ${reported === 1 ? 'day' : 'days'} completed in full` : 'Start your first day'}
            </ThemedText>
          </View>
          <Pill tone={adherenceBand === 'aligned' ? 'success' : 'neutral'}>
            {adherenceBand === 'aligned' ? 'on track' : 'behind plan'}
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
          label="Now"
          level={state.character.level}
          archetype={state.profile?.archetype}
          dimmed={state.character.worldLight < 20}
        />
        <ThemedText style={styles.arrow}>→</ThemedText>
        <Twin
          label="On plan"
          level={potentialLevel}
          archetype={state.profile?.archetype}
        />
      </Card>

      <View style={styles.comparisons}>
        <ComparisonRow title="Experience" actual={`${actualXp} XP`} potential={`${projectedXp} XP`} />
        <ComparisonRow
          title="Energy"
          actual={`${state.character.energy}%`}
          potential={`${potentialEnergy}%`}
        />
        <ComparisonRow
          title="Light"
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
      <ThemedText type="smallBold">Lv. {level}</ThemedText>
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
