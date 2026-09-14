import { memo } from 'react';
import { StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';

import { BrowserErrorView } from '@/browser/components/BrowserErrorView';
import { BrowserHomeView } from '@/browser/components/BrowserHome';
import { selectIsHome, selectBrowserError, useBrowserStore } from '@/browser/stores';

import { MountedTabWebView } from './MountedTabWebView';

export type BrowserContainerProps = {
  testID?: string;
};

/**
 * WebView rendering surface + home landing + error overlay.
 * Phase 3B: up to maxMountedWebViews physical WebViews via mount pool.
 */
export const BrowserContainer = memo(function BrowserContainer({
  testID = 'browser-container',
}: BrowserContainerProps) {
  const isHome = useBrowserStore(selectIsHome);
  const hasError = useBrowserStore(selectBrowserError) != null;
  const mountedTabIds = useBrowserStore((s) => s.mountedTabIds);
  const activeTabId = useBrowserStore((s) => s.activeTabId);

  return (
    <Box testID={testID} flex={1} style={{ position: 'relative' }}>
      <Box
        flex={1}
        style={
          isHome
            ? styles.hiddenWebView
            : hasError
              ? styles.errorHiddenWebView
              : styles.visibleWebView
        }
        pointerEvents={isHome || hasError ? 'none' : 'auto'}
        importantForAccessibility={
          isHome || hasError ? 'no-hide-descendants' : 'yes'
        }>
        {mountedTabIds.map((tabId) => (
          <MountedTabWebView
            key={tabId}
            tabId={tabId}
            isActive={tabId === activeTabId}
          />
        ))}
      </Box>

      {isHome ? <BrowserHomeView /> : null}
      {!isHome ? <BrowserErrorView /> : null}
    </Box>
  );
});

const styles = StyleSheet.create({
  visibleWebView: {
    ...StyleSheet.absoluteFill,
    opacity: 1,
    zIndex: 0,
  },
  hiddenWebView: {
    ...StyleSheet.absoluteFill,
    opacity: 0,
    zIndex: 0,
  },
  errorHiddenWebView: {
    ...StyleSheet.absoluteFill,
    opacity: 0,
    zIndex: 0,
  },
});
