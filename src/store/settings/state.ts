import { DEFAULT_DOWNLOAD_SETTINGS } from '@/downloads/settings/types';
import { DEFAULT_CONNECTIONS_PER_FILE } from '@/downloads/v2/settings';

import type { SettingsState } from './types';

export const initialSettingsState: SettingsState = {
  downloadDirectory: null,
  wifiOnly: DEFAULT_DOWNLOAD_SETTINGS.wifiOnly,
  autoResume: true,
  notifications: true,
  language: 'en',
  maxConcurrentDownloads: 2,
  saveToGallery: true,
  connectionsPerFile: DEFAULT_CONNECTIONS_PER_FILE,
  backgroundPlayback: false,
};
