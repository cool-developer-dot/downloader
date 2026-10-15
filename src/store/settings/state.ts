import { DEFAULT_DOWNLOAD_SETTINGS } from '@/downloads/settings/types';
import { DEFAULT_AFTER_DOWNLOAD_ACTION } from '@/downloads/v2/after-download';

import type { SettingsState } from './types';

export const initialSettingsState: SettingsState = {
  downloadDirectory: null,
  afterDownloadAction: DEFAULT_AFTER_DOWNLOAD_ACTION,
  wifiOnly: DEFAULT_DOWNLOAD_SETTINGS.wifiOnly,
  autoResume: true,
  notifications: true,
  language: 'en',
  maxConcurrentDownloads: 2,
  saveToGallery: true,
};
