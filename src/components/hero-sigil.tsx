import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/primitives';
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
      <GlassSurface
        fallbackStyle={styles.coreFallback}
        tintColor="rgba(255, 255, 255, 0.72)"
        style={[
          styles.core,
          { width: size * 0.62, height: size * 0.62, borderRadius: size / 2 },
        ]}>
        <ThemedText style={[styles.icon, { fontSize: size * 0.3 }]}>{hero.icon}</ThemedText>
      </GlassSurface>
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 122, 255, 0.16)',
    backgroundColor: 'rgba(0, 122, 255, 0.035)',
  },
  auraInner: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60, 60, 67, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
    transform: [{ rotate: '45deg' }],
  },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  coreFallback: { backgroundColor: 'rgba(255, 255, 255, 0.78)' },
  icon: {
    color: Palette.accent,
    fontWeight: '500',
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
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 122, 255, 0.28)',
  },
  levelText: {
    color: Palette.goldBright,
  },
});
