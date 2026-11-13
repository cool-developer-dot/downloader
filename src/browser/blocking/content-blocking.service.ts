import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import { useSettingsStore } from '@/store/settings';

import { createBlockingNative } from './blocking-native';
import { hostOf, matchingSite, parseSiteList } from './blocking-settings';

/**
 * B14 #121 / #114 — keeps VidoraWeb's ad and tracker rules in step with the settings (per browser profile: a profile
 * switch swaps the settings, and the new ones are sent), names each tab's page for "Allow ads on this site", and reads
 * the blocked count for the lock-icon panel.
 */

export const blockingNative = createBlockingNative(() => (isVidoraWebAvailable() ? getVidoraWeb() : null));

function sendRules(): void {
  const s = useSettingsStore.getState();
  blockingNative.setRules(s.adBlocker === true, s.trackerBlocker === true, parseSiteList(s.adAllowedSites));
}

let stop: (() => void) | null = null;

/** Idempotent; the browser screen starts it. */
export function ensureContentBlocking(): () => void {
  if (stop) return stop;
  sendRules();
  const unsubscribe = useSettingsStore.subscribe((next, previous) => {
    if (
      next.adBlocker !== previous.adBlocker ||
      next.trackerBlocker !== previous.trackerBlocker ||
      next.adAllowedSites !== previous.adAllowedSites
    ) {
      sendRules();
    }
  });
  stop = () => {
    unsubscribe();
    stop = null;
  };
  return stop;
}

/** BrowserWebView, when a page starts loading in a WebView. */
export function applyBlockingPage(viewTag: number | null, url: string): void {
  if (viewTag == null) return;
  blockingNative.setPage(viewTag, hostOf(url));
}

/** Requests blocked on the tab's current page. */
export function blockedCountForTab(tabId: string | null | undefined): Promise<number> {
  return blockingNative.blockedCount(tabId ? getTabWebViewTag(tabId) : null);
}

/** Whether "Allow ads on this site" covers `url`. */
export function adsAllowedOn(url: string, allowedSitesJson: string): boolean {
  return matchingSite(url, parseSiteList(allowedSitesJson)) != null;
}
