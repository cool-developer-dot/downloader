/**
 * Links that arrive from outside VidoraX: a share from another app, or a web link when VidoraX is the device's
 * browser. Both land in the active browser tab — the same place the address bar loads.
 */

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { urlFromSharedText } from './incoming-link';
import { isYouTubeLink, openPastedLink } from './pasted-link.service';
import { announceYouTubeNotSupported } from './youtube-refusal';

export { urlFromSharedText };

let attached = false;
let detach: (() => void) | null = null;

export function resetIncomingLinksForTests(): void {
  detach?.();
  detach = null;
  attached = false;
}

function open(text: string | null): void {
  const url = urlFromSharedText(text);
  // A shared or opened YouTube link is refused before the tab loads or fetches anything.
  if (url && isYouTubeLink(url)) {
    announceYouTubeNotSupported();
    return;
  }
  if (url) {
    // A shared link is a pasted link: the direct analyzer reads its page, then the active tab loads it.
    openPastedLink(url, { source: 'share' });
  }
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
    open(web.consumeSharedText());
  } catch {
    // No intent to read.
  }
  try {
    const subscription = web.addListener('onSharedText', ({ text }) => open(text));
    detach = () => subscription.remove();
  } catch {
    // Older module build without the event: the launch link still works.
  }
}
