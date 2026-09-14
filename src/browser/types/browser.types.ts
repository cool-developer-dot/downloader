import type {
  BrowserErrorCode,
  BrowserErrorState,
  BrowserSecurityLevel,
} from './navigation.types';
import type { BrowserTab } from '@/browser/tabs/types';

export type {
  BrowserErrorCode,
  BrowserErrorState,
  BrowserSecurityLevel,
  NavigationInputCategory,
  NavigationIntent,
} from './navigation.types';

/**
 * Core browser session state for the active browsing surface.
 * Mirrored from the active tab for Phase 2 chrome compatibility.
 */
export interface BrowserSessionState {
  currentUrl: string;
  pageTitle: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  /** Normalized 0–1 page load progress. */
  progress: number;
  isSecure: boolean;
  securityLevel: BrowserSecurityLevel;
  /** Epoch ms of last successful navigation commit. */
  lastVisited: number | null;
  error: BrowserErrorState | null;
}

/**
 * Extension surface — tabs are real as of Phase 3B.
 * downloads/history/bookmarks remain owned by dedicated stores.
 */
export interface BrowserExtensionState {
  tabs: BrowserTab[];
  activeTabId: string;
  /** Mounted WebView tab ids — length <= maxMountedWebViews (2). */
  mountedTabIds: string[];
  downloads: never[];
  history: never[];
  bookmarks: never[];
  readerMode: false;
  incognito: false;
  /** Active-tab mirror of Desktop Site (per-tab ownership). */
  desktopMode: boolean;
  /**
   * Active-tab mirror: true when active tab's desktopModeSource === 'user'.
   * Global MMKV default is separate (new tabs only).
   */
  desktopModeUserExplicit: boolean;
}

export type BrowserState = BrowserSessionState & BrowserExtensionState;

export interface BrowserNavigationSnapshot {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface BrowserProgressEvent {
  progress: number;
}

export interface BrowserTitleEvent {
  title: string;
}

export interface BrowserLoadErrorEvent {
  code: BrowserErrorCode;
  message: string;
  url: string | null;
  statusCode?: number;
}

/**
 * Future omnibox / chrome action IDs.
 * Wired as extension points only — no behavior in this phase.
 */
export type BrowserChromeActionId =
  | 'share'
  | 'open_external'
  | 'copy_link'
  | 'reader_mode'
  | 'translate'
  | 'desktop_site'
  | 'ai_assistant'
  | 'qr_code'
  | 'downloads'
  | 'bookmarks'
  | 'history';
