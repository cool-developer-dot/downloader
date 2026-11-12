import { useEffect } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';

import { useBrowserStore } from '@/browser/stores';
import { routePaths } from '@/navigation/constants/route-paths';

import { webFullscreen } from './web-fullscreen.runtime';

/**
 * Takes a website's video out of fullscreen when the Browser stops being what the user sees: another tab becomes
 * active, the tab switcher opens, the app goes to the background, or another route opens (the video view sits on top
 * of every screen, so it must not outlive the Browser).
 */
export function useWebFullscreenLifecycle(tabSwitcherVisible: boolean): void {
  const pathname = usePathname();
  const isBrowserRoute = pathname === routePaths.browser;

  useEffect(
    () =>
      useBrowserStore.subscribe((state, previous) => {
        if (state.activeTabId !== previous.activeTabId) {
          webFullscreen.leaveUnlessActiveTab(state.activeTabId);
        }
      }),
    [],
  );

  useEffect(() => {
    if (tabSwitcherVisible) {
      webFullscreen.leave('tab_switcher');
    }
  }, [tabSwitcherVisible]);

  useEffect(() => {
    if (!isBrowserRoute) {
      webFullscreen.leave('route');
    }
  }, [isBrowserRoute]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        webFullscreen.leave('background');
      }
    });
    return () => {
      subscription.remove();
      webFullscreen.leave('route');
    };
  }, []);
}
