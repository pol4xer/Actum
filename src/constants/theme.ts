import { Platform } from 'react-native';

export const Palette = {
  /** iOS grouped background. Historical key retained to keep feature modules decoupled. */
  ink: '#F2F2F7',
  inkRaised: '#F8F8FA',
  surface: 'rgba(255, 255, 255, 0.82)',
  surfaceSoft: 'rgba(246, 247, 250, 0.9)',
  line: 'rgba(60, 60, 67, 0.18)',
  text: '#17171A',
  textMuted: '#636366',
  textDim: '#8E8E93',
  accent: '#007AFF',
  /** Semantic accent aliases retained for backwards compatibility. */
  gold: '#007AFF',
  goldBright: '#0A84FF',
  violet: '#7C7C80',
  violetSoft: '#6E6E73',
  cyan: '#007AFF',
  success: '#248A3D',
  warning: '#C77800',
  danger: '#D70015',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const Colors = {
  light: {
    text: Palette.text,
    background: Palette.ink,
    backgroundElement: Palette.surface,
    backgroundSelected: Palette.surfaceSoft,
    textSecondary: Palette.textMuted,
  },
  dark: {
    text: Palette.text,
    background: Palette.ink,
    backgroundElement: Palette.surface,
    backgroundSelected: Palette.surfaceSoft,
    textSecondary: Palette.textMuted,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  twoHalf: 12,
  three: 16,
  threeHalf: 20,
  four: 24,
  five: 32,
  fiveHalf: 40,
  six: 64,
} as const;

export const Radius = {
  small: 10,
  medium: 16,
  large: 24,
  pill: 999,
} as const;

export const Shadow = Platform.select({
  ios: {
    shadowColor: Palette.black,
    shadowOpacity: 0.07,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  default: {
    boxShadow: '0 8px 24px rgba(20, 20, 25, 0.08)',
  },
});

export const BottomTabInset = Platform.select({ ios: 62, android: 76, web: 84 }) ?? 0;
export const MaxContentWidth = 620;
