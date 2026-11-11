/**
 * Settings Backup (#471): the app's settings (`SettingsState`) as a versioned JSON file, and back. Pure.
 *
 * - Only `SettingsState` is exported: App Lock (its own secure store), theme, downloads, the library, history,
 *   bookmarks and favorites are never part of it.
 * - Device-specific or security-sensitive keys are left out (`EXCLUDED_KEYS`).
 * - Import keeps only keys this version knows, of the right type; out-of-range numbers are clamped and long strings
 *   cut. The store's own validation then runs on top (the caller applies the values through it).
 */

export const SETTINGS_BACKUP_FORMAT = 'vidorax.settings';
export const SETTINGS_BACKUP_VERSION = 1;

/** Never exported or imported: a file path is only meaningful on the device it came from. */
export const EXCLUDED_KEYS: readonly string[] = ['downloadDirectory'];

/** Inclusive ranges numbers are clamped to. */
export const NUMBER_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  maxConcurrentDownloads: [1, 4],
};

const MAX_STRING_CHARS = 500;

type Primitive = string | number | boolean;

function isPrimitive(value: unknown): value is Primitive {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** The keys a backup carries: every setting with a primitive default, minus the excluded ones. */
export function backupKeys(defaults: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(defaults).filter((key) => !EXCLUDED_KEYS.includes(key) && isPrimitive(defaults[key]));
}

/** Pure: the backup file's text. */
export function settingsBackupJson(
  state: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  exportedAt: Date,
): string {
  const settings: Record<string, Primitive> = {};
  for (const key of backupKeys(defaults)) {
    const value = state[key];
    if (isPrimitive(value) && typeof value === typeof defaults[key]) {
      settings[key] = value;
    }
  }
  return JSON.stringify(
    { format: SETTINGS_BACKUP_FORMAT, version: SETTINGS_BACKUP_VERSION, exportedAt: exportedAt.toISOString(), settings },
    null,
    2,
  );
}

export type SettingsBackupParse =
  | { ok: true; values: Record<string, Primitive>; ignored: string[] }
  | { ok: false; reason: 'not-json' | 'wrong-format' | 'unsupported-version' };

/** Pure: the values a backup may set, validated against `defaults`; everything else is listed as ignored. */
export function parseSettingsBackup(text: string, defaults: Readonly<Record<string, unknown>>): SettingsBackupParse {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'wrong-format' };
  }
  const record = data as Record<string, unknown>;
  const settings = record.settings;
  if (record.format !== SETTINGS_BACKUP_FORMAT || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, reason: 'wrong-format' };
  }
  if (
    typeof record.version !== 'number' ||
    !Number.isInteger(record.version) ||
    record.version < 1 ||
    record.version > SETTINGS_BACKUP_VERSION
  ) {
    return { ok: false, reason: 'unsupported-version' };
  }
  const allowed = new Set(backupKeys(defaults));
  const values: Record<string, Primitive> = {};
  const ignored: string[] = [];
  for (const [key, raw] of Object.entries(settings as Record<string, unknown>)) {
    if (!allowed.has(key) || !isPrimitive(raw) || typeof raw !== typeof defaults[key]) {
      ignored.push(key);
      continue;
    }
    if (typeof raw === 'number') {
      const range = NUMBER_RANGES[key];
      const whole = Math.round(raw);
      values[key] = range ? Math.min(range[1], Math.max(range[0], whole)) : whole;
    } else if (typeof raw === 'string') {
      values[key] = raw.slice(0, MAX_STRING_CHARS);
    } else {
      values[key] = raw;
    }
  }
  return { ok: true, values, ignored };
}
