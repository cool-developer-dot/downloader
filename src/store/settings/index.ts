import { persist } from 'zustand/middleware';

import { isSupportedLanguage, normalizeLanguageCode, storageKeys } from '@/constants';
import { bindLanguageReader } from '@/localization/translate';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';
import { normalizeDefaultTab } from '@/navigation/helpers/default-tab';

import { createSettingsActions } from './actions';
import { initialSettingsState } from './state';
import type { SettingsState, SettingsStore } from './types';

const MIN_CONCURRENT = 1;
const MAX_CONCURRENT = 4;

function unwrapPersistedSettings(persisted: unknown): Partial<SettingsState> {
  if (!persisted || typeof persisted !== 'object') {
    return {};
  }

  const record = persisted as Record<string, unknown>;
  if (record.state && typeof record.state === 'object') {
    return record.state as Partial<SettingsState>;
  }

  return record as Partial<SettingsState>;
}

function parseMaxConcurrentDownloads(
  value: unknown,
  fallback: number,
): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= MIN_CONCURRENT && value <= MAX_CONCURRENT) {
      return value;
    }
    return fallback;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (
      Number.isInteger(parsed) &&
      parsed >= MIN_CONCURRENT &&
      parsed <= MAX_CONCURRENT
    ) {
      return parsed;
    }
  }

  return fallback;
}

export const useSettingsStore = createStore<SettingsStore>()(
  persist(
    (set) => ({
      ...initialSettingsState,
      ...createSettingsActions(set),
    }),
    {
      name: storageKeys.userPreferences,
      storage: createPersistStorage<SettingsState>(),
      partialize: (state): SettingsState => ({
        downloadDirectory: state.downloadDirectory,
        wifiOnly: state.wifiOnly,
        autoResume: state.autoResume,
        debugLogs: state.debugLogs,
        notifications: state.notifications,
        language: state.language,
        defaultTab: state.defaultTab,
        maxConcurrentDownloads: state.maxConcurrentDownloads,
        saveToGallery: state.saveToGallery,
      }),
      merge: (persisted, current) => {
        const raw = unwrapPersistedSettings(persisted);

        return {
          ...current,
          ...raw,
          maxConcurrentDownloads: parseMaxConcurrentDownloads(
            raw.maxConcurrentDownloads,
            current.maxConcurrentDownloads,
          ),
          wifiOnly: typeof raw.wifiOnly === 'boolean' ? raw.wifiOnly : current.wifiOnly,
          saveToGallery:
            typeof raw.saveToGallery === 'boolean' ? raw.saveToGallery : current.saveToGallery,
          autoResume:
            typeof raw.autoResume === 'boolean' ? raw.autoResume : current.autoResume,
          debugLogs: typeof raw.debugLogs === 'boolean' ? raw.debugLogs : current.debugLogs,
          notifications:
            typeof raw.notifications === 'boolean'
              ? raw.notifications
              : current.notifications,
          language:
            typeof raw.language === 'string' &&
            isSupportedLanguage(normalizeLanguageCode(raw.language))
              ? normalizeLanguageCode(raw.language)
              : current.language,
          defaultTab:
            raw.defaultTab === undefined ? current.defaultTab : normalizeDefaultTab(raw.defaultTab),
          downloadDirectory:
            raw.downloadDirectory === null || typeof raw.downloadDirectory === 'string'
              ? raw.downloadDirectory
              : current.downloadDirectory,
        };
      },
    },
  ),
);

bindLanguageReader(() => useSettingsStore.getState().language);

export * from './selectors';
export type { SettingsActions, SettingsKey, SettingsState, SettingsStore } from './types';
