import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { Archetype } from '@/domain/types';
import { Palette, Radius } from '@/constants/theme';
import { ARCHETYPE_PRESENTATION } from '@/shared/presentation/archetypes';

export function HeroSigil({
  archetype = 'pathfinder',
  size = 138,
  level,
  dimmed = false,
}: {
  archetype?: Archetype;
  size?: number;
  level?: number;
  dimmed?: boolean;
}) {
  const hero = ARCHETYPE_PRESENTATION[archetype];

  return (
    <View style={[styles.wrap, { width: size, height: size, opacity: dimmed ? 0.55 : 1 }]}>
      <View style={[styles.auraOuter, { width: size, height: size, borderRadius: size / 2 }]} />
      <View
        style={[
          styles.auraInner,
          { width: size * 0.78, height: size * 0.78, borderRadius: size / 2 },
        ]}
      />
      <LinearGradient
        colors={dimmed ? ['#3A3D49', '#1A1D26'] : [...hero.colors]}
        style={[
          styles.core,
          { width: size * 0.62, height: size * 0.62, borderRadius: size / 2 },
        ]}>
        <ThemedText style={[styles.icon, { fontSize: size * 0.3 }]}>{hero.icon}</ThemedText>
      </LinearGradient>
      {level ? (
        <View style={styles.levelBadge}>
          <ThemedText type="smallBold" style={styles.levelText}>
            {level}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  auraOuter: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: '#C9B67544',
    backgroundColor: '#9D85510A',
  },
  auraInner: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: '#FFFFFF15',
    backgroundColor: '#FFFFFF08',
    transform: [{ rotate: '45deg' }],
  },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF35',
  },
  icon: {
    color: Palette.white,
    fontWeight: 300,
    lineHeight: 50,
  },
  levelBadge: {
    position: 'absolute',
    right: 2,
    bottom: 8,
    minWidth: 30,
    height: 30,
    paddingHorizontal: 7,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.inkRaised,
    borderWidth: 1,
    borderColor: Palette.gold,
  },
  levelText: {
    color: Palette.goldBright,
  },
});
