import { memo, useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { EmptyState } from '@/components/common/EmptyState';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { environment } from '@/constants/environment';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import {
  registerBrowserLoadUrl,
  useQualitySelectionContext,
} from '@/screens/downloads/quality';

import {
  BrowserContainer,
  BrowserHeader,
  BrowserOverflowControls,
  BrowserProgressBar,
  BrowserTabBadge,
  BrowserToolbar,
} from '@/browser/components';
import { BrowserTabSwitcher } from '@/browser/components/BrowserTabSwitcher';
import { BrowserEngineProvider, useBrowserEngineContext } from '@/browser/engine';
import {
  useBrowserEngine,
  useBrowserSessionContinuity,
  useBrowserHardwareBack,
} from '@/browser/hooks';
import { pendingNavigationService } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { isBrowserHomeUrl } from '@/browser/utils';
import { BrowserMediaDownloadBar, browserMediaActionService } from '@/browser/media-actions';
import { MediaDetectionHost } from '@/media-detection';
import { logPageFlow, safePageHostname } from '@/media-detection/services/page-flow-diagnostics.service';
import { isSameDocumentUrl } from '@/media-detection/utils';

/**
 * BrowserScreen orchestrates only:
 * Initialize engine → Provide engine context → Compose chrome → Render.
 * No business logic belongs here.
 */
export const BrowserScreen = memo(function BrowserScreen() {
  const engine = useBrowserEngine();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      /** One-shot guard: never re-enter consume for the same requestId. */
      let consumingRequestId: number | null = null;

      const tryConsumePending = () => {
        if (cancelled) {
          return;
        }
        const pending = pendingNavigationService.peek();
        logPageFlow('browser_focus', {
          hasPending: Boolean(pending),
        });
        if (!pending) {
          return;
        }
        if (consumingRequestId === pending.requestId) {
          return;
        }

        const store = useBrowserStore.getState();
        const targetExists = store.tabs.some((t) => t.id === pending.targetTabId);
        if (!targetExists) {
          pendingNavigationService.clear();
          return;
        }

        // Ensure target is active so the mount pool allocates its WebView.
        // Do not load into a different tab's controller while waiting.
        if (store.activeTabId !== pending.targetTabId) {
          store.switchTab(pending.targetTabId);
        }

        const controller = tabControllerRegistry.get(pending.targetTabId);
        if (!controller) {
          return;
        }

        consumingRequestId = pending.requestId;
        const consumed = pendingNavigationService.consume(pending.requestId);
        if (!consumed) {
          consumingRequestId = null;
          return;
        }

        logPageFlow('navigation_consumed', {
          hostname: safePageHostname(consumed.url),
        });

        const targetTab = useBrowserStore
          .getState()
          .tabs.find((t) => t.id === consumed.targetTabId);
        const current = targetTab?.url ?? useBrowserStore.getState().currentUrl;
        if (isBrowserHomeUrl(current) || !isSameDocumentUrl(current, consumed.url)) {
          logPageFlow('webview_load', { hostname: safePageHostname(consumed.url) });
          controller.loadUrl(consumed.url);
        }
      };

      tryConsumePending();
      const unsubscribe = tabControllerRegistry.subscribe(tryConsumePending);
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, []),
  );

  if (!environment.featureFlags.enableBrowser) {
    return (
      <SafeAreaScreen
        padded
        edges={['top', 'bottom', 'left', 'right']}
        testID="browser-screen-disabled">
        <Box flex={1} center>
          <EmptyState
            title="Browser unavailable"
            description="The in-app browser is disabled for this build."
            icon="web-off"
            testID="browser-disabled-state"
          />
        </Box>
      </SafeAreaScreen>
    );
  }

  return (
    <BrowserEngineProvider value={engine}>
      <BrowserScreenBody />
    </BrowserEngineProvider>
  );
});

const BrowserScreenBody = memo(function BrowserScreenBody() {
  useBrowserSessionContinuity();
  useBrowserHardwareBack();
  const { loadUrl } = useBrowserEngineContext();
  const { t } = useTranslation();
  const [tabSwitcherVisible, setTabSwitcherVisible] = useState(false);

  useEffect(() => registerBrowserLoadUrl(loadUrl), [loadUrl]);

  const qualitySelection = useQualitySelectionContext();

  const openWithUrl = qualitySelection.openWithUrl;
  const openWithAnalysis = qualitySelection.openWithAnalysis;
  const handleRequestDownload = useCallback(
    async (
      sourceUrl: string,
      options?: {
        referer?: string | null;
        requestContext?: import('@/downloads/types/request-context').MediaRequestContext | null;
      },
    ) => {
      const browserState = browserMediaActionService.getState();
      if (browserState.analysis && browserState.requestContext) {
        openWithAnalysis(browserState.analysis, {
          sourceUrl,
          requestContext: options?.requestContext ?? browserState.requestContext,
        });
        return;
      }
      await openWithUrl(sourceUrl, options);
    },
    [openWithAnalysis, openWithUrl],
  );

  const openTabSwitcher = useCallback(() => {
    setTabSwitcherVisible(true);
  }, []);

  const closeTabSwitcher = useCallback(() => {
    setTabSwitcherVisible(false);
  }, []);

  const handleTabsLimit = useCallback(() => {
    AccessibilityInfo.announceForAccessibility(t('browser.tabsLimitReached'));
  }, [t]);

  return (
    <SafeAreaScreen
      padded={false}
      edges={['top', 'left', 'right']}
      testID="browser-screen">
      <MediaDetectionHost />
      <BrowserHeader
        leadingSlot={<BrowserTabBadge onPress={openTabSwitcher} />}
        trailingSlot={<BrowserOverflowControls />}
      />
      <BrowserProgressBar />
      <Box flex={1} style={{ position: 'relative' }}>
        <BrowserContainer />
        <BrowserMediaDownloadBar
          overlayBlocking={tabSwitcherVisible}
          onRequestDownload={handleRequestDownload}
        />
      </Box>
      <BrowserToolbarDock />
      <BrowserTabSwitcher
        visible={tabSwitcherVisible}
        onClose={closeTabSwitcher}
        onLimitReached={handleTabsLimit}
      />
    </SafeAreaScreen>
  );
});

const BrowserToolbarDock = memo(function BrowserToolbarDock() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <Box style={{ paddingBottom: insets.bottom, backgroundColor: theme.colors.background }}>
      <BrowserToolbar />
    </Box>
  );
});
