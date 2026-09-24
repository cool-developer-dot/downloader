import type {
  BrowserErrorState,
  BrowserNavigationSnapshot,
  BrowserState,
} from '@/browser/types';
import type {
  BrowserTab,
  CloseTabResult,
  CreateTabResult,
  SwitchTabResult,
} from '@/browser/tabs';

export interface BrowserActions {
  applyNavigationState: (snapshot: BrowserNavigationSnapshot) => void;
  setLoading: (isLoading: boolean) => void;
  setProgress: (progress: number) => void;
  setPageTitle: (title: string) => void;
  setCurrentUrl: (url: string) => void;
  goHome: () => void;
  setError: (error: BrowserErrorState | null) => void;
  clearError: () => void;
  markVisited: (timestamp?: number) => void;
  resetSession: () => void;
  reset: () => void;
  setDesktopMode: (enabled: boolean, options?: { source?: 'user' | 'platform'; tabId?: string }) => void;

  /** Phase 3B tab engine */
  createTab: (options?: { url?: string; title?: string }) => CreateTabResult;
  closeTab: (tabId: string) => CloseTabResult;
  switchTab: (tabId: string) => SwitchTabResult;
  updateTab: (tabId: string, patch: Partial<BrowserTab>) => void;
  /**
   * Clamp the WebView mount pool (1 = active tab only). Used when the Browser
   * route is not visible so parked WebViews stop consuming the JS/UI thread.
   */
  setMountBudget: (maxMounted: number) => void;
  /** Sync active-tab chrome mirrors after external tab mutation. */
  syncChromeFromActiveTab: () => void;
}

export type BrowserStore = BrowserState & BrowserActions;
