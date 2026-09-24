/** Pure link extraction for links that arrive from outside VidoraX (a share, or a web link we were chosen for). */

const WEB_LINK_SCHEMES = ['http:', 'https:', 'about:'];

/**
 * Whether a link handed to the app by the system is a web page for the in-app browser rather than one of the app's
 * own routes (`vidorax://…`). VidoraX is registered for every http(s) link (the default-browser role); the
 * incoming-link service loads those into the active tab, so the router must not treat them as app routes.
 */
export function isBrowserWebLink(url: string | null | undefined): boolean {
  const trimmed = url?.trim().toLowerCase();
  if (!trimmed) {
    return false;
  }
  return WEB_LINK_SCHEMES.some((scheme) => trimmed.startsWith(scheme));
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+/i;
const BARE_HOST = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/;

export function urlFromSharedText(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) {
    return null;
  }
  const match = URL_IN_TEXT.exec(trimmed);
  if (match) {
    return match[0];
  }
  // A bare host shared by another app ("example.com/watch") is still a link the browser can load.
  return BARE_HOST.test(trimmed) ? `https://${trimmed}` : null;
}
