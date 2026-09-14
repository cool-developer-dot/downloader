import { useCallback } from 'react';
import { usePathname } from 'expo-router';

import { logBrowserNav } from '@/browser/diagnostics';
import { goBackForTab } from '@/browser/services';
import { selectIsHome, useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { routePaths } from '@/navigation/constants/route-paths';
import { useAndroidBackHandler } from '@/navigation/hooks/use-android-back-handler';

/**
 * Android hardware Back on the browser tab — same owner as toolbar Back.
 * Modal surfaces (tab switcher / overflow) consume Back via Modal.onRequestClose first.
 */
export function useBrowserHardwareBack(enabled = true): void {
  const pathname = usePathname();
  const isBrowserTab = pathname === routePaths.browser;

  const handleBackPress = useCallback(() => {
    if (selectIsHome(useBrowserStore.getState())) {
      // Already Home — defer to tab-exit / system.
      return false;
    }

    const targetTabId = useBrowserStore.getState().activeTabId;
    const controller = tabControllerRegistry.get(targetTabId);
    logBrowserNav(controller?.navigationEpochRef.current ?? 0, 'android_back', {
      strategy: 'active_tab_command',
      tabId: targetTabId,
      canGoBack: controller?.nativeCanGoBackRef.current ?? false,
    });

    // Match toolbar: native history when available, else Home fallback.
    goBackForTab(targetTabId);
    return true;
  }, []);

  useAndroidBackHandler({
    enabled: enabled && isBrowserTab,
    onBackPress: handleBackPress,
  });
}
