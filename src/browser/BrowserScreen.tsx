import { memo, useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { PanGesture } from 'react-native-gesture-handler';

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
import { AutoHideHeader } from '@/browser/components/BrowserHeader/AutoHideHeader';
import { normalizeAddressBarPosition } from '@/browser/address-bar/address-bar-settings';
import { useSettingsStore } from '@/store/settings';
import { TabUndoSnackbar } from '@/browser/components/TabUndoSnackbar/TabUndoSnackbar';
import { BackgroundTabSnackbar } from '@/browser/components/BackgroundTabSnackbar/BackgroundTabSnackbar';
import { AutoScrollControl } from '@/browser/components/PageScrollControls/AutoScrollControl';
import { ScrollJumpButton } from '@/browser/components/PageScrollControls/ScrollJumpButton';
import { PageEdgeSwipe } from '@/browser/components/SwipeNavigation/PageEdgeSwipe';
import { SwipeArrow } from '@/browser/components/SwipeNavigation/SwipeArrow';
import { useSwipeNavigation } from '@/browser/components/SwipeNavigation/useSwipeNavigation';
import { useVolumeKeyScroll } from '@/browser/hooks/useVolumeKeyScroll';
import { useSelectionMenu } from '@/browser/hooks/useSelectionMenu';
import { useKeyboardShortcuts } from '@/browser/hooks/useKeyboardShortcuts';
import { useTabSleep } from '@/browser/hooks/useTabSleep';
import { SiteNoticeBar } from '@/browser/site-permissions/components/SiteNoticeBar';
import { BookmarksBar } from '@/browser/bookmarks/components/BookmarksBar';
import { BookmarkEditHost } from '@/browser/bookmarks/components/BookmarkSheets';
import { SitePermissionsHost } from '@/browser/site-permissions/components/SitePermissionsSheet';
import { ReaderHost } from '@/browser/reader/components/ReaderView';
import { PageDisplayHost } from '@/browser/page-display/components/PageDisplaySheet';
import { usePageBrightness } from '@/browser/page-display/use-page-brightness';
import { ensureDataSaver } from '@/browser/data-saver/data-saver.service';
import { ensureBrowsingTraffic } from '@/browser/data-saver/browsing-traffic.service';
import { ensureContentBlocking } from '@/browser/blocking/content-blocking.service';
import { ensureSiteBlocking } from '@/browser/blocking/site-blocking.service';
import { ensureIncognito, setTabSwitcherOpen } from '@/browser/incognito/incognito.service';
import { ensureOpenInApp } from '@/browser/open-in-app/open-in-app.service';
import { OpenInAppChip } from '@/browser/open-in-app/components/OpenInAppChip';
import { FormSnippetBar } from '@/browser/form-snippets/components/FormSnippetBar';
import { ShareQrHost } from '@/browser/share-qr/components/ShareQrHost';
import { scheduleCacheLimitCheck } from '@/browser/data-saver/cache-limit.service';
import { FindInPageBar } from '@/browser/find/FindInPageBar';
import { BrowserEngineProvider, useBrowserEngineContext } from '@/browser/engine';
import { useIsWebFullscreen, useWebFullscreenLifecycle } from '@/browser/fullscreen';
import {
  useBrowserEngine,
  useBrowserRouteLifecycle,
  useBrowserSessionContinuity,
  useBrowserHardwareBack,
} from '@/browser/hooks';
import { pendingNavigationService } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { isBrowserHomeUrl } from '@/browser/utils';
import { BrowserMediaDownloadBar, browserMediaActionService } from '@/browser/media-actions';
import { MediaDetectionHost } from '@/media-detection';
import { ProfileSwitcherHost } from '@/browser/components/ProfileSwitcher/ProfileSwitcherHost';
import { InsecurePageBar } from '@/browser/components/SiteInfo/InsecurePageBar';
import { SiteInfoHost } from '@/browser/components/SiteInfo/SiteInfoHost';
import { logPageFlow, safePageHostname } from '@/media-detection/services/page-flow-diagnostics.service';
import { isSameDocumentUrl } from '@/media-detection/utils';
import { useTourTargetRef } from '@/tour/tour-targets';

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
  useBrowserRouteLifecycle();
  useBrowserSessionContinuity();
  useBrowserHardwareBack();
  // B16 #181: the browser's own brightness while it is in front.
  usePageBrightness();
  // B18: savers (preloading, tab sleep, auto scroll, pictures), browsing data counts, the cache limit check.
  useEffect(() => ensureDataSaver(), []);
  useEffect(() => ensureBrowsingTraffic(), []);
  // B14: ad / tracker rules to the native blocker; the site blocker, time limits and focus mode.
  useEffect(() => ensureContentBlocking(), []);
  useEffect(() => ensureSiteBlocking(), []);
  // B11: the incognito session (profile, wipe, FLAG_SECURE, App Lock on return, download notice).
  useEffect(() => ensureIncognito(), []);
  // B22 #273: watches the page in front for the Open in app chip.
  useEffect(() => ensureOpenInApp(), []);
  useEffect(() => scheduleCacheLimitCheck(), []);
  const { loadUrl } = useBrowserEngineContext();
  const { t } = useTranslation();
  const [tabSwitcherVisible, setTabSwitcherVisible] = useState(false);
  // B11 #106: the switcher lists incognito tabs, so it is covered by FLAG_SECURE too while it's open.
  useEffect(() => setTabSwitcherOpen(tabSwitcherVisible), [tabSwitcherVisible]);
  useWebFullscreenLifecycle(tabSwitcherVisible);
  const webFullscreenActive = useIsWebFullscreen();
  // B6: Volume keys scroll the page (setting); swipes on the toolbar / page edges go back and forward.
  useVolumeKeyScroll({ overlayOpen: tabSwitcherVisible || webFullscreenActive });
  const swipe = useSwipeNavigation();
  // B8: Search in pages' text-selection menu (Copy and Share stay Android's own).
  useSelectionMenu();
  // B21 #246: keyboard shortcuts (physical keyboard) through B6's key channel.
  useKeyboardShortcuts();
  // B3 #15: unused tabs sleep (Browser settings → Tabs; off by default).
  useTabSleep();
  const pageControlsVisible = !tabSwitcherVisible && !webFullscreenActive;
  // The page area: the tour shows where "Video available" appears (its bottom edge, above the toolbar).
  const pageAreaRef = useTourTargetRef('pageArea');

  useEffect(() => registerBrowserLoadUrl(loadUrl), [loadUrl]);

  const qualitySelection = useQualitySelectionContext();
  // B4 #28: the address bar at the top (default) or at the bottom, just above the toolbar.
  const addressBarPosition = normalizeAddressBarPosition(useSettingsStore((state) => state.addressBarPosition));

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
      <ProfileSwitcherHost />
      <SiteInfoHost />
      {/* B13: Site permissions from the bar or the lock icon. */}
      <SitePermissionsHost />
      {/* B9 #78: Edit bookmark from the star. */}
      <BookmarkEditHost />
      {/* B15 #161: reader mode over the page. */}
      <ReaderHost />
      {/* B16: the Page display (Aa) panel. */}
      <PageDisplayHost />
      {addressBarPosition === 'top' ? (
        <AutoHideHeader position="top">
          <BrowserHeader
            leadingSlot={<BrowserTabBadge onPress={openTabSwitcher} />}
            trailingSlot={<BrowserOverflowControls />}
          />
          {/* B9 #81: hides with the address bar. */}
          <BookmarksBar />
        </AutoHideHeader>
      ) : null}
      {addressBarPosition === 'top' ? <BrowserProgressBar /> : null}
      <Box ref={pageAreaRef} collapsable={false} flex={1} style={{ position: 'relative' }}>
        <PageEdgeSwipe leftEdge={swipe.leftEdge} rightEdge={swipe.rightEdge}>
          <BrowserContainer />
        </PageEdgeSwipe>
        <BrowserMediaDownloadBar
          overlayBlocking={tabSwitcherVisible || webFullscreenActive}
          onRequestDownload={handleRequestDownload}
        />
        <InsecurePageBar visible={pageControlsVisible && !tabSwitcherVisible} />
        <TabUndoSnackbar visible={pageControlsVisible} bottom={12} />
        <BackgroundTabSnackbar visible={pageControlsVisible} bottom={12} />
        <SiteNoticeBar visible={pageControlsVisible} bottom={12} />
        {/* B22 #273: "Open in <app>", once per site per session. */}
        <OpenInAppChip visible={pageControlsVisible} bottom={72} />
        {/* B22 #274: form snippets above the keyboard while a page field has focus. */}
        <FormSnippetBar visible={!tabSwitcherVisible} />
        {/* B22 #249 / #30: the QR code and scan result sheets. */}
        <ShareQrHost />
        <ScrollJumpButton visible={pageControlsVisible} bottom={PAGE_CONTROLS_BOTTOM} />
        <AutoScrollControl visible={pageControlsVisible} bottom={PAGE_CONTROLS_BOTTOM} />
        <SwipeArrow shared={swipe.shared} bottom={24} />
        {/* B7: the find bar over the top of the page. */}
        {pageControlsVisible ? <FindInPageBar /> : null}
      </Box>
      {addressBarPosition === 'bottom' ? <BrowserProgressBar /> : null}
      {addressBarPosition === 'bottom' ? (
        <AutoHideHeader position="bottom">
          <BookmarksBar />
          <BrowserHeader
            position="bottom"
            leadingSlot={<BrowserTabBadge onPress={openTabSwitcher} />}
            trailingSlot={<BrowserOverflowControls />}
          />
        </AutoHideHeader>
      ) : null}
      <BrowserToolbarDock swipeGesture={swipe.toolbar} />
      <BrowserTabSwitcher
        visible={tabSwitcherVisible}
        onClose={closeTabSwitcher}
        onLimitReached={handleTabsLimit}
      />
    </SafeAreaScreen>
  );
});

/** Thin page-coloured gap between the browser toolbar and the tab bar, so the two bars read as separate. */
const TOOLBAR_DOCK_GAP = 6;

/** B6: the floating scroll controls sit above the "Video available" bar. */
const PAGE_CONTROLS_BOTTOM = 84;

/**
 * The tab bar below already pads for the bottom safe area, so the dock adds none of that — only a thin gap
 * (TOOLBAR_DOCK_GAP) that keeps the toolbar and the tab bar from merging into one block.
 */
const BrowserToolbarDock = memo(function BrowserToolbarDock({ swipeGesture }: { swipeGesture: PanGesture }) {
  const theme = useTheme();

  return (
    <Box style={{ paddingBottom: TOOLBAR_DOCK_GAP, backgroundColor: theme.colors.background }}>
      <BrowserToolbar swipeGesture={swipeGesture} />
    </Box>
  );
});
