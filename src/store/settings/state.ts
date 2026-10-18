import { DEFAULT_DOWNLOAD_SETTINGS } from '@/downloads/settings/types';
import { DEFAULT_DOWNLOAD_HOURS } from '@/downloads/v2/conditions';
import { DEFAULT_CONNECTIONS_PER_FILE, DEFAULT_LIVE_RECORDING_MAX_MINUTES } from '@/downloads/v2/settings';
import { DEFAULT_SPEED_LIMIT } from '@/downloads/v2/speed-limit';
import { DEFAULT_FILE_EXTENSION } from '@/downloads/v2/file-extension';
import { DEFAULT_FILENAME_TEMPLATE } from '@/downloads/v2/filename-template';

import type { SettingsState } from './types';
import { DEFAULT_AFTER_DOWNLOAD_ACTION } from '@/downloads/v2/after-download';

export const initialSettingsState: SettingsState = {
  clipboardMonitor: false,
  downloadDirectory: null,
  afterDownloadAction: DEFAULT_AFTER_DOWNLOAD_ACTION,
  wifiOnly: DEFAULT_DOWNLOAD_SETTINGS.wifiOnly,
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  fileExtension: DEFAULT_FILE_EXTENSION,
  confirmBeforeStart: false,
  autoResume: true,
  debugLogs: false,
  notifications: true,
  notificationSound: true,
  notificationVibrate: false,
  notificationSilent: false,
  language: 'en',
  defaultTab: 'browser',
  maxConcurrentDownloads: 2,
  dataLimitDailyMb: 0,
  dataLimitMonthlyMb: 0,
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
  tapToToggle: false,
};
