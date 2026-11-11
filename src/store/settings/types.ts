import type { AfterDownloadAction } from '@/downloads/v2/after-download';

export interface SettingsState {
  downloadDirectory: string | null;
  /** What happens when a download completes: 'none' (default), 'details', 'play' or 'gallery'. */
  afterDownloadAction: AfterDownloadAction;
  wifiOnly: boolean;
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
