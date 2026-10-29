import { DEFAULT_DOWNLOAD_SETTINGS } from '@/downloads/settings/types';
import { DEFAULT_DOWNLOAD_HOURS } from '@/downloads/v2/conditions';
import { DEFAULT_CONNECTIONS_PER_FILE, DEFAULT_LIVE_RECORDING_MAX_MINUTES } from '@/downloads/v2/settings';
import { DEFAULT_SPEED_LIMIT } from '@/downloads/v2/speed-limit';
import { DEFAULT_FILE_EXTENSION } from '@/downloads/v2/file-extension';
import { DEFAULT_FILENAME_TEMPLATE } from '@/downloads/v2/filename-template';

import {
  DEFAULT_SAFE_SEARCH,
  DEFAULT_SEARCH_ENGINE,
  DEFAULT_SEARCH_LANGUAGE,
  DEFAULT_SEARCH_REGION,
} from '@/browser/search/search-engines';
import { DEFAULT_ADDRESS_BAR_POSITION } from '@/browser/address-bar/address-bar-settings';
import { DEFAULT_SEARCH_SHORTCUTS_JSON } from '@/browser/search/search-shortcuts';
import { DEFAULT_TAB_SORT_ORDER } from '@/browser/tabs/tab-list-ops';
import { DEFAULT_SCROLL_SPEED } from '@/browser/scroll/scroll-speed';
import { DEFAULT_PRELOAD_PAGES } from '@/browser/preload/preload-policy';

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
  tabSortOrder: DEFAULT_TAB_SORT_ORDER,
  searchEngine: DEFAULT_SEARCH_ENGINE,
  safeSearch: DEFAULT_SAFE_SEARCH,
  searchLanguage: DEFAULT_SEARCH_LANGUAGE,
  searchRegion: DEFAULT_SEARCH_REGION,
  searchSuggestions: true,
  addressBarPosition: DEFAULT_ADDRESS_BAR_POSITION,
  addressBarAutoHide: false,
  searchShortcuts: DEFAULT_SEARCH_SHORTCUTS_JSON,
  swipeNavigation: true,
  scrollSpeed: DEFAULT_SCROLL_SPEED,
  volumeKeyScroll: false,
  preloadPages: DEFAULT_PRELOAD_PAGES,
};
