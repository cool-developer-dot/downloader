import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { getSearchEngine } from '@/browser/search/search-engines';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { isIncognitoInFront } from '@/browser/incognito/incognito-state';
import { handleSelectionAction, type SelectionActionOutcome } from '@/browser/selection/selection-actions';
import { SELECTION_READ_SCRIPT, splitSelectionResult } from '@/browser/selection/selection-read-script';
import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import type { SupportedLanguage } from '@/localization/config';
import { translate } from '@/localization';

/**
 * Light theme · Page tools — the "Selected text" chips act on what the user selected on the page in front. The
 * page's selection is read with B8's read script (`selection-read-script.ts`): the script is injected into the
 * tab's WebView and answers once on its own channel, `vidorax-page-selection`, with the request id it was given
 * (the same request / answer pattern as the page link grabber). Nothing from the app goes into the page beyond the
 * id.
 *
 * `handlePageSelectionMessage(tabId, raw)` takes the answer; the WebView's `onMessage` has to pass messages to it
 * (as it does for the reader, annotate and devtools channels). Until it does, a request times out and the chips say
 * "Select text on the page first".
 */

export const PAGE_SELECTION_CHANNEL = 'vidorax-page-selection' as const;
const MESSAGE_PREFIX = `{"channel":"${PAGE_SELECTION_CHANNEL}"`;
const MAX_TEXT = 20_000;

/** The script that reads the selection and posts it back with `requestId`. Fixed text; only the id goes in. */
export function buildPageSelectionScript(requestId: string): string {
  return `(function () {
  var text = '';
  try { text = ${SELECTION_READ_SCRIPT} } catch (e) { text = ''; }
  if (typeof text !== 'string') text = '';
  try {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ channel: ${JSON.stringify(PAGE_SELECTION_CHANNEL)}, payload: { requestId: ${JSON.stringify(requestId)}, text: text.slice(0, ${MAX_TEXT}) } }));
    }
  } catch (e) {}
})();
true;`;
}

/** The page's answer: the selected text (without B23's anchor tail), or null for anything else. */
export function parsePageSelectionMessage(raw: string): { requestId: string; text: string } | null {
  if (typeof raw !== 'string' || !raw.startsWith(MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw) as { channel?: unknown; payload?: { requestId?: unknown; text?: unknown } };
    if (parsed.channel !== PAGE_SELECTION_CHANNEL || !parsed.payload) return null;
    const { requestId, text } = parsed.payload;
    if (typeof requestId !== 'string' || typeof text !== 'string') return null;
    return { requestId, text: splitSelectionResult(text.slice(0, MAX_TEXT)).text };
  } catch {
    return null;
  }
}

type Pending = { tabId: string; resolve: (text: string | null) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();
let sequence = 0;

/** For the WebView's `onMessage`: true when `raw` was a selection answer (taken or stale). */
export function handlePageSelectionMessage(tabId: string | undefined, raw: string): boolean {
  const message = parsePageSelectionMessage(raw);
  if (!message) return false;
  const waiting = pending.get(message.requestId);
  if (!waiting || (tabId && waiting.tabId !== tabId)) return true;
  pending.delete(message.requestId);
  clearTimeout(waiting.timer);
  waiting.resolve(message.text);
  return true;
}

/**
 * The text selected on `tabId`'s page: '' when nothing is selected, null when the page did not answer in time
 * (no page, still loading, or the answer channel not wired).
 */
export function requestPageSelection(tabId: string, timeoutMs = 1_200): Promise<string | null> {
  const webView = tabControllerRegistry.get(tabId)?.webViewRef.current;
  if (!webView) return Promise.resolve(null);
  sequence += 1;
  const requestId = `sel-${Date.now().toString(36)}-${sequence}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, timeoutMs);
    pending.set(requestId, { tabId, resolve, timer });
    try {
      webView.injectJavaScript(buildPageSelectionScript(requestId));
    } catch {
      pending.delete(requestId);
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Google Translate with `text` typed in, in the app's language (the page version is `buildTranslatePageUrl`). */
export function buildTranslateTextUrl(text: string, language: SupportedLanguage): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 2_000);
  if (!trimmed) return null;
  return `https://translate.google.com/?sl=auto&tl=${language}&op=translate&text=${encodeURIComponent(trimmed)}`;
}

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/** Opens `url` in a new tab right after the tab in front and shows it (incognito stays incognito). */
export function openTabAfterCurrent(url: string, title: string): boolean {
  const store = useBrowserStore.getState();
  const outcome = store.openTabInBackground(url, { title, ...(isIncognitoInFront() ? { incognito: true } : {}) });
  if (outcome.status !== 'CREATED') {
    announceTabsLimitReached();
    return false;
  }
  useBrowserStore.getState().switchTab(outcome.tabId);
  return true;
}

/** B8's "Search" for the selected text, through `selection-actions.ts` with the browser's engine. */
export function searchSelection(text: string): SelectionActionOutcome {
  return handleSelectionAction(
    { viewTag: 0, itemId: 'search', text },
    {
      buildSearchUrl: (query) => getSearchEngine().buildSearchUrl(query),
      openTabAfterCurrent,
      notifyTruncated: () => notify(translate('browserSelection.searchTruncated')),
    },
  );
}
