import { buildBrowserUserAgent } from '@/browser/constants/user-agent';
import { isIncognitoInFront, liveIncognitoProfile } from '@/browser/incognito/incognito-state';
import { useBrowserStore } from '@/browser/stores';
import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import { translate } from '@/localization';
import { downloadThroughSystem } from '@/media-detection/adapters/native-network.adapter';

import { downloadableImageSrc } from './capture-core';
import { notify } from './capture.service';

/**
 * B17 #280 — long-press → "Download image": the picture's address through the app's existing system-download path
 * (`downloadThroughSystem`, the same handoff as the WebView's own downloads). From an incognito tab its session's
 * cookies are used (B11), never another profile's.
 */
export async function downloadImage(src: string, _pageUrl: string): Promise<void> {
  const url = downloadableImageSrc(src);
  if (!url) return;
  const state = useBrowserStore.getState();
  const tag = getTabWebViewTag(state.activeTabId) ?? -1;
  const webProfile = isIncognitoInFront() ? liveIncognitoProfile() : null;
  if (isIncognitoInFront() && !webProfile) return;
  notify(translate('browserCapture.downloadImageStarted'));
  await downloadThroughSystem({ url, userAgent: buildBrowserUserAgent(), viewTag: tag, webProfile });
}
