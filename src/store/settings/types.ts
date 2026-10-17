export interface SettingsState {
  downloadDirectory: string | null;
  wifiOnly: boolean;
  /** Filename Template for new downloads; the default `{title}` keeps today's naming exactly. */
  filenameTemplate: string;
  /** Custom Extension (#494) for new downloads; 'auto' (the default) keeps today's extensions exactly. */
  fileExtension: import('@/downloads/v2/file-extension').FileExtensionChoice;
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
