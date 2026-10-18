export interface SettingsState {
  downloadDirectory: string | null;
  wifiOnly: boolean;
  autoResume: boolean;
  /** Debug Logs: keep an in-memory, redacted log of VidoraX's own events (default off). */
  debugLogs: boolean;
  notifications: boolean;
  language: string;
  /** The tab a returning user lands on after the splash: 'browser' (default), 'downloads' or 'player'. */
  defaultTab: DefaultTab;
  /** Local-only field — not synced to a VidoraX cloud account. */
  maxConcurrentDownloads: number;
  /** Copy every completed download to the device gallery (default on). */
  saveToGallery: boolean;
}

type DefaultTab = import('@/navigation/helpers/default-tab').DefaultTab;

export type SettingsKey = keyof SettingsState;

export interface SettingsActions {
  updateSetting: <K extends SettingsKey>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;
