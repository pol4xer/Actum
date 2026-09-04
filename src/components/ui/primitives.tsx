import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Palette, Radius, Shadow, Spacing } from '@/constants/theme';
import { impact, ImpactFeedbackStyle } from '@/lib/haptics';

const supportsNativeGlass = (() => {
  if (Platform.OS !== 'ios') return false;

  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    // An older development build may not contain the native module yet.
    return false;
  }
})();

export function GlassSurface({
  children,
  style,
  fallbackStyle,
  tintColor = 'rgba(255, 255, 255, 0.2)',
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  fallbackStyle?: StyleProp<ViewStyle>;
  tintColor?: string;
}>) {
  if (supportsNativeGlass) {
    return (
      <GlassView
        colorScheme="light"
        glassEffectStyle="regular"
        tintColor={tintColor}
        style={style}>
        {children}
      </GlassView>
    );
  }

  return <View style={[style, fallbackStyle]}>{children}</View>;
}

export function Screen({
  children,
  scroll = true,
  style,
  contentStyle,
}: PropsWithChildren<{
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}>) {
  const insets = useSafeAreaInsets();
  const body = (
    <View
      style={[
        styles.screenContent,
        { paddingTop: insets.top + Spacing.three, paddingBottom: BottomTabInset + Spacing.four },
        contentStyle,
      ]}>
      {children}
    </View>
  );

  return (
    <View style={[styles.screen, style]}>
      {scroll ? (
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContainer}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {eyebrow ? (
          <ThemedText type="eyebrow" style={styles.goldText}>
            {eyebrow}
          </ThemedText>
        ) : null}
        <ThemedText type="title">{title}</ThemedText>
        {subtitle ? (
          <ThemedText style={styles.mutedText}>{subtitle}</ThemedText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function Card({
  children,
  style,
  accent = false,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle>; accent?: boolean }>) {
  const content = (
    <>
      {accent ? <View style={styles.accentLine} /> : null}
      {children}
    </>
  );

  return (
    <GlassSurface
      fallbackStyle={styles.cardFallback}
      style={[styles.card, accent && styles.cardAccent, style]}>
      {content}
    </GlassSurface>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  style,
}: PropsWithChildren<{
  tone?: 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'violet';
  style?: StyleProp<ViewStyle>;
}>) {
  const tones = {
    neutral: styles.pillNeutral,
    gold: styles.pillGold,
    success: styles.pillSuccess,
    warning: styles.pillWarning,
    danger: styles.pillDanger,
    violet: styles.pillViolet,
  };
  const textTones = {
    neutral: Palette.textMuted,
    gold: Palette.goldBright,
    success: Palette.success,
    warning: Palette.warning,
    danger: Palette.danger,
    violet: Palette.violetSoft,
  };

  return (
    <View style={[styles.pill, tones[tone], style]}>
      <ThemedText type="eyebrow" style={{ color: textTones[tone], letterSpacing: 0.8 }}>
        {children}
      </ThemedText>
    </View>
  );
}

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  style,
}: {
  label: string;
  onPress(): void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const handlePress = async () => {
    if (disabled || loading) return;
    await impact(variant === 'primary' ? ImpactFeedbackStyle.Medium : ImpactFeedbackStyle.Light);
    await onPress();
  };

  const content = (
    <View style={styles.buttonContent}>
      {loading ? <ActivityIndicator color={variant === 'primary' ? Palette.ink : Palette.text} /> : null}
      {!loading && icon ? <ThemedText style={styles.buttonIcon}>{icon}</ThemedText> : null}
      <ThemedText
        type="smallBold"
        style={[
          styles.buttonText,
          variant === 'primary' && styles.buttonTextPrimary,
          variant === 'danger' && styles.buttonTextDanger,
        ]}>
        {label}
      </ThemedText>
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        variant === 'danger' && styles.buttonDanger,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style,
      ]}>
      {content}
    </Pressable>
  );
}

export function ProgressBar({
  value,
  color = Palette.gold,
  trackColor = Palette.line,
  height = 7,
}: {
  value: number;
  color?: string;
  trackColor?: string;
  height?: number;
}) {
  const normalized = Math.max(0, Math.min(1, value));
  return (
    <View style={[styles.progressTrack, { backgroundColor: trackColor, height }]}>
      <View style={[styles.progressFill, { backgroundColor: color, width: `${normalized * 100}%` }]} />
    </View>
  );
}

export function Stat({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string | number;
  valueStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={styles.stat}>
      <ThemedText type="eyebrow" style={styles.statLabel}>
        {label}
      </ThemedText>
      <ThemedText type="subtitle" style={valueStyle}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Palette.ink,
    overflow: 'hidden',
  },
  scrollContainer: {
    flexGrow: 1,
    alignItems: 'center',
  },
  screenContent: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
    marginBottom: Spacing.one,
  },
  headerCopy: {
    flex: 1,
    gap: Spacing.two,
  },
  mutedText: {
    color: Palette.textMuted,
  },
  goldText: {
    color: Palette.gold,
  },
  card: {
    position: 'relative',
    overflow: 'hidden',
    borderColor: Palette.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.large,
    padding: Spacing.three,
    gap: Spacing.three,
    ...Shadow,
  },
  cardFallback: {
    backgroundColor: Palette.surface,
  },
  cardAccent: {
    borderColor: 'rgba(0, 122, 255, 0.28)',
  },
  accentLine: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Palette.gold,
    opacity: 0.5,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.twoHalf,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillNeutral: { backgroundColor: 'rgba(118, 118, 128, 0.1)', borderColor: Palette.line },
  pillGold: { backgroundColor: 'rgba(0, 122, 255, 0.1)', borderColor: 'rgba(0, 122, 255, 0.2)' },
  pillSuccess: { backgroundColor: 'rgba(52, 199, 89, 0.1)', borderColor: 'rgba(36, 138, 61, 0.22)' },
  pillWarning: { backgroundColor: 'rgba(255, 149, 0, 0.1)', borderColor: 'rgba(199, 120, 0, 0.22)' },
  pillDanger: { backgroundColor: 'rgba(255, 59, 48, 0.1)', borderColor: 'rgba(215, 0, 21, 0.2)' },
  pillViolet: { backgroundColor: 'rgba(118, 118, 128, 0.1)', borderColor: Palette.line },
  button: {
    minHeight: 54,
    borderRadius: Radius.medium,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    backgroundColor: Palette.gold,
  },
  buttonSecondary: {
    backgroundColor: Palette.surfaceSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.line,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonDanger: {
    backgroundColor: 'rgba(255, 59, 48, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(215, 0, 21, 0.24)',
  },
  buttonContent: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  buttonText: { color: Palette.text },
  buttonTextPrimary: { color: Palette.white },
  buttonTextDanger: { color: Palette.danger },
  buttonIcon: { fontSize: 18 },
  buttonDisabled: { opacity: 0.42 },
  buttonPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  progressTrack: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: Radius.pill,
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  stat: {
    flex: 1,
    gap: Spacing.one,
  },
  statLabel: {
    color: Palette.textDim,
    letterSpacing: 1,
  },
});
