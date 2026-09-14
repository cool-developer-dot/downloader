/**
 * Local-only preference writers.
 * Frozen Phase 2: MMKV + Zustand are authoritative. No GET/PATCH /settings.
 */

import { useSettingsStore, useThemeStore } from '@/store';
import type { ThemePreference } from '@/store/theme';

import {
  validateLanguageOrThrow,
  validateThemePreferenceOrThrow,
} from './settings-validation';

function publishDownloadSettings(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { publishDownloadSettingsFromStore } = require('@/downloads/settings') as {
      publishDownloadSettingsFromStore: () => void;
    };
    publishDownloadSettingsFromStore();
  } catch {
    // Engine settings module unavailable during early bootstrap.
  }
}

export async function updateThemePreference(mode: ThemePreference): Promise<void> {
  validateThemePreferenceOrThrow(mode);
  useThemeStore.getState().setTheme(mode);
}

export async function updateLanguagePreference(language: string): Promise<void> {
  const normalized = validateLanguageOrThrow(language);
  useSettingsStore.getState().updateSetting('language', normalized);
}

export async function updateWifiOnlyPreference(value: boolean): Promise<void> {
  useSettingsStore.getState().updateSetting('wifiOnly', value);
  publishDownloadSettings();
}

export async function updateAutoResumePreference(value: boolean): Promise<void> {
  useSettingsStore.getState().updateSetting('autoResume', value);
  publishDownloadSettings();
}

export async function updateNotificationsPreference(value: boolean): Promise<void> {
  useSettingsStore.getState().updateSetting('notifications', value);
  publishDownloadSettings();
}

export const settingsService = {
  updateThemePreference,
  updateLanguagePreference,
  updateWifiOnlyPreference,
  updateAutoResumePreference,
  updateNotificationsPreference,
} as const;
