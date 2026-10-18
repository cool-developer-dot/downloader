import type { SettingsStore } from './types';

export const selectDownloadDirectory = (state: SettingsStore) => state.downloadDirectory;
export const selectWifiOnly = (state: SettingsStore) => state.wifiOnly;
export const selectSaveToGallery = (state: SettingsStore) => state.saveToGallery;
export const selectAutoResume = (state: SettingsStore) => state.autoResume;
export const selectDebugLogs = (state: SettingsStore) => state.debugLogs;
export const selectNotifications = (state: SettingsStore) => state.notifications;
export const selectLanguage = (state: SettingsStore) => state.language;
export const selectDefaultTab = (state: SettingsStore) => state.defaultTab;
export const selectMaxConcurrentDownloads = (state: SettingsStore) =>
  state.maxConcurrentDownloads;
