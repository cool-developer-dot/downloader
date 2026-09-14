/**
 * Canonical download preference model for engine + Settings UI.
 * One model — no parallel DownloadSettingsStore2.
 */

export type DownloadSettings = {
  wifiOnly: boolean;
  autoResume: boolean;
  maxConcurrentDownloads: number;
  notificationsEnabled: boolean;
};

export const MIN_CONCURRENT_DOWNLOADS = 1;
export const MAX_ALLOWED_CONCURRENT_DOWNLOADS = 4;

/**
 * Product-safe defaults.
 *
 * wifiOnly defaults OFF for fresh installs — users opt in to Wi-Fi-only.
 * autoResume / notificationsEnabled preserve Week 6 product defaults (true).
 *
 * maxConcurrentDownloads = 2 matches the existing engine constant.
 *
 * autoResume=true means: recovery/scheduler MAY resume when evidence is safe —
 * never a blind restart of every unfinished job.
 *
 * notificationsEnabled=true is preference-only until Day 2 runtime.
 */
export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  wifiOnly: false,
  autoResume: true,
  maxConcurrentDownloads: 2,
  notificationsEnabled: true,
};

export const DOWNLOAD_SETTINGS_VERSION = 1;

export type DownloadSettingsPersistedEnvelope = {
  version: number;
  settings: DownloadSettings;
};

export const CONCURRENT_DOWNLOAD_OPTIONS = [1, 2, 3, 4] as const;
export type ConcurrentDownloadOption = (typeof CONCURRENT_DOWNLOAD_OPTIONS)[number];
