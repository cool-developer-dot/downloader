/**
 * The app's one website-fullscreen controller, bound to the real orientation lock and tab WebViews.
 * Imported by browser components — not by Node tests (they use createWebFullscreenController with fakes).
 */

import { buildBrowserExitFullscreenScript } from '@/browser/bridge';
import { logBrowserFullscreen } from '@/browser/diagnostics';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import {
  lockWebFullscreenOrientation,
  restoreWebFullscreenOrientation,
} from '@/player/orientation-controller';
import { ensurePlayerChromeRuntime } from '@/player/player-chrome.runtime';

import { createWebFullscreenController } from './web-fullscreen.controller';

const EXIT_FULLSCREEN_SCRIPT = buildBrowserExitFullscreenScript();

export const webFullscreen = createWebFullscreenController({
  lockOrientation: (orientation) => {
    ensurePlayerChromeRuntime();
    return lockWebFullscreenOrientation(orientation);
  },
  restoreOrientation: () => {
    ensurePlayerChromeRuntime();
    return restoreWebFullscreenOrientation();
  },
  requestPageExit: (tabId) => {
    try {
      tabControllerRegistry.get(tabId)?.webViewRef.current?.injectJavaScript(EXIT_FULLSCREEN_SCRIPT);
    } catch {
      // The WebView is already gone — so is its video view.
    }
  },
  log: logBrowserFullscreen,
});
