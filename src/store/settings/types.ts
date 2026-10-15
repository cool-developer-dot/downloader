import type { AfterDownloadAction } from '@/downloads/v2/after-download';

export interface SettingsState {
  /** Clipboard Monitor: offer a copied link when VidoraX returns to the foreground (default off). */
  clipboardMonitor: boolean;
  downloadDirectory: string | null;
  /** What happens when a download completes: 'none' (default), 'details', 'play' or 'gallery'. */
  afterDownloadAction: AfterDownloadAction;
  wifiOnly: boolean;
  /** Filename Template for new downloads; the default `{title}` keeps today's naming exactly. */
  filenameTemplate: string;
  autoResume: boolean;
  /** Debug Logs: keep an in-memory, redacted log of VidoraX's own events (default off). */
  debugLogs: boolean;
  notifications: boolean;
  /** Finished/failed download notifications play a sound (default on — today's behaviour). */
  notificationSound: boolean;
  /** Finished/failed download notifications vibrate (default off — today's behaviour). */
  notificationVibrate: boolean;
  /** Finished/failed download notifications make no sound or vibration; overrides both (default off). */
  notificationSilent: boolean;
  language: string;
  /** The tab a returning user lands on after the splash: 'browser' (default), 'downloads' or 'player'. */
  defaultTab: DefaultTab;
  /** Local-only field — not synced to a VidoraX cloud account. */
  maxConcurrentDownloads: number;
  /** Data Limit Alert: daily / monthly limits in MB; 0 = off (default). An alert never pauses downloads. */
  dataLimitDailyMb: number;
  dataLimitMonthlyMb: number;
  /** Copy every completed download to the device gallery (default on). */
  saveToGallery: boolean;
  /** Tapping a running/paused download row pauses/resumes it instead of opening details (default off). */
  tapToToggle: boolean;
}

type DefaultTab = import('@/navigation/helpers/default-tab').DefaultTab;

export type SettingsKey = keyof SettingsState;

export interface SettingsActions {
  updateSetting: <K extends SettingsKey>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;
