import type { SettingsStore } from './types';

export const selectDownloadDirectory = (state: SettingsStore) => state.downloadDirectory;
export const selectWifiOnly = (state: SettingsStore) => state.wifiOnly;
export const selectSaveToGallery = (state: SettingsStore) => state.saveToGallery;
export const selectConnectionsPerFile = (state: SettingsStore) => state.connectionsPerFile;
export const selectBackgroundPlayback = (state: SettingsStore) => state.backgroundPlayback;
export const selectDownloadSpeedLimit = (state: SettingsStore) => state.downloadSpeedLimit;
export const selectAutoResume = (state: SettingsStore) => state.autoResume;
export const selectNotifications = (state: SettingsStore) => state.notifications;
export const selectLanguage = (state: SettingsStore) => state.language;
export const selectMaxConcurrentDownloads = (state: SettingsStore) =>
  state.maxConcurrentDownloads;
