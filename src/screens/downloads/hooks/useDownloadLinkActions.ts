import * as Clipboard from 'expo-clipboard';
import { useCallback } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { pendingNavigationService } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { isEngineOwned } from '@/downloads/v2';
import { resolveDownloadLinkTarget, type DownloadLinkTarget } from '@/downloads/v2/link-actions';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useDownloadsStore } from '@/store/downloads';

function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

/** The link target of one row (v2 only), re-evaluated when the row changes. Null hides the actions. */
export function useDownloadLinkTarget(id: string | null | undefined): DownloadLinkTarget | null {
  const status = useDownloadsStore((state) => (id ? state.itemsById[id]?.status : undefined));
  const sourceUrl = useDownloadsStore((state) => (id ? state.itemsById[id]?.sourceUrl : undefined));
  const engineOwned = useDownloadsStore((state) => (id ? isEngineOwned(state, id) : false));
  if (!id || !status) {
    return null;
  }
  return resolveDownloadLinkTarget({ engineOwned, status, sourceUrl });
}

/**
 * Re-download: the source page opens in the browser's current tab — exactly what opening it from History does —
 * so detection, verification and the engine's duplicate check decide what happens. Copy link: the page URL.
 */
export function useDownloadLinkActions() {
  const { t } = useTranslation();

  const redownload = useCallback((target: DownloadLinkTarget) => {
    pendingNavigationService.set(target.pageUrl, {
      targetTabId: useBrowserStore.getState().activeTabId,
    });
    navigation.navigate(routePaths.browser);
  }, []);

  const copyLink = useCallback(
    async (target: DownloadLinkTarget) => {
      try {
        await Clipboard.setStringAsync(target.copyUrl);
        announce(t('downloadLinks.linkCopied'));
      } catch {
        announce(t('downloadLinks.copyFailed'));
      }
    },
    [t],
  );

  return { redownload, copyLink };
}
