import type { SettingsStore } from './types';

export const selectClipboardMonitor = (state: SettingsStore) => state.clipboardMonitor;
export const selectDownloadDirectory = (state: SettingsStore) => state.downloadDirectory;
export const selectAfterDownloadAction = (state: SettingsStore) => state.afterDownloadAction;
export const selectWifiOnly = (state: SettingsStore) => state.wifiOnly;
export const selectFilenameTemplate = (state: SettingsStore) => state.filenameTemplate;
export const selectConfirmBeforeStart = (state: SettingsStore) => state.confirmBeforeStart;
export const selectSaveToGallery = (state: SettingsStore) => state.saveToGallery;
export const selectTapToToggle = (state: SettingsStore) => state.tapToToggle;
export const selectAutoResume = (state: SettingsStore) => state.autoResume;
export const selectDebugLogs = (state: SettingsStore) => state.debugLogs;
export const selectNotifications = (state: SettingsStore) => state.notifications;
export const selectNotificationSound = (state: SettingsStore) => state.notificationSound;
export const selectNotificationVibrate = (state: SettingsStore) => state.notificationVibrate;
export const selectNotificationSilent = (state: SettingsStore) => state.notificationSilent;
export const selectLanguage = (state: SettingsStore) => state.language;
export const selectDefaultTab = (state: SettingsStore) => state.defaultTab;
export const selectMaxConcurrentDownloads = (state: SettingsStore) =>
  state.maxConcurrentDownloads;
export const selectDataLimitDailyMb = (state: SettingsStore) => state.dataLimitDailyMb;
export const selectDataLimitMonthlyMb = (state: SettingsStore) => state.dataLimitMonthlyMb;
