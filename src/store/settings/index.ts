import { persist } from 'zustand/middleware';

import { isSupportedLanguage, normalizeLanguageCode, storageKeys } from '@/constants';
import { normalizeConnectionsPerFile, normalizeLiveRecordingMaxMinutes } from '@/downloads/v2/settings';
import { normalizeDownloadHours } from '@/downloads/v2/conditions';
import { normalizeSpeedLimit } from '@/downloads/v2/speed-limit';
import { normalizeFileExtensionChoice } from '@/downloads/v2/file-extension';
import { normalizeFilenameTemplate } from '@/downloads/v2/filename-template';
import { bindLanguageReader } from '@/localization/translate';
import { createStore } from '@/store/shared/create-store';
import { normalizeAfterDownloadAction } from '@/downloads/v2/after-download';
import { createPersistStorage } from '@/store/shared/persist-storage';
import { normalizeDefaultTab } from '@/navigation/helpers/default-tab';

import { createSettingsActions } from './actions';
import { initialSettingsState } from './state';
import type { SettingsState, SettingsStore } from './types';
import { normalizeLimitMb } from '@/downloads/v2/data-usage';

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
        clipboardMonitor: state.clipboardMonitor,
        downloadDirectory: state.downloadDirectory,
        afterDownloadAction: state.afterDownloadAction,
        wifiOnly: state.wifiOnly,
        filenameTemplate: state.filenameTemplate,
        fileExtension: state.fileExtension,
        confirmBeforeStart: state.confirmBeforeStart,
        autoResume: state.autoResume,
        debugLogs: state.debugLogs,
        notifications: state.notifications,
        notificationSound: state.notificationSound,
        notificationVibrate: state.notificationVibrate,
        notificationSilent: state.notificationSilent,
        language: state.language,
        defaultTab: state.defaultTab,
        maxConcurrentDownloads: state.maxConcurrentDownloads,
        dataLimitDailyMb: state.dataLimitDailyMb,
        dataLimitMonthlyMb: state.dataLimitMonthlyMb,
        saveToGallery: state.saveToGallery,
        connectionsPerFile: state.connectionsPerFile,
        backgroundPlayback: state.backgroundPlayback,
        downloadSpeedLimit: state.downloadSpeedLimit,
        downloadHours: state.downloadHours,
        notOnRoaming: state.notOnRoaming,
        pauseOnLowBattery: state.pauseOnLowBattery,
        onlyWhileCharging: state.onlyWhileCharging,
        liveRecording: state.liveRecording,
        liveRecordingMaxMinutes: state.liveRecordingMaxMinutes,
        tapToToggle: state.tapToToggle,
      }),
      merge: (persisted, current) => {
        const raw = unwrapPersistedSettings(persisted);

        return {
          ...current,
          ...raw,
          dataLimitDailyMb:
            raw.dataLimitDailyMb === undefined ? current.dataLimitDailyMb : normalizeLimitMb(raw.dataLimitDailyMb),
          dataLimitMonthlyMb:
            raw.dataLimitMonthlyMb === undefined ? current.dataLimitMonthlyMb : normalizeLimitMb(raw.dataLimitMonthlyMb),
          maxConcurrentDownloads: parseMaxConcurrentDownloads(
            raw.maxConcurrentDownloads,
            current.maxConcurrentDownloads,
          ),
          afterDownloadAction:
            raw.afterDownloadAction === undefined
              ? current.afterDownloadAction
              : normalizeAfterDownloadAction(raw.afterDownloadAction),
          wifiOnly: typeof raw.wifiOnly === 'boolean' ? raw.wifiOnly : current.wifiOnly,
          filenameTemplate:
            typeof raw.filenameTemplate === 'string'
              ? normalizeFilenameTemplate(raw.filenameTemplate)
              : current.filenameTemplate,
          fileExtension:
            raw.fileExtension === undefined ? current.fileExtension : normalizeFileExtensionChoice(raw.fileExtension),
          confirmBeforeStart:
            typeof raw.confirmBeforeStart === 'boolean' ? raw.confirmBeforeStart : current.confirmBeforeStart,
          saveToGallery:
            typeof raw.saveToGallery === 'boolean' ? raw.saveToGallery : current.saveToGallery,
          connectionsPerFile:
            raw.connectionsPerFile === undefined
              ? current.connectionsPerFile
              : normalizeConnectionsPerFile(raw.connectionsPerFile),
          downloadSpeedLimit:
            raw.downloadSpeedLimit === undefined
              ? current.downloadSpeedLimit
              : normalizeSpeedLimit(raw.downloadSpeedLimit),
          backgroundPlayback:
            typeof raw.backgroundPlayback === 'boolean'
              ? raw.backgroundPlayback
              : current.backgroundPlayback,
          downloadHours:
            raw.downloadHours === undefined ? current.downloadHours : normalizeDownloadHours(raw.downloadHours),
          notOnRoaming: typeof raw.notOnRoaming === 'boolean' ? raw.notOnRoaming : current.notOnRoaming,
          pauseOnLowBattery:
            typeof raw.pauseOnLowBattery === 'boolean' ? raw.pauseOnLowBattery : current.pauseOnLowBattery,
          onlyWhileCharging:
            typeof raw.onlyWhileCharging === 'boolean' ? raw.onlyWhileCharging : current.onlyWhileCharging,
          liveRecording: typeof raw.liveRecording === 'boolean' ? raw.liveRecording : current.liveRecording,
          liveRecordingMaxMinutes:
            raw.liveRecordingMaxMinutes === undefined
              ? current.liveRecordingMaxMinutes
              : normalizeLiveRecordingMaxMinutes(raw.liveRecordingMaxMinutes),
          tapToToggle:
            typeof raw.tapToToggle === 'boolean' ? raw.tapToToggle : current.tapToToggle,
          autoResume:
            typeof raw.autoResume === 'boolean' ? raw.autoResume : current.autoResume,
          debugLogs: typeof raw.debugLogs === 'boolean' ? raw.debugLogs : current.debugLogs,
          notifications:
            typeof raw.notifications === 'boolean'
              ? raw.notifications
              : current.notifications,
          notificationSound:
            typeof raw.notificationSound === 'boolean' ? raw.notificationSound : current.notificationSound,
          notificationVibrate:
            typeof raw.notificationVibrate === 'boolean' ? raw.notificationVibrate : current.notificationVibrate,
          notificationSilent:
            typeof raw.notificationSilent === 'boolean' ? raw.notificationSilent : current.notificationSilent,
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
          clipboardMonitor:
            typeof raw.clipboardMonitor === 'boolean' ? raw.clipboardMonitor : current.clipboardMonitor,
        };
      },
    },
  ),
);

bindLanguageReader(() => useSettingsStore.getState().language);

export * from './selectors';
export type { SettingsActions, SettingsKey, SettingsState, SettingsStore } from './types';
