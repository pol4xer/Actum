import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
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
      <View pointerEvents="none" style={[styles.glow, styles.glowOne]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowTwo]} />
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
  return (
    <View style={[styles.card, accent && styles.cardAccent, style]}>
      {accent ? <View style={styles.accentLine} /> : null}
      {children}
    </View>
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
    await Haptics.impactAsync(
      variant === 'primary' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    ).catch(() => undefined);
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
      {variant === 'primary' ? (
        <LinearGradient colors={[Palette.goldBright, Palette.gold]} style={styles.buttonGradient}>
          {content}
        </LinearGradient>
      ) : (
        content
      )}
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
  glow: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.09,
  },
  glowOne: {
    width: 380,
    height: 380,
    backgroundColor: Palette.violet,
    top: -190,
    right: -170,
  },
  glowTwo: {
    width: 300,
    height: 300,
    backgroundColor: Palette.gold,
    bottom: -220,
    left: -150,
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
    backgroundColor: Palette.surface,
    borderColor: Palette.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.large,
    padding: Spacing.three,
    gap: Spacing.three,
    ...Shadow,
  },
  cardAccent: {
    borderColor: '#52462F',
  },
  accentLine: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 2,
    backgroundColor: Palette.gold,
    opacity: 0.75,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.twoHalf,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillNeutral: { backgroundColor: '#1C2335', borderColor: Palette.line },
  pillGold: { backgroundColor: '#2B2418', borderColor: '#5C4929' },
  pillSuccess: { backgroundColor: '#142A24', borderColor: '#295543' },
  pillWarning: { backgroundColor: '#2D2319', borderColor: '#59402B' },
  pillDanger: { backgroundColor: '#301C24', borderColor: '#633342' },
  pillViolet: { backgroundColor: '#201D38', borderColor: '#453D76' },
  button: {
    minHeight: 54,
    borderRadius: Radius.medium,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  buttonGradient: {
    minHeight: 54,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  buttonSecondary: {
    paddingHorizontal: Spacing.three,
    backgroundColor: Palette.surfaceSoft,
    borderWidth: 1,
    borderColor: Palette.line,
  },
  buttonGhost: {
    paddingHorizontal: Spacing.three,
    backgroundColor: 'transparent',
  },
  buttonDanger: {
    paddingHorizontal: Spacing.three,
    backgroundColor: '#2D1820',
    borderWidth: 1,
    borderColor: '#5E2B39',
  },
  buttonContent: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  buttonText: { color: Palette.text },
  buttonTextPrimary: { color: '#1D1609' },
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
