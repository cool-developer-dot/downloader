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
  /** Custom Extension (#494) for new downloads; 'auto' (the default) keeps today's extensions exactly. */
  fileExtension: import('@/downloads/v2/file-extension').FileExtensionChoice;
  /** Confirm Before Start: "Video available" always opens the quality sheet first (default off). */
  confirmBeforeStart: boolean;
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
  /** Connections one large file (or one stream's segments) may use at once, 1–4 (default 3). */
  connectionsPerFile: number;
  /** The player keeps playing (with a media notification) when VidoraX goes to the background (default off). */
  backgroundPlayback: boolean;
  /** Speed limit for all downloads together, bytes per second; 0 = off (default). */
  downloadSpeedLimit: number;
  /** F3: the daily download hours (off by default). */
  downloadHours: import('@/downloads/v2/conditions').DownloadHours;
  /** F3: hold downloads while roaming (default off). */
  notOnRoaming: boolean;
  /** F3: hold downloads at 15 % battery or less while not charging (default off). */
  pauseOnLowBattery: boolean;
  /** F3: download only while charging (default off). */
  onlyWhileCharging: boolean;
  /** F6: "Live recording (beta)" — a live stream offers Record instead of Download (default off). */
  liveRecording: boolean;
  /** F6: a recording stops by itself after this many minutes (15–720, default 120). */
  liveRecordingMaxMinutes: number;
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
