/**
 * B6 #55 Page preloading (Browser settings → Navigation → Preload pages: Off / Wi-Fi only (default) / Always).
 * Two cheap preloads, never a hidden page load:
 * - the address bar's top suggestion, while typing, has its host looked up ahead (`VidoraWeb.prefetchDns`);
 * - a page that names its next page (`<link rel="next">` / `<a rel="next">`, e.g. page 2 of a list) gets a
 *   `<link rel="prefetch">` for it, same site only, so following it comes from the cache.
 * Both are off while Data saver or Battery saver is on (B18) and without a network. Pure.
 */

export type PreloadPages = 'off' | 'wifi' | 'always';

export const PRELOAD_PAGES_CHOICES: readonly PreloadPages[] = ['off', 'wifi', 'always'];
export const DEFAULT_PRELOAD_PAGES: PreloadPages = 'wifi';

export function normalizePreloadPages(value: unknown): PreloadPages {
  return value === 'off' || value === 'always' ? value : DEFAULT_PRELOAD_PAGES;
}

export type PreloadNetwork = {
  connected: boolean;
  /** NetInfo's type, lower case: wifi, ethernet, cellular, … */
  type: string;
  /** Metered (NetInfo `details.isConnectionExpensive`). */
  expensive: boolean;
};

export function preloadAllowed(setting: PreloadPages, network: PreloadNetwork, saverOn: boolean): boolean {
  if (setting === 'off' || saverOn || !network.connected) return false;
  if (setting === 'always') return true;
  return (network.type === 'wifi' || network.type === 'ethernet') && !network.expensive;
}

/** Suggestion kinds that open a page (a search row's engine is looked up anyway). */
const PAGE_KINDS = new Set(['exact_url', 'history', 'bookmark', 'frequent', 'domain']);

/** The host to look up for the top suggestion, or null. */
export function prefetchHostFor(suggestion: { kind: string; url: string } | null | undefined): string | null {
  if (!suggestion || !PAGE_KINDS.has(suggestion.kind)) return null;
  try {
    const url = new URL(suggestion.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname || null;
  } catch {
    return null;
  }
}

/** Run in a page after it loaded (once): prefetches its same-site next page, if it names one. */
export const NEXT_PAGE_PREFETCH_SCRIPT = `(function () {
try {
  if (window.__vidoraxNextPrefetch) return;
  try { Object.defineProperty(window, '__vidoraxNextPrefetch', { value: true }); } catch (e) { window.__vidoraxNextPrefetch = true; }
  var el = document.querySelector('link[rel~="next"][href], a[rel~="next"][href]');
  if (!el) return;
  var next = new URL(el.getAttribute('href'), location.href);
  if ((next.protocol !== 'https:' && next.protocol !== 'http:') || next.origin !== location.origin) return;
  if (next.href.split('#')[0] === location.href.split('#')[0]) return;
  var link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = next.href;
  (document.head || document.documentElement).appendChild(link);
} catch (e) {}
})();
true;`;
