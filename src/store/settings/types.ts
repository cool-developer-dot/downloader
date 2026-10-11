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
}

export type SettingsKey = keyof SettingsState;

export interface SettingsActions {
  updateSetting: <K extends SettingsKey>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;
