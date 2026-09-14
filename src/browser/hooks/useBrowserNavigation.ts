import { useCallback } from 'react';
import { Keyboard } from 'react-native';

import {
  goBackForTab,
  goForwardForTab,
  goHomeForTab,
  reloadForTab,
  stopLoadingForTab,
} from '@/browser/services';
import {
  selectCanGoBack,
  selectCanGoForward,
  selectIsHome,
  selectIsLoading,
  useBrowserStore,
} from '@/browser/stores';

/**
 * Toolbar / header navigation — always captures activeTabId at press time
 * and dispatches through the canonical active-tab navigation owner.
 */
export function useBrowserNavigation() {
  const canGoBackNative = useBrowserStore(selectCanGoBack);
  const canGoForward = useBrowserStore(selectCanGoForward);
  const isLoading = useBrowserStore(selectIsLoading);
  const isHome = useBrowserStore(selectIsHome);

  const handleBack = useCallback(() => {
    if (isHome) {
      return;
    }
    const targetTabId = useBrowserStore.getState().activeTabId;
    goBackForTab(targetTabId);
  }, [isHome]);

  const handleForward = useCallback(() => {
    if (!canGoForward) {
      return;
    }
    const targetTabId = useBrowserStore.getState().activeTabId;
    goForwardForTab(targetTabId);
  }, [canGoForward]);

  const handleHome = useCallback(() => {
    if (isHome) {
      return;
    }
    Keyboard.dismiss();
    const targetTabId = useBrowserStore.getState().activeTabId;
    goHomeForTab(targetTabId);
  }, [isHome]);

  const handleReloadOrStop = useCallback(() => {
    if (isHome) {
      return;
    }
    const targetTabId = useBrowserStore.getState().activeTabId;
    if (isLoading) {
      stopLoadingForTab(targetTabId);
      return;
    }
    reloadForTab(targetTabId);
  }, [isHome, isLoading]);

  return {
    // Back enabled on websites even without native history (falls back to Home).
    canGoBack: canGoBackNative || !isHome,
    canGoForward,
    isLoading: isLoading && !isHome,
    isHome,
    handleBack,
    handleForward,
    handleHome,
    handleReloadOrStop,
  };
}
