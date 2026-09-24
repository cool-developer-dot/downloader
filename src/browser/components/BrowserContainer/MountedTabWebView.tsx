import { memo, useCallback, useRef } from 'react';
import { StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';

import { BrowserLinkActionSheet } from '@/browser/components/BrowserLinkActionSheet';
import { BrowserEngineProvider, useBrowserEngineContext } from '@/browser/engine';
import {
  useBrowserChromeBridge,
  useBrowserLongPressActions,
} from '@/browser/hooks';
import { useTabScopedBrowserEngine } from '@/browser/hooks/useTabScopedBrowserEngine';
import { useBrowserStore } from '@/browser/stores';

import { BrowserWebView } from './BrowserWebView';

export type MountedTabWebViewProps = {
  tabId: string;
  isActive: boolean;
  testID?: string;
};

/**
 * Stable no-op for parked tabs. An inline `() => undefined` gave the chrome
 * bridge (and therefore BrowserWebView's props) a new identity on every parent
 * render, defeating the memo and re-running the WebView's effects on every
 * progress tick.
 */
const noopLongPress = (): void => undefined;

const MountedTabWebViewBody = memo(function MountedTabWebViewBody({
  tabId,
  isActive,
  testID = 'browser-webview',
}: MountedTabWebViewProps) {
  const longPress = useBrowserLongPressActions();
  const lastPullAtRef = useRef(0);
  const { stopLoading, reload } = useBrowserEngineContext();

  const onPullToRefresh = useCallback(() => {
    if (!isActive) {
      return;
    }
    const now = Date.now();
    if (now - lastPullAtRef.current < 1000) {
      return;
    }
    lastPullAtRef.current = now;
    if (useBrowserStore.getState().isLoading) {
      stopLoading();
    }
    reload();
  }, [isActive, reload, stopLoading]);

  const chromeBridge = useBrowserChromeBridge({
    onLinkLongPress: isActive ? longPress.present : noopLongPress,
    onPullToRefresh,
    tabId,
    isActive,
  });

  return (
    <>
      <Box
        flex={1}
        style={isActive ? styles.visible : styles.hidden}
        pointerEvents={isActive ? 'auto' : 'none'}
        importantForAccessibility={isActive ? 'yes' : 'no-hide-descendants'}
        collapsable={false}>
        <BrowserWebView
          chromeBridge={chromeBridge}
          tabId={tabId}
          isActive={isActive}
          testID={isActive ? testID : `${testID}-parked-${tabId.slice(0, 8)}`}
        />
      </Box>
      {isActive ? (
        <BrowserLinkActionSheet
          visible={longPress.visible}
          title={longPress.title}
          subtitle={longPress.subtitle}
          actions={longPress.actions}
          onClose={longPress.dismiss}
        />
      ) : null}
    </>
  );
});

/**
 * One physical WebView for a mounted tab (active or parked inactive).
 * Nested engine provider scopes events to this tab.
 * React `key={tabId}` is set by BrowserContainer — never reuse by mount index.
 */
export const MountedTabWebView = memo(function MountedTabWebView({
  tabId,
  isActive,
  testID = 'browser-webview',
}: MountedTabWebViewProps) {
  const engine = useTabScopedBrowserEngine(tabId);

  return (
    <BrowserEngineProvider value={engine}>
      <MountedTabWebViewBody tabId={tabId} isActive={isActive} testID={testID} />
    </BrowserEngineProvider>
  );
});

const styles = StyleSheet.create({
  visible: {
    ...StyleSheet.absoluteFill,
    opacity: 1,
    zIndex: 2,
  },
  /**
   * Parked WebViews must not paint through on Android.
   * Opacity-only hiding leaves a native surface that can show Instagram while
   * chrome shows TikTok. Move off-screen + zero opacity.
   */
  hidden: {
    position: 'absolute',
    left: -10000,
    top: 0,
    right: undefined,
    bottom: undefined,
    width: '100%',
    height: '100%',
    opacity: 0,
    zIndex: 0,
  },
});
