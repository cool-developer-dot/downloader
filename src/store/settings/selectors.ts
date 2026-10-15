import type { SettingsStore } from './types';

export const selectDownloadDirectory = (state: SettingsStore) => state.downloadDirectory;
export const selectAfterDownloadAction = (state: SettingsStore) => state.afterDownloadAction;
export const selectWifiOnly = (state: SettingsStore) => state.wifiOnly;
export const selectFilenameTemplate = (state: SettingsStore) => state.filenameTemplate;
export const selectSaveToGallery = (state: SettingsStore) => state.saveToGallery;
export const selectTapToToggle = (state: SettingsStore) => state.tapToToggle;
export const selectAutoResume = (state: SettingsStore) => state.autoResume;
export const selectNotifications = (state: SettingsStore) => state.notifications;
export const selectNotificationSound = (state: SettingsStore) => state.notificationSound;
export const selectNotificationVibrate = (state: SettingsStore) => state.notificationVibrate;
export const selectNotificationSilent = (state: SettingsStore) => state.notificationSilent;
export const selectLanguage = (state: SettingsStore) => state.language;
export const selectMaxConcurrentDownloads = (state: SettingsStore) =>
  state.maxConcurrentDownloads;
