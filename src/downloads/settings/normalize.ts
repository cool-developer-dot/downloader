/**
 * Pure normalizer for download settings.
 * Never throws on malformed persisted input.
 */

import {
  DEFAULT_DOWNLOAD_SETTINGS,
  MAX_ALLOWED_CONCURRENT_DOWNLOADS,
  MIN_CONCURRENT_DOWNLOADS,
  type DownloadSettings,
} from './types';

function asStrictBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Concurrency normalization:
 * - numeric strings like "4" are accepted when they parse to an integer in range
 * - out-of-range / NaN / null / objects → DEFAULT (2)
 * Never clamps 999→4; invalid → default for predictability.
 */
export function normalizeMaxConcurrentDownloads(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (
      value >= MIN_CONCURRENT_DOWNLOADS &&
      value <= MAX_ALLOWED_CONCURRENT_DOWNLOADS
    ) {
      return value;
    }
    return DEFAULT_DOWNLOAD_SETTINGS.maxConcurrentDownloads;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (
      Number.isInteger(parsed) &&
      parsed >= MIN_CONCURRENT_DOWNLOADS &&
      parsed <= MAX_ALLOWED_CONCURRENT_DOWNLOADS
    ) {
      return parsed;
    }
  }

  return DEFAULT_DOWNLOAD_SETTINGS.maxConcurrentDownloads;
}

export function normalizeDownloadSettings(input: unknown): DownloadSettings {
  const source =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};

  // Support wrapped { version, settings } and flat shapes.
  const nested =
    source.settings && typeof source.settings === 'object'
      ? (source.settings as Record<string, unknown>)
      : source;

  return {
    wifiOnly: asStrictBoolean(nested.wifiOnly, DEFAULT_DOWNLOAD_SETTINGS.wifiOnly),
    autoResume: asStrictBoolean(
      nested.autoResume,
      DEFAULT_DOWNLOAD_SETTINGS.autoResume,
    ),
    maxConcurrentDownloads: normalizeMaxConcurrentDownloads(
      nested.maxConcurrentDownloads,
    ),
    notificationsEnabled: asStrictBoolean(
      nested.notificationsEnabled ?? nested.notifications,
      DEFAULT_DOWNLOAD_SETTINGS.notificationsEnabled,
    ),
  };
}
