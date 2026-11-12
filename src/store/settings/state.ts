import { DEFAULT_DOWNLOAD_SETTINGS } from '@/downloads/settings/types';
import { DEFAULT_DOWNLOAD_HOURS } from '@/downloads/v2/conditions';
import { DEFAULT_CONNECTIONS_PER_FILE, DEFAULT_LIVE_RECORDING_MAX_MINUTES } from '@/downloads/v2/settings';
import { DEFAULT_SPEED_LIMIT } from '@/downloads/v2/speed-limit';

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
  downloadSpeedLimit: DEFAULT_SPEED_LIMIT,
  downloadHours: { ...DEFAULT_DOWNLOAD_HOURS, days: [...DEFAULT_DOWNLOAD_HOURS.days] },
  notOnRoaming: false,
  pauseOnLowBattery: false,
  onlyWhileCharging: false,
  liveRecording: false,
  liveRecordingMaxMinutes: DEFAULT_LIVE_RECORDING_MAX_MINUTES,
};
