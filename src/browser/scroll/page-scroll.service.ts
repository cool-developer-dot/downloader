import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { isBrowserHomeUrl } from '@/browser/utils';
import { useSettingsStore } from '@/store/settings';

import { scrollStepScript, scrollToEdgeScript } from './page-scroll-script';
import { normalizeScrollSpeed, scrollStepFraction } from './scroll-speed';

/** B6: runs one of the app's scroll scripts in the page in front. False when no web page is shown. */
export function runInActivePage(script: string): boolean {
  const { activeTabId, currentUrl } = useBrowserStore.getState();
  if (isBrowserHomeUrl(currentUrl)) return false;
  const webView = tabControllerRegistry.get(activeTabId)?.webViewRef.current;
  if (!webView) return false;
  try {
    webView.injectJavaScript(script);
    return true;
  } catch {
    return false;
  }
}

/** #46 / #47 Scroll to top / bottom. */
export function scrollActivePageToEdge(edge: 'top' | 'bottom'): boolean {
  return runInActivePage(scrollToEdgeScript(edge));
}

/** #240 / #53: one step down (1) or up (-1), as far as Scroll speed says. */
export function scrollActivePageStep(direction: 1 | -1): boolean {
  const speed = normalizeScrollSpeed(useSettingsStore.getState().scrollSpeed);
  return runInActivePage(scrollStepScript(direction, scrollStepFraction(speed)));
}
