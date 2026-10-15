import { DEFAULT_DOWNLOAD_SETTINGS } from '@/downloads/settings/types';
import { DEFAULT_FILENAME_TEMPLATE } from '@/downloads/v2/filename-template';

import type { SettingsState } from './types';
import { DEFAULT_AFTER_DOWNLOAD_ACTION } from '@/downloads/v2/after-download';

export const initialSettingsState: SettingsState = {
  downloadDirectory: null,
  afterDownloadAction: DEFAULT_AFTER_DOWNLOAD_ACTION,
  wifiOnly: DEFAULT_DOWNLOAD_SETTINGS.wifiOnly,
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  autoResume: true,
  debugLogs: false,
  notifications: true,
  notificationSound: true,
  notificationVibrate: false,
  notificationSilent: false,
  language: 'en',
  defaultTab: 'browser',
  maxConcurrentDownloads: 2,
  saveToGallery: true,
  tapToToggle: false,
};
