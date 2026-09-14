/**
 * Local persistence for download settings.
 * Reuses MMKV — does not introduce a new storage technology.
 * Never stores URLs, tokens, or signed secrets.
 */

import { mmkvKeys } from '@/storage/constants';
import {
  getMaxConcurrentDownloads,
  readExplicitAutoResume,
  readExplicitNotifications,
  readExplicitWifiOnly,
  setAutoResume,
  setMaxConcurrentDownloads,
  setNotifications,
  setWifiOnly,
} from '@/storage/mmkv';
import { getMmkvInstance } from '@/storage/mmkv/instance';

import { normalizeDownloadSettings, normalizeMaxConcurrentDownloads } from './normalize';
import {
  DEFAULT_DOWNLOAD_SETTINGS,
  DOWNLOAD_SETTINGS_VERSION,
  type DownloadSettings,
  type DownloadSettingsPersistedEnvelope,
} from './types';

function parseEnvelopeSettings(): Partial<DownloadSettings> | null {
  const mmkv = getMmkvInstance();
  if (!mmkv?.contains(mmkvKeys.downloadSettings)) {
    return null;
  }

  try {
    const raw = mmkv.getString(mmkvKeys.downloadSettings);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.settings && typeof record.settings === 'object') {
      return record.settings as Partial<DownloadSettings>;
    }
    return record as Partial<DownloadSettings>;
  } catch {
    return null;
  }
}

function isAllowedConcurrent(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 4;
}

function readExplicitBooleanFromEnvelope(
  envelope: Partial<DownloadSettings> | null,
  key: 'wifiOnly' | 'autoResume' | 'notificationsEnabled',
): boolean | null {
  if (!envelope) {
    return null;
  }
  const value = envelope[key];
  return typeof value === 'boolean' ? value : null;
}

/**
 * Returns a persisted 1–4 only when disk actually stored the field.
 * `null` means “not persisted” — callers must keep the live store value
 * instead of substituting the product default (2).
 *
 * The versioned envelope is authoritative. A lone individual MMKV number
 * equal to the default is treated as unset so leftover bootstrap writes
 * cannot clobber Zustand persist.
 */
export function readExplicitMaxConcurrentDownloads(): number | null {
  const envelope = parseEnvelopeSettings();
  if (envelope && envelope.maxConcurrentDownloads !== undefined) {
    const fromEnvelope = normalizeMaxConcurrentDownloads(
      envelope.maxConcurrentDownloads,
    );
    if (isAllowedConcurrent(fromEnvelope)) {
      return fromEnvelope;
    }
  }

  const mmkv = getMmkvInstance();
  if (!mmkv?.contains(mmkvKeys.maxConcurrentDownloads)) {
    return null;
  }

  const fromKey = getMaxConcurrentDownloads(Number.NaN);
  let resolved: number | null = isAllowedConcurrent(fromKey) ? fromKey : null;
  if (resolved == null) {
    const asString = mmkv.getString(mmkvKeys.maxConcurrentDownloads);
    if (typeof asString === 'string') {
      const fromString = normalizeMaxConcurrentDownloads(asString);
      resolved = isAllowedConcurrent(fromString) ? fromString : null;
    }
  }

  if (resolved == null || resolved === DEFAULT_DOWNLOAD_SETTINGS.maxConcurrentDownloads) {
    return null;
  }

  return resolved;
}

/**
 * Explicit boolean prefs from disk. `null` = key never written / MMKV unavailable.
 * Never substitutes product defaults — that would wipe a persisted `false`.
 */
export function readExplicitDownloadBooleans(): {
  wifiOnly: boolean | null;
  autoResume: boolean | null;
  notificationsEnabled: boolean | null;
} {
  const envelope = parseEnvelopeSettings();

  return {
    wifiOnly:
      readExplicitWifiOnly() ??
      readExplicitBooleanFromEnvelope(envelope, 'wifiOnly'),
    autoResume:
      readExplicitAutoResume() ??
      readExplicitBooleanFromEnvelope(envelope, 'autoResume'),
    notificationsEnabled:
      readExplicitNotifications() ??
      readExplicitBooleanFromEnvelope(envelope, 'notificationsEnabled'),
  };
}

/**
 * Read persisted preferences and normalize into canonical DownloadSettings.
 * Missing keys fall back to `fallback` (typically the live Zustand store),
 * then product defaults — never invent `true` over a live `false`.
 */
export function readPersistedDownloadSettings(
  fallback?: Partial<DownloadSettings>,
): DownloadSettings {
  const envelopeSettings = parseEnvelopeSettings();
  const explicitMax = readExplicitMaxConcurrentDownloads();
  const explicit = readExplicitDownloadBooleans();

  return normalizeDownloadSettings({
    wifiOnly:
      explicit.wifiOnly ??
      fallback?.wifiOnly ??
      DEFAULT_DOWNLOAD_SETTINGS.wifiOnly,
    autoResume:
      explicit.autoResume ??
      fallback?.autoResume ??
      DEFAULT_DOWNLOAD_SETTINGS.autoResume,
    notificationsEnabled:
      explicit.notificationsEnabled ??
      fallback?.notificationsEnabled ??
      DEFAULT_DOWNLOAD_SETTINGS.notificationsEnabled,
    maxConcurrentDownloads:
      explicitMax ??
      envelopeSettings?.maxConcurrentDownloads ??
      fallback?.maxConcurrentDownloads ??
      DEFAULT_DOWNLOAD_SETTINGS.maxConcurrentDownloads,
  });
}

export function writePersistedDownloadSettings(settings: DownloadSettings): void {
  const normalized = normalizeDownloadSettings(settings);

  setWifiOnly(normalized.wifiOnly);
  setAutoResume(normalized.autoResume);
  setNotifications(normalized.notificationsEnabled);
  setMaxConcurrentDownloads(normalized.maxConcurrentDownloads);

  const envelope: DownloadSettingsPersistedEnvelope = {
    version: DOWNLOAD_SETTINGS_VERSION,
    settings: normalized,
  };

  try {
    getMmkvInstance()?.set(
      mmkvKeys.downloadSettings,
      JSON.stringify(envelope),
    );
  } catch {
    // Non-fatal — individual keys already written.
  }
}

export function writeMaxConcurrentDownloads(value: number): void {
  let fallback: Partial<DownloadSettings> = {};
  try {
    // Lazily avoid circular imports at module eval — persist is lower than policy.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLiveDownloadSettingsFallback } = require('./policy') as {
      getLiveDownloadSettingsFallback: () => Partial<DownloadSettings>;
    };
    fallback = getLiveDownloadSettingsFallback();
  } catch {
    // ignore
  }
  const normalized = normalizeDownloadSettings({
    ...readPersistedDownloadSettings(fallback),
    maxConcurrentDownloads: value,
  });
  writePersistedDownloadSettings(normalized);
}
