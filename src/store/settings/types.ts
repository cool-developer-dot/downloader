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
  /** B1 #17: tab switcher order — 'manual' (default: the drag order), 'site', 'lastUsed' or 'opened'. */
  tabSortOrder: import('@/browser/tabs/tab-list-ops').TabSortOrder;
  /** B5 #56: the search engine every search uses (default 'google' — today's). */
  searchEngine: import('@/browser/search/search-engines').SearchEngineId;
  /** B5 #62: Safe Search level (default 'moderate': no parameter on Google — today's URL). */
  safeSearch: import('@/browser/search/search-engines').SafeSearchLevel;
  /** B5 #63: results/interface language (default 'default': the engine decides — today's). */
  searchLanguage: import('@/browser/search/search-engines').SearchLanguage;
  /** B5 #64: region (default 'auto': the engine decides — today's). */
  searchRegion: import('@/browser/search/search-engines').SearchRegion;
  /** B5 #61: history, bookmark and recent-search suggestions in the address bar (default on — today's). */
  searchSuggestions: boolean;
  /** B4 #28: address bar at the 'top' (default — today's) or the 'bottom', above the toolbar. */
  addressBarPosition: import('@/browser/address-bar/address-bar-settings').AddressBarPosition;
  /** B4 #29: hide the address bar while scrolling down a page (default off — today's). */
  addressBarAutoHide: boolean;
  /** B4 #33: search shortcuts (`w Lahore`), as JSON (`search-shortcuts.ts`); default g / b / d / w. */
  searchShortcuts: string;
  /** B6 #45: swipe on the toolbar (and the page edges with button navigation) goes back / forward (default on). */
  swipeNavigation: boolean;
  /** B6 #53: Auto scroll speed and the Volume-key step (default 'normal'). */
  scrollSpeed: import('@/browser/scroll/scroll-speed').ScrollSpeed;
  /** B6 #240: Volume Down / Up scroll a page (default off — today's). */
  volumeKeyScroll: boolean;
  /** B6 #55: Preload pages 'off' / 'wifi' (default) / 'always'. */
  preloadPages: import('@/browser/preload/preload-policy').PreloadPages;
  /** B12 #112/#113: 'allow-all' / 'block-third-party' (default) / 'block-all'. */
  cookiePolicy: import('@/browser/privacy/privacy-settings').CookiePolicy;
  /** B12 #115: send Do Not Track and Global Privacy Control (default off). */
  doNotTrack: boolean;
  /** B12 #124: open http:// pages over https:// (default off). */
  httpsOnly: boolean;
  /** B12 #126: warn on a page that isn't secure (default on). */
  insecurePageWarning: boolean;
  /** B12 #135: JavaScript for every site (default on)… */
  javaScript: boolean;
  /** …except these sites (JSON array of hosts), which are the other way round. */
  javaScriptExceptions: string;
  /** B10 #101: save pages visited in History (default on — today's). Off: no new entries; old ones stay. */
  saveHistory: boolean;
  /** B10 #99: clear browsing data at the next cold start, and show Menu → Exit (default off — today's). */
  clearHistoryOnExit: boolean;
  /** B21 #232: the homepage, '' = the start page (default — today's). */
  homepageUrl: string;
  /** B21 #233: what opens at a cold start (default 'continue' — today's). */
  startupOption: import('@/browser/startup/startup-settings').StartupOption;
  /** B21 #237: spell check in page fields and the app's fields, not the address bar (default on — today's). */
  spellCheck: boolean;
  /** B21 #238: bottom toolbar buttons, comma-separated ids (default 'back,forward,home' — today's). */
  toolbarButtons: string;
  /** B21 #245: start page background 'theme' (default — today's) / 'color' / 'gradient' / 'photo'. */
  startPageBackground: import('@/browser/startup/start-page-background').StartPageBackgroundKind;
  /** B21 #245: the colour preset id. */
  startPageBackgroundColor: string;
  /** B21 #245: the gradient preset id. */
  startPageBackgroundGradient: string;
  /** B21 #245: `file://…/start-page/background-<time>.jpg` written by VidoraWeb, '' = none. */
  startPageBackgroundPhoto: string;
  /** B3 #15: unused tabs give up their page after this time (default 'off' — today's). */
  tabSleepAfter: import('@/browser/tab-sound/tab-sleep').TabSleepAfter;
  /** B13 #116: per-site permissions (blocked requests, pop-ups always allowed) as JSON; default '{}' (none). */
  sitePermissions: string;
  /** B9 #81: the bookmarks bar under the address bar (default off — today's). */
  bookmarksBar: boolean;
  /** B9 #91: Check links only on Wi-Fi (default on). */
  linkCheckWifiOnly: boolean;
}

type DefaultTab = import('@/navigation/helpers/default-tab').DefaultTab;

export type SettingsKey = keyof SettingsState;

export interface SettingsActions {
  updateSetting: <K extends SettingsKey>(key: K, value: SettingsState[K]) => void;
  reset: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;
