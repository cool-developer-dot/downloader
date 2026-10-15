import { DEFAULT_DOWNLOAD_SETTINGS } from '@/downloads/settings/types';
import { DEFAULT_FILENAME_TEMPLATE } from '@/downloads/v2/filename-template';

import type { SettingsState } from './types';

export const initialSettingsState: SettingsState = {
  downloadDirectory: null,
  wifiOnly: DEFAULT_DOWNLOAD_SETTINGS.wifiOnly,
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  confirmBeforeStart: false,
  autoResume: true,
  notifications: true,
  language: 'en',
  maxConcurrentDownloads: 2,
  saveToGallery: true,
};
