import Constants from 'expo-constants';

export type AppEnvironment = 'development' | 'production';

const currentEnvironment: AppEnvironment = __DEV__ ? 'development' : 'production';

/**
 * Feature flags are opt-out: enabled unless explicitly set to "false".
 * Undefined / empty must NOT disable features in release builds.
 *
 * Supported disable values: "false", "0" (case-insensitive).
 * Supported enable values: "true", "1", or any other non-disable value.
 */
function isFeatureEnabled(raw: string | undefined): boolean {
  if (raw == null) {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  return normalized !== 'false' && normalized !== '0';
}

const featureFlags = {
  enableBrowser: isFeatureEnabled(process.env.EXPO_PUBLIC_ENABLE_BROWSER),
  enableDownloader: isFeatureEnabled(process.env.EXPO_PUBLIC_ENABLE_DOWNLOADER),
  enablePlayer: isFeatureEnabled(process.env.EXPO_PUBLIC_ENABLE_PLAYER),
} as const;

export const environment = {
  env: currentEnvironment,
  isDevelopment: currentEnvironment === 'development',
  isProduction: currentEnvironment === 'production',
  appName: Constants.expoConfig?.name ?? 'VidoraX',
  version: Constants.expoConfig?.version ?? '1.0.0',
  featureFlags,
} as const;
