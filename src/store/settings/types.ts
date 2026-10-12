export interface SettingsState {
  downloadDirectory: string | null;
  wifiOnly: boolean;
  autoResume: boolean;
  notifications: boolean;
  language: string;
  /** Local-only field — not synced to a VidoraX cloud account. */
  maxConcurrentDownloads: number;
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
}

export type SettingsKey = keyof SettingsState;

export interface SettingsActions {
  updateSetting: <K extends SettingsKey>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;
