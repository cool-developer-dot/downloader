export interface SettingsState {
  downloadDirectory: string | null;
  wifiOnly: boolean;
  autoResume: boolean;
  notifications: boolean;
  /** Finished/failed download notifications play a sound (default on — today's behaviour). */
  notificationSound: boolean;
  /** Finished/failed download notifications vibrate (default off — today's behaviour). */
  notificationVibrate: boolean;
  /** Finished/failed download notifications make no sound or vibration; overrides both (default off). */
  notificationSilent: boolean;
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
