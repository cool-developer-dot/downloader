/**
 * @deprecated Import from `@/browser` instead.
 * Re-exports the production browserStore for legacy barrel consumers.
 */
export {
  initialBrowserSessionState,
  initialBrowserState,
  selectAddressBarState,
  selectBrowserError,
  selectCanGoBack,
  selectCanGoForward,
  selectCurrentUrl,
  selectIsHome,
  selectIsLoading,
  selectIsSecure,
  selectLastVisited,
  selectNavigationChrome,
  selectPageTitle,
  selectProgress,
  selectSecurityLevel,
  useBrowserStore,
} from '@/browser/stores';

export type { BrowserActions, BrowserStore } from '@/browser/stores';
export type {
  BrowserErrorState,
  BrowserSecurityLevel,
  BrowserState,
} from '@/browser/types';
