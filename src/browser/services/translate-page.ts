import { isValidBrowserPageUrl } from '@/browser/utils';
import type { SupportedLanguage } from '@/localization/config';

/**
 * "Translate page" (browser menu): the page opened through Google Translate in a new tab. The only place VidoraX
 * sends a page address to a third party, and only when the user taps it (Privacy Policy, section 5).
 */
const GOOGLE_TRANSLATE_PAGE = 'https://translate.google.com/translate';

/** Google Translate's own pages, and the proxied copies of translated sites (`<site>.translate.goog`). */
export function isGoogleTranslatePage(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'translate.google.com' ||
      host.endsWith('.translate.goog') ||
      host === 'translate.googleusercontent.com'
    );
  } catch {
    return false;
  }
}

/**
 * The Google Translate address that shows `pageUrl` in the app's language, or null when there is nothing to
 * translate: the browser home, a non-web page, or a page that is already Google Translate.
 */
export function buildTranslatePageUrl(pageUrl: string, language: SupportedLanguage): string | null {
  const trimmed = pageUrl.trim();
  if (!isValidBrowserPageUrl(trimmed) || isGoogleTranslatePage(trimmed)) {
    return null;
  }
  return `${GOOGLE_TRANSLATE_PAGE}?sl=auto&tl=${language}&u=${encodeURIComponent(trimmed)}`;
}
