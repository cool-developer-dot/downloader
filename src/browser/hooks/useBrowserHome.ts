import { useCallback } from 'react';

import { loadUrlActiveTab } from '@/browser/services';

/**
 * Unified Browser start-page actions.
 * Opens destinations via the same canonical owner as omnibox Enter.
 */
export function useBrowserHome() {
  const openUrl = useCallback((url: string) => {
    loadUrlActiveTab(url);
  }, []);

  return {
    openUrl,
  };
}
