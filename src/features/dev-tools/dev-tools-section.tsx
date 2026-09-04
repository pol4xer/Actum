import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AppButton, Card, Pill } from '@/components/ui/primitives';
import { featureFlags } from '@/config/feature-flags';
import { Palette, Spacing } from '@/constants/theme';
import { useApp } from '@/state';

export function DevToolsSection() {
  const { state, currentMission, skipMissionForTesting } = useApp();

  if (!featureFlags.canSkipMissionDays || !state.activePlan) return null;

  const totalDays = state.activePlan.missions.length;
  const currentDay = currentMission?.dayNumber ?? currentMission?.sequence;

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <ThemedText type="eyebrow" style={styles.heading}>
          Тестирование
        </ThemedText>
        <Pill tone="neutral">DEV</Pill>
      </View>

      <Card style={styles.card}>
        {currentMission ? (
          <>
            <ThemedText type="smallBold">
              День {currentDay} из {totalDays}
            </ThemedText>
            <AppButton
              label="Пропустить день"
              variant="secondary"
              onPress={() => skipMissionForTesting(currentMission.id)}
            />
          </>
        ) : (
          <ThemedText type="smallBold">План завершён</ThemedText>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: Spacing.one,
  },
  heading: { color: Palette.textDim },
  card: { gap: Spacing.twoHalf },
});
