import * as Clipboard from 'expo-clipboard';

import { useBrowserStore } from '@/browser/stores';
import { navigation, routePaths } from '@/navigation';

import { requestAddressBarFocus } from './address-bar-focus';
import { decideClipboardPaste, type ClipboardPasteDecision } from './clipboard-link';
import { openPastedLink } from './pasted-link.service';
import { pendingNavigationService } from './pending-navigation.service';
import { announceYouTubeNotSupported } from './youtube-refusal';

/**
 * "Paste link" (Downloads, Home): opens the link the user copied exactly as if it were pasted into the address bar —
 * the direct analyzer reads the page first, then the active tab loads it. A YouTube link is refused with the usual
 * message and nothing loads. With no link on the clipboard, the browser opens with the address bar focused.
 */
export async function openLinkFromClipboard(): Promise<ClipboardPasteDecision> {
  let text = '';
  try {
    text = await Clipboard.getStringAsync();
  } catch {
    // Unreadable clipboard: same as an empty one.
  }

  const decision = decideClipboardPaste(text);
  if (decision.kind === 'youtube') {
    announceYouTubeNotSupported();
    return decision;
  }

  navigation.navigate(routePaths.browser);
  if (decision.kind === 'open') {
    const tabId = useBrowserStore.getState().activeTabId;
    if (!openPastedLink(decision.url, { source: 'omnibox', tabId })) {
      // The tab's WebView is not mounted yet: the Browser loads it when it gains focus.
      pendingNavigationService.set(decision.url, { targetTabId: tabId });
    }
    return decision;
  }

  requestAddressBarFocus();
  return decision;
}
