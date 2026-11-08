/**
 * B14 — Ad, tracker and site blocking: the settings and their pure rules. Imported by the settings store, the backup
 * code and the tests under Node, so it has no React Native imports.
 *
 * Sites are kept as `siteKey` gives them (lowercase host, no `www.`) and a site covers its subdomains, the same for
 * every B14 list: "Allow ads on this site", autoplay per site, the site blocker, time limits and focus mode.
 */
import { siteKey } from '../privacy/privacy-settings';

// ---- Ads and trackers (#121, #114) ----

/** "Allow ads on this site" entries kept (settings `adAllowedSites`, JSON list). */
export const MAX_AD_ALLOWED_SITES = 300;
export const DEFAULT_AD_ALLOWED_SITES_JSON = '[]';

// ---- Autoplay (#187, #218) ----

/**
 * - `allow`: pages may start video and sound by themselves (WebView `mediaPlaybackRequiresUserAction` off).
 * - `sound`: **today's behaviour** (the default): WebView needs a tap before anything plays with sound; muted videos
 *   may start by themselves.
 * - `all`: nothing starts until the user taps, muted videos included (a document-start page script on top of `sound`).
 */
export const AUTOPLAY_POLICIES = ['allow', 'sound', 'all'] as const;
export type AutoplayPolicy = (typeof AUTOPLAY_POLICIES)[number];
export const DEFAULT_AUTOPLAY: AutoplayPolicy = 'sound';
export const MAX_AUTOPLAY_SITES = 300;
export const DEFAULT_AUTOPLAY_SITES_JSON = '{}';

export function normalizeAutoplay(value: unknown): AutoplayPolicy {
  return (AUTOPLAY_POLICIES as readonly unknown[]).includes(value) ? (value as AutoplayPolicy) : DEFAULT_AUTOPLAY;
}

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;

/** A site typed by the user ("www.Example.com/page", "https://m.example.com") → "example.com" / "m.example.com". */
export function siteFromInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const asUrl = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  return siteKey(asUrl);
}

/** The host of a web address, lowercase, without `www.` (null for anything that isn't http(s)). */
export function hostOf(url: string | null | undefined): string | null {
  return siteKey(url ?? null);
}

/** Whether `site` covers `host` (both lowercase, no `www.`): the same host or a subdomain. */
export function siteCovers(site: string, host: string): boolean {
  return host === site || host.endsWith(`.${site}`);
}

/** The most specific site in `sites` that covers `url`'s host (the longest), or null. */
export function matchingSite(url: string | null | undefined, sites: Iterable<string>): string | null {
  const host = hostOf(url);
  if (!host) return null;
  let best: string | null = null;
  for (const site of sites) {
    if (siteCovers(site, host) && (best == null || site.length > best.length)) best = site;
  }
  return best;
}

/** A JSON list of sites (deduplicated, valid hosts only, at most `max`). */
export function parseSiteList(raw: unknown, max = MAX_AD_ALLOWED_SITES): string[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const site = item.trim().toLowerCase().replace(/^www\./, '');
    if (HOSTNAME.test(site) && !out.includes(site)) out.push(site);
    if (out.length >= max) break;
  }
  return out;
}

export function serializeSiteList(list: readonly string[], max = MAX_AD_ALLOWED_SITES): string {
  return JSON.stringify(parseSiteList([...list], max));
}

/** A JSON object site → autoplay policy (valid hosts and policies only, at most MAX_AUTOPLAY_SITES). */
export function parseAutoplaySites(raw: unknown): Record<string, AutoplayPolicy> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, AutoplayPolicy> = {};
  let count = 0;
  for (const [key, policy] of Object.entries(value as Record<string, unknown>)) {
    const site = key.trim().toLowerCase().replace(/^www\./, '');
    if (!HOSTNAME.test(site) || !(AUTOPLAY_POLICIES as readonly unknown[]).includes(policy)) continue;
    if (!(site in out)) count += 1;
    out[site] = policy as AutoplayPolicy;
    if (count >= MAX_AUTOPLAY_SITES) break;
  }
  return out;
}

export function serializeAutoplaySites(sites: Readonly<Record<string, AutoplayPolicy>>): string {
  return JSON.stringify(parseAutoplaySites({ ...sites }));
}

/** `sites` with `site` set to `policy`, or removed with null. */
export function withAutoplayForSite(
  sites: Readonly<Record<string, AutoplayPolicy>>,
  site: string,
  policy: AutoplayPolicy | null,
): Record<string, AutoplayPolicy> {
  const next = { ...sites };
  if (policy == null) delete next[site];
  else next[site] = policy;
  return next;
}

/**
 * The autoplay policy for a page: the most specific per-site choice wins; otherwise Data saver (B18's
 * `dataSaverWantsNoAutoplay` hook) makes it `all`; otherwise the global choice.
 */
export function resolveAutoplay(
  url: string | null | undefined,
  global: AutoplayPolicy,
  sites: Readonly<Record<string, AutoplayPolicy>>,
  dataSaverNoAutoplay: boolean,
): AutoplayPolicy {
  const site = matchingSite(url, Object.keys(sites));
  if (site) return sites[site];
  if (dataSaverNoAutoplay) return 'all';
  return global;
}

/** WebView's `mediaPlaybackRequiresUserAction` for a policy (true = today's). */
export function autoplayNeedsTap(policy: AutoplayPolicy): boolean {
  return policy !== 'allow';
}

/**
 * "Block all": no audio or video starts until the user taps — muted autoplay included. `play()` is refused (as the
 * browser refuses autoplay, `NotAllowedError`) and anything that starts by itself (the `autoplay` attribute) is paused
 * at once, unless the page has a user tap right now (`navigator.userActivation`, or a tap in the last 5 s on WebViews
 * without it). An element the user started may play again (resume after buffering, next track). A fixed script: no
 * data from the app. Works with B3's tab-audio wrapper in either order (each calls the `play` it replaced).
 */
export const AUTOPLAY_BLOCK_ALL_SCRIPT = `(function () {
  try {
    var P = window.HTMLMediaElement && HTMLMediaElement.prototype;
    if (!P || window.__vidoraxAutoplayBlock) return;
    window.__vidoraxAutoplayBlock = true;
    var started = new WeakSet();
    var lastTap = 0;
    var tapped = function () { lastTap = Date.now(); };
    ['pointerdown', 'touchend', 'mousedown', 'keydown', 'click'].forEach(function (type) {
      window.addEventListener(type, tapped, true);
    });
    var userActive = function () {
      var ua = navigator.userActivation;
      if (ua && ua.isActive) return true;
      return Date.now() - lastTap < 5000;
    };
    var allowed = function (el) {
      if (started.has(el)) return true;
      if (userActive()) {
        started.add(el);
        return true;
      }
      return false;
    };
    var play = P.play;
    if (typeof play === 'function') {
      P.play = function () {
        if (allowed(this)) return play.apply(this, arguments);
        var error;
        try {
          error = new DOMException('Autoplay is blocked until you tap', 'NotAllowedError');
        } catch (e) {
          error = new Error('NotAllowedError');
        }
        return Promise.reject(error);
      };
    }
    document.addEventListener('play', function (event) {
      var el = event.target;
      if (!el || !(el instanceof HTMLMediaElement) || allowed(el)) return;
      try { el.pause(); } catch (e) {}
    }, true);
  } catch (e) {}
})();`;
