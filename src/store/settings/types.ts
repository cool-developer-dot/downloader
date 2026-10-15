export interface SettingsState {
  downloadDirectory: string | null;
  wifiOnly: boolean;
  /** Filename Template for new downloads; the default `{title}` keeps today's naming exactly. */
  filenameTemplate: string;
  /** Confirm Before Start: "Video available" always opens the quality sheet first (default off). */
  confirmBeforeStart: boolean;
  autoResume: boolean;
  notifications: boolean;
  language: string;
  /** Local-only field — not synced to a VidoraX cloud account. */
  maxConcurrentDownloads: number;
  /** Copy every completed download to the device gallery (default on). */
  saveToGallery: boolean;
}

export type SettingsKey = keyof SettingsState;

export interface SettingsActions {
  updateSetting: <K extends SettingsKey>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;
