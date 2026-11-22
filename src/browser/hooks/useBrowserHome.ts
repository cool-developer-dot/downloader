import { useCallback } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { loadUrlActiveTab } from '@/browser/services';
import { stepAsideForPasteLink } from '@/browser/services/clipboard-link-monitor';
import { openLinkFromClipboard } from '@/browser/services/paste-clipboard-link';
import { translate } from '@/localization';

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Unified Browser start-page actions.
 * Opens destinations via the same canonical owner as omnibox Enter.
 */
export function useBrowserHome() {
  const openUrl = useCallback((url: string) => {
    loadUrlActiveTab(url);
  }, []);

  /**
   * Design 1 "Paste & Go": the copied link opens exactly like "Paste link" everywhere else (the direct analyzer
   * reads it, then the active tab loads it; YouTube is refused). With no link copied the user is told, and the
   * address bar opens as before. The clipboard monitor steps aside so the same link is not offered a second time.
   */
  const pasteAndGo = useCallback(async () => {
    stepAsideForPasteLink();
    const decision = await openLinkFromClipboard();
    if (decision.kind === 'focus') {
      notify(translate('lightHome.noLinkInClipboard'));
    }
    return decision;
  }, []);

  return {
    openUrl,
    pasteAndGo,
  };
}
