/**
 * B20 — the saved copy of a profile's browser settings (see profile-settings.ts). Pure: it uses Settings Backup's
 * format and is read back through its validation, so a damaged or older copy can never put a wrong type or an
 * unknown choice into the settings store.
 */
import { BROWSER_SETTING_KEYS } from '@/browser/settings/browser-setting-keys';
import { parseSettingsBackup, settingsBackupJson } from '@/store/settings/backup';

type Values = Record<string, unknown>;

/** The browser settings' defaults (taken from all the settings' defaults): what a saved copy is checked against. */
export function pickBrowserSettingDefaults(allDefaults: Values): Values {
  const picked: Values = {};
  for (const key of BROWSER_SETTING_KEYS) {
    picked[key] = allDefaults[key];
  }
  return picked;
}

/** The saved text for these settings. */
export function profileSettingsText(state: Values, now: Date, defaults: Values): string {
  return settingsBackupJson(state, defaults, now);
}

/**
 * The values to put in the store for a profile — its saved ones where valid, the default for every other browser
 * setting (so nothing of the previous profile stays behind).
 */
export function profileSettingsValues(text: string | undefined, defaults: Values): Values {
  const values: Values = { ...defaults };
  if (!text) {
    return values;
  }
  const parsed = parseSettingsBackup(text, defaults);
  if (parsed.ok) {
    Object.assign(values, parsed.values);
  }
  return values;
}
