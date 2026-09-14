import { mmkvKeys } from '@/storage/constants';

import { getMmkvInstance } from './instance';

export interface AppPreferences {
  wifiOnly: boolean;
  autoResume: boolean;
  notifications: boolean;
  downloadDirectory: string | null;
  maxConcurrentDownloads: number;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  wifiOnly: false,
  autoResume: true,
  notifications: true,
  downloadDirectory: null,
  maxConcurrentDownloads: 2,
};

/**
 * Returns the stored boolean only when the key was explicitly written.
 * `null` means absent / MMKV unavailable — callers must keep the live store
 * value instead of substituting product defaults (which would wipe `false`).
 */
export function readExplicitWifiOnly(): boolean | null {
  const mmkv = getMmkvInstance();
  if (!mmkv?.contains(mmkvKeys.wifiOnly)) {
    return null;
  }
  const value = mmkv.getBoolean(mmkvKeys.wifiOnly);
  return typeof value === 'boolean' ? value : null;
}

export function readExplicitAutoResume(): boolean | null {
  const mmkv = getMmkvInstance();
  if (!mmkv?.contains(mmkvKeys.autoResume)) {
    return null;
  }
  const value = mmkv.getBoolean(mmkvKeys.autoResume);
  return typeof value === 'boolean' ? value : null;
}

export function readExplicitNotifications(): boolean | null {
  const mmkv = getMmkvInstance();
  if (!mmkv?.contains(mmkvKeys.notifications)) {
    return null;
  }
  const value = mmkv.getBoolean(mmkvKeys.notifications);
  return typeof value === 'boolean' ? value : null;
}

export function getWifiOnly(defaultValue = DEFAULT_PREFERENCES.wifiOnly): boolean {
  return readExplicitWifiOnly() ?? defaultValue;
}

export function setWifiOnly(value: boolean): void {
  getMmkvInstance()?.set(mmkvKeys.wifiOnly, value);
}

export function getAutoResume(defaultValue = DEFAULT_PREFERENCES.autoResume): boolean {
  return readExplicitAutoResume() ?? defaultValue;
}

export function setAutoResume(value: boolean): void {
  getMmkvInstance()?.set(mmkvKeys.autoResume, value);
}

export function getNotifications(defaultValue = DEFAULT_PREFERENCES.notifications): boolean {
  return readExplicitNotifications() ?? defaultValue;
}

export function setNotifications(value: boolean): void {
  getMmkvInstance()?.set(mmkvKeys.notifications, value);
}

export function getMaxConcurrentDownloads(
  defaultValue = DEFAULT_PREFERENCES.maxConcurrentDownloads,
): number {
  const mmkv = getMmkvInstance();
  if (!mmkv?.contains(mmkvKeys.maxConcurrentDownloads)) {
    return defaultValue;
  }

  const numeric = mmkv.getNumber(mmkvKeys.maxConcurrentDownloads);
  if (
    typeof numeric === 'number' &&
    Number.isFinite(numeric) &&
    Number.isInteger(numeric) &&
    numeric >= 1 &&
    numeric <= 4
  ) {
    return numeric;
  }

  const asString = mmkv.getString(mmkvKeys.maxConcurrentDownloads);
  if (typeof asString === 'string' && /^\d+$/.test(asString.trim())) {
    const parsed = Number(asString.trim());
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 4) {
      return parsed;
    }
  }

  return defaultValue;
}

export function setMaxConcurrentDownloads(value: number): void {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 4
  ) {
    getMmkvInstance()?.set(
      mmkvKeys.maxConcurrentDownloads,
      DEFAULT_PREFERENCES.maxConcurrentDownloads,
    );
    return;
  }
  getMmkvInstance()?.set(mmkvKeys.maxConcurrentDownloads, value);
}

export function getDownloadDirectory(
  defaultValue: string | null = DEFAULT_PREFERENCES.downloadDirectory,
): string | null {
  const value = getMmkvInstance()?.getString(mmkvKeys.downloadDirectory);

  if (value === undefined) {
    return defaultValue;
  }

  return value.length > 0 ? value : null;
}

export function setDownloadDirectory(value: string | null): void {
  const mmkv = getMmkvInstance();

  if (!mmkv) {
    return;
  }

  if (value === null) {
    mmkv.remove(mmkvKeys.downloadDirectory);
    return;
  }

  mmkv.set(mmkvKeys.downloadDirectory, value);
}

export function getPreferences(): AppPreferences {
  return {
    wifiOnly: getWifiOnly(),
    autoResume: getAutoResume(),
    notifications: getNotifications(),
    downloadDirectory: getDownloadDirectory(),
    maxConcurrentDownloads: getMaxConcurrentDownloads(),
  };
}

export function setPreferences(preferences: Partial<AppPreferences>): void {
  if (preferences.wifiOnly !== undefined) {
    setWifiOnly(preferences.wifiOnly);
  }

  if (preferences.autoResume !== undefined) {
    setAutoResume(preferences.autoResume);
  }

  if (preferences.notifications !== undefined) {
    setNotifications(preferences.notifications);
  }

  if (preferences.downloadDirectory !== undefined) {
    setDownloadDirectory(preferences.downloadDirectory);
  }

  if (preferences.maxConcurrentDownloads !== undefined) {
    setMaxConcurrentDownloads(preferences.maxConcurrentDownloads);
  }
}

export function resetPreferences(): void {
  setPreferences(DEFAULT_PREFERENCES);
}
