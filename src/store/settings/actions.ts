import type { StoreApi } from 'zustand';

import {
  resetPreferences,
  setAutoResume,
  setDownloadDirectory,
  setLanguage,
  setMaxConcurrentDownloads,
  setNotifications,
  setWifiOnly,
} from '@/storage/mmkv';

import { initialSettingsState } from './state';
import type { SettingsActions, SettingsKey, SettingsState, SettingsStore } from './types';

function persistSetting<K extends SettingsKey>(key: K, value: SettingsState[K]): void {
  switch (key) {
    case 'wifiOnly':
      setWifiOnly(value as boolean);
      break;
    case 'autoResume':
      setAutoResume(value as boolean);
      break;
    case 'notifications':
      setNotifications(value as boolean);
      break;
    case 'downloadDirectory':
      setDownloadDirectory(value as string | null);
      break;
    case 'language':
      setLanguage(value as string);
      break;
    case 'maxConcurrentDownloads':
      setMaxConcurrentDownloads(value as number);
      break;
    default:
      break;
  }
}

export function createSettingsActions(
  set: StoreApi<SettingsStore>['setState'],
): SettingsActions {
  return {
    updateSetting: (key, value) => {
      persistSetting(key, value);
      set({ [key]: value } as Partial<SettingsStore>);
    },
    reset: () => {
      resetPreferences();
      setLanguage(initialSettingsState.language);
      setMaxConcurrentDownloads(initialSettingsState.maxConcurrentDownloads);
      set(initialSettingsState);
    },
  };
}
