/**
 * Links that arrive from outside VidoraX: a share from another app, or a web link when VidoraX is the device's
 * browser. Both land in the active browser tab — the same place the address bar loads.
 */

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { navigation, routePaths } from '@/navigation';
import { noteTourLinkOpened } from '@/tour/tour-store';

import { urlFromSharedText } from './incoming-link';
import { isYouTubeLink, openPastedLink } from './pasted-link.service';
import { announceYouTubeNotSupported } from './youtube-refusal';

export { urlFromSharedText };

let attached = false;
let detach: (() => void) | null = null;
// B21 #233: whether the app was started by a link (it then wins over the startup option).
let openedLaunchLink = false;

/** B21: true when the link the app was launched with was opened (read once, after ensureIncomingLinkHandling). */
export function didOpenLaunchLink(): boolean {
  return openedLaunchLink;
}

export function resetIncomingLinksForTests(): void {
  detach?.();
  detach = null;
  attached = false;
}

/**
 * @param bringForward A link that arrives while VidoraX runs (a share, a web link while another tab or a pushed screen
 *   is in front) shows the Browser tab at its page: without it the link loaded unseen and nothing seemed to happen.
 *   The launch link needs nothing — the app starts on the browser anyway, before navigation is ready.
 */
function open(text: string | null, bringForward = false): boolean {
  const url = urlFromSharedText(text);
  // A shared or opened YouTube link is refused before the tab loads or fetches anything.
  if (url && isYouTubeLink(url)) {
    announceYouTubeNotSupported();
    return false;
  }
  if (url) {
    // What the user came for: the first-launch tour waits for a calmer moment.
    noteTourLinkOpened();
    // A shared link is a pasted link: the direct analyzer reads its page, then the active tab loads it.
    openPastedLink(url, { source: 'share' });
    if (bringForward) {
      // The Browser tab, popped to its page (the module's other screens close): where the link is loading.
      navigation.navigate(routePaths.browser);
    }
    return true;
  }
  return false;
}

/**
 * Idempotent. Reads the link the app was launched with, then keeps listening for links that arrive while it
 * runs. A build without the native module simply has no incoming links.
 */
export function ensureIncomingLinkHandling(): void {
  if (attached || !isVidoraWebAvailable()) {
    return;
  }
  attached = true;
  const web = getVidoraWeb();
  try {
    openedLaunchLink = open(web.consumeSharedText());
  } catch {
    // No intent to read.
  }
  try {
    const subscription = web.addListener('onSharedText', ({ text }) => {
      open(text, true);
    });
    detach = () => subscription.remove();
  } catch {
    // Older module build without the event: the launch link still works.
  }
}
