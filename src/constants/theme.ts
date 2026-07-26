import { Platform } from 'react-native';

export const Palette = {
  ink: '#090B14',
  inkRaised: '#101421',
  surface: '#151A2A',
  surfaceSoft: '#1B2133',
  line: '#29314A',
  text: '#F7F4EA',
  textMuted: '#9AA4BC',
  textDim: '#68728A',
  gold: '#E6B85C',
  goldBright: '#FFD884',
  violet: '#8E7CFF',
  violetSoft: '#A89BFF',
  cyan: '#68D8D6',
  success: '#72D6A1',
  warning: '#F0B66A',
  danger: '#ED7C8B',
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
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  default: {
    boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
  },
});

export const BottomTabInset = Platform.select({ ios: 62, android: 76, web: 84 }) ?? 0;
export const MaxContentWidth = 620;
