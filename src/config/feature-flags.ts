export type ActumMode = 'development' | 'production';

/**
 * Resolves the public app mode without trusting arbitrary environment values.
 * Developer controls require both an exact opt-in and a React Native dev bundle.
 */
export function resolveActumMode(
  configuredMode: string | undefined,
  isDevelopmentBundle: boolean,
): ActumMode {
  return isDevelopmentBundle && configuredMode === 'development'
    ? 'development'
    : 'production';
}

const isDevelopmentBundle = typeof __DEV__ !== 'undefined' && __DEV__ === true;

export const actumMode = resolveActumMode(
  process.env.EXPO_PUBLIC_ACTUM_MODE,
  isDevelopmentBundle,
);

export const featureFlags = Object.freeze({
  canSkipMissionDays: actumMode === 'development',
});
