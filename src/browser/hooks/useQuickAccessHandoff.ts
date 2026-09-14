import { useCallback } from 'react';

import { pendingNavigationService } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { navigation, routePaths } from '@/navigation';

/**
 * Home (and other tabs) use this to open a quick site in the Browser WebView once.
 * Binds pending navigation to the current active browser tab at request time.
 */
export function useQuickAccessHandoff() {
  return useCallback((url: string) => {
    const targetTabId = useBrowserStore.getState().activeTabId;
    pendingNavigationService.set(url, { targetTabId });
    navigation.navigate(routePaths.browser);
  }, []);
}
