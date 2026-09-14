import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Centralized VidoraX product identity, store URLs, and runtime metadata.
 * Version/build resolve from Expo/native config — never hardcode release numbers in UI.
 *
 * Expected display behavior:
 * - Standalone / release APK: version from expo.version; Android build from
 *   nativeBuildVersion or android.versionCode (app.json versionCode).
 * - Expo Go: host app may supply its own nativeBuildVersion — do not treat that
 *   as the final Play Store versionCode for release certification.
 * - If native/build metadata is absent, build falls back to "—".
 */

const APP_NAME_FALLBACK = 'VidoraX';
const VERSION_FALLBACK = '—';
const BUILD_FALLBACK = '—';

/**
 * Official Play Store listing URL.
 * Keep null until the listing is published — Rate / store-based update actions
 * stay disabled while unset. Do not point at unrelated listings.
 */
const PLAY_STORE_LISTING_URL: string | null = null;

const WEBSITE_ORIGIN = 'https://vidorax.app';

export type AppIdentityMetadata = {
  appName: string;
  version: string;
  build: string;
  platformLabel: string;
  androidPackage: string | null;
  copyrightYear: number;
};

export type AppStoreConfig = {
  /** Null until a real Play Store listing URL is configured. */
  playStoreListingUrl: string | null;
  websiteOrigin: string;
  privacyUrl: string;
  termsUrl: string;
  androidPackage: string | null;
};

let cachedMetadata: AppIdentityMetadata | null = null;

function readNonEmpty(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function resolvePlatformLabel(): string {
  switch (Platform.OS) {
    case 'ios':
      return 'iOS';
    case 'android':
      return 'Android';
    case 'web':
      return 'Web';
    default:
      return Platform.OS;
  }
}

function resolveBuildVersion(): string {
  // Prefer native binary metadata when present (Record on Constants in current SDK).
  const nativeBuild = readNonEmpty(
    (Constants as { nativeBuildVersion?: string | null }).nativeBuildVersion,
  );
  if (nativeBuild) {
    return nativeBuild;
  }

  const iosBuild = readNonEmpty(Constants.expoConfig?.ios?.buildNumber);
  if (iosBuild) {
    return iosBuild;
  }

  const androidCode = Constants.expoConfig?.android?.versionCode;
  if (typeof androidCode === 'number' && Number.isFinite(androidCode)) {
    return String(androidCode);
  }

  const platformAndroidCode = Constants.platform?.android?.versionCode;
  if (
    typeof platformAndroidCode === 'number' &&
    Number.isFinite(platformAndroidCode)
  ) {
    return String(platformAndroidCode);
  }

  return BUILD_FALLBACK;
}

function resolveVersion(): string {
  const fromConfig = readNonEmpty(Constants.expoConfig?.version);
  if (fromConfig) {
    return fromConfig;
  }

  const nativeVersion = readNonEmpty(
    (Constants as { nativeAppVersion?: string | null }).nativeAppVersion,
  );
  if (nativeVersion) {
    return nativeVersion;
  }

  return VERSION_FALLBACK;
}

function resolveAndroidPackage(): string | null {
  return readNonEmpty(Constants.expoConfig?.android?.package);
}

/**
 * Resolves app metadata once per JS runtime. Safe to call from multiple screens.
 */
export function getAppIdentityMetadata(): AppIdentityMetadata {
  if (cachedMetadata) {
    return cachedMetadata;
  }

  cachedMetadata = {
    appName: readNonEmpty(Constants.expoConfig?.name) ?? APP_NAME_FALLBACK,
    version: resolveVersion(),
    build: resolveBuildVersion(),
    platformLabel: resolvePlatformLabel(),
    androidPackage: resolveAndroidPackage(),
    copyrightYear: new Date().getFullYear(),
  };

  return cachedMetadata;
}

export const appStoreConfig: AppStoreConfig = {
  playStoreListingUrl: PLAY_STORE_LISTING_URL,
  websiteOrigin: WEBSITE_ORIGIN,
  privacyUrl: `${WEBSITE_ORIGIN}/privacy`,
  termsUrl: `${WEBSITE_ORIGIN}/terms`,
  androidPackage: resolveAndroidPackage(),
};

/**
 * True when a real Play Store listing URL is configured for Rate / store update flows.
 */
export function isPlayStoreListingConfigured(): boolean {
  const url = appStoreConfig.playStoreListingUrl;
  return typeof url === 'string' && url.trim().length > 0;
}

/**
 * True when any real update-check path exists (store listing today; Expo Updates later).
 * Phase 3A: store listing only — no invented version API.
 */
export function isUpdateCheckAvailable(): boolean {
  return isPlayStoreListingConfigured();
}

/** @internal test helper — do not use in production UI. */
export function __resetAppIdentityMetadataCacheForTests(): void {
  cachedMetadata = null;
}
