import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { setTabSwitcherOpen } from '@/browser/incognito/incognito.service';
import { setBrowserRouteVisible } from '@/browser/webview/webview-activity';

/**
 * The Tabs and Tab options screens stand in for the old tab-switcher Modal: while one is in front the browser counts
 * as visible (its page keeps running beneath, as it did under the Modal) and, because incognito tabs are listed,
 * B11 #106's FLAG_SECURE stays on. Leaving the screen hands both flags back: the browser's own focus effect sets
 * them again when it is in front, and any other tab of the app leaves them off.
 */
export function useTabsScreenPresence(): void {
  useFocusEffect(
    useCallback(() => {
      setBrowserRouteVisible(true);
      setTabSwitcherOpen(true);
      return () => {
        setTabSwitcherOpen(false);
        setBrowserRouteVisible(false);
      };
    }, []),
  );
}
