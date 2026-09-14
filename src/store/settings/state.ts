import { DEFAULT_DOWNLOAD_SETTINGS } from '@/downloads/settings/types';

import type { SettingsState } from './types';

export const initialSettingsState: SettingsState = {
  downloadDirectory: null,
  wifiOnly: DEFAULT_DOWNLOAD_SETTINGS.wifiOnly,
  autoResume: true,
  notifications: true,
  language: 'en',
  maxConcurrentDownloads: 2,
};
