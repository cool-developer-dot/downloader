/**
 * B20 — each browser profile keeps its own browser settings (the `BROWSER_SETTING_KEYS`: search engine, address bar,
 * navigation…). The settings store always holds the active profile's; a profile switch saves them for the profile
 * being left (MMKV `browserProfileSettings@<id>`) and loads the next profile's. A profile that has none yet — a new
 * one, or guest mode — starts with the defaults. App settings (theme, language, downloads, App Lock) are shared.
 *
 * The saved copy uses Settings Backup's format and is read back through its validation, so a damaged or older value
 * can never put a wrong type or an unknown choice into the store.
 */
import { BROWSER_SETTING_KEYS } from '@/browser/settings/browser-setting-keys';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetString, mmkvRemove, mmkvSetString } from '@/storage/mmkv';
import { useSettingsStore, type SettingsKey } from '@/store/settings';
import { initialSettingsState } from '@/store/settings/state';

import { pickBrowserSettingDefaults, profileSettingsText, profileSettingsValues } from './profile-settings-format';

export { profileSettingsText, profileSettingsValues } from './profile-settings-format';

type Values = Record<string, unknown>;

/** The browser settings' defaults: the rules a saved copy is checked against. */
export function browserSettingDefaults(): Values {
  return pickBrowserSettingDefaults(initialSettingsState as unknown as Values);
}

/** Every profile, the default included, has its own copy (`browserProfileSettings@<id>`). */
function settingsKey(profileId: string): string {
  return `${mmkvKeys.browserProfileSettings}@${profileId}`;
}

export function saveProfileSettings(profileId: string): void {
  const state = useSettingsStore.getState() as unknown as Values;
  mmkvSetString(settingsKey(profileId), profileSettingsText(state, new Date(), browserSettingDefaults()));
}

/** Puts profile `profileId`'s browser settings in the store (the defaults where it has none). */
export function loadProfileSettings(profileId: string): void {
  const values = profileSettingsValues(mmkvGetString(settingsKey(profileId)), browserSettingDefaults());
  const store = useSettingsStore.getState();
  const current = store as unknown as Values;
  for (const key of BROWSER_SETTING_KEYS) {
    if (current[key] !== values[key]) {
      store.updateSetting(key as SettingsKey, values[key] as never);
    }
  }
}

export function deleteProfileSettings(profileId: string): void {
  mmkvRemove(settingsKey(profileId));
}
