import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { useBrowserStore } from '@/browser/stores';
import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';

import { buildBackHistory, type BackHistoryEntry } from './back-history';

/** B6 #44: the earlier pages of the tab in front, from its WebView (empty for a parked tab or an older build). */
export async function loadActiveTabBackHistory(): Promise<BackHistoryEntry[]> {
  const tabId = useBrowserStore.getState().activeTabId;
  const viewTag = getTabWebViewTag(tabId);
  if (viewTag == null || !isVidoraWebAvailable()) return [];
  try {
    const history = await getVidoraWeb().getWebViewHistory?.(viewTag);
    return buildBackHistory(history ?? null);
  } catch {
    return [];
  }
}

/** Goes back `-steps` pages at once in the tab in front. */
export async function goBackInActiveTab(steps: number): Promise<boolean> {
  const tabId = useBrowserStore.getState().activeTabId;
  const viewTag = getTabWebViewTag(tabId);
  if (viewTag == null || steps >= 0 || !isVidoraWebAvailable()) return false;
  try {
    return (await getVidoraWeb().goBackOrForward?.(viewTag, steps)) === true;
  } catch {
    return false;
  }
}
