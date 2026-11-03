/**
 * B12 privacy controls — the app side. Settings rules are pure (privacy-settings.ts, https-upgrade.ts); this applies
 * them and talks to VidoraWeb for the active browser profile:
 *
 * - #112 Block all cookies: `setCookiesEnabled` at start, after every profile switch and when the setting changes
 *   (WebView keeps it only while the app runs). #113 third-party cookies are the WebView prop.
 * - #124 HTTPS-only: the hosts the user let through over http (this app run only), and the upgrades waiting for their
 *   first answer, so a failure can say "no secure version" instead of a generic error. A build without cleartext
 *   (release) is always secure-only.
 * - #130 Site data and the clear-data functions other packages use (Hamza's B11 incognito calls `clearAllSiteData`).
 * - #125 The certificate of the page a tab shows (Hamza's B19 Security panel reads `getPageCertificate`).
 */
import { getVidoraWeb, isVidoraWebAvailable, type PageCertificate, type SiteDataEntry } from '@modules/vidorax-web';

import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import { subscribeActiveProfile } from '@/storage/profile/active-profile';
import { useSettingsStore } from '@/store/settings';

import { httpPolicyFor, type HttpPolicy, type PendingUpgrade } from './https-upgrade';
import { normalizeCookiePolicy } from './privacy-settings';

function web() {
  return isVidoraWebAvailable() ? getVidoraWeb() : null;
}

/** #112: the active profile's cookie jar follows the setting. */
export async function applyCookiePolicy(): Promise<void> {
  const policy = normalizeCookiePolicy(useSettingsStore.getState().cookiePolicy);
  await web()?.setCookiesEnabled?.(policy !== 'block-all').catch(() => undefined);
}

let attached = false;

/** Idempotent; app start (after the browser profile is set up). */
export function ensurePrivacyControls(): void {
  if (attached) return;
  attached = true;
  void applyCookiePolicy();
  let last = useSettingsStore.getState().cookiePolicy;
  useSettingsStore.subscribe((state) => {
    if (state.cookiePolicy !== last) {
      last = state.cookiePolicy;
      void applyCookiePolicy();
    }
  });
  // The profile switch loads that profile's settings and moves WebView to its jar: the jar follows its setting.
  subscribeActiveProfile(() => {
    allowedHttpHosts.clear();
    pendingUpgrades.clear();
    setTimeout(() => void applyCookiePolicy(), 0);
  });
}

// --- #124 HTTPS-only -------------------------------------------------------------------------------------------

let cleartext: boolean | null = null;

/** Whether this build may open plain http (release may not). Asked once: it can't change while the app runs. */
export function cleartextAllowed(): boolean {
  if (cleartext == null) {
    try {
      cleartext = web()?.isCleartextAllowed?.() ?? true;
    } catch {
      cleartext = true;
    }
  }
  return cleartext;
}

export function currentHttpPolicy(): HttpPolicy {
  return httpPolicyFor(useSettingsStore.getState().httpsOnly === true, cleartextAllowed());
}

/** The error a page with no secure version shows: with the plain page on offer, or not when the build can't open it. */
export function noSecureVersionCode(): 'https_unavailable' | 'https_required' {
  return cleartextAllowed() ? 'https_unavailable' : 'https_required';
}

/** Hosts the user chose to open over http anyway, until the app closes. */
const allowedHttpHosts = new Set<string>();
/** https host → the http address it was upgraded from, when, and upgrades in a row, until that page answers. */
const pendingUpgrades = new Map<string, { from: string; at: number; count: number }>();
/** An http address for a host upgraded this recently is the secure page sending the browser back. */
const REDIRECT_BACK_MS = 15_000;
/** A failure this long after the upgrade is no longer read as "no secure version". */
const UPGRADE_ANSWER_MS = 90_000;

export function httpAllowedHosts(): ReadonlySet<string> {
  return allowedHttpHosts;
}

export function allowHttpForHost(host: string): void {
  allowedHttpHosts.add(host.toLowerCase());
}

export function noteHttpsUpgrade(httpsUrl: string, fromHttpUrl: string): void {
  try {
    const host = new URL(httpsUrl).hostname.toLowerCase();
    const now = Date.now();
    const previous = pendingUpgrades.get(host);
    const count = previous && now - previous.at < REDIRECT_BACK_MS ? previous.count + 1 : 1;
    pendingUpgrades.set(host, { from: fromHttpUrl, at: now, count });
    if (pendingUpgrades.size > 20) pendingUpgrades.delete(pendingUpgrades.keys().next().value as string);
  } catch {
    // Not a URL: nothing to remember.
  }
}

/** Upgrades of moments ago whose secure page hasn't loaded yet, by host. */
export function upgradingHosts(): ReadonlyMap<string, PendingUpgrade> {
  const now = Date.now();
  const hosts = new Map<string, PendingUpgrade>();
  for (const [host, entry] of pendingUpgrades) {
    if (now - entry.at < REDIRECT_BACK_MS) hosts.set(host, { from: entry.from, count: entry.count });
  }
  return hosts;
}

/** The http address an https page that failed to load was upgraded from (and forgets it), or null. */
export function takeFailedUpgrade(failingUrl: string | null | undefined): string | null {
  if (!failingUrl) return null;
  try {
    const parsed = new URL(failingUrl);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    const entry = pendingUpgrades.get(host);
    pendingUpgrades.delete(host);
    return entry && Date.now() - entry.at < UPGRADE_ANSWER_MS ? entry.from : null;
  } catch {
    return null;
  }
}

/**
 * An upgraded page finished: it has a secure version. `before`: only an upgrade noted by then (a newer one of the same
 * host is still waiting for its own answer).
 */
export function settleUpgrade(url: string | null | undefined, before = Number.POSITIVE_INFINITY): void {
  if (!url) return;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const entry = pendingUpgrades.get(host);
    if (entry && entry.at <= before) pendingUpgrades.delete(host);
  } catch {
    // ignore
  }
}

/** How long after a load end its upgrade is settled: Android reports a failed load's end just before its error. */
export const UPGRADE_SETTLE_DELAY_MS = 1500;

// --- #125 certificate, #130 site data --------------------------------------------------------------------------

export async function getPageCertificate(tabId: string): Promise<PageCertificate | null> {
  const viewTag = getTabWebViewTag(tabId);
  const api = web();
  if (viewTag == null || !api?.getCertificate) return null;
  return api.getCertificate(viewTag).catch(() => null);
}

export async function listSiteData(): Promise<SiteDataEntry[]> {
  const api = web();
  if (!api?.listSiteData) return [];
  const list = await api.listSiteData().catch(() => [] as SiteDataEntry[]);
  // WebView keeps listing a cleared origin with nothing in it: there is nothing to show or clear.
  return list.filter((entry) => entry.usage > 0).sort((a, b) => b.usage - a.usage);
}

/** After a clear: WebView's older delete (no DELETE_BROWSING_DATA) finishes a moment after it returns. */
export async function listSiteDataAfterClear(): Promise<SiteDataEntry[]> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return listSiteData();
}

export function cookieCountFor(url: string): number {
  try {
    return web()?.getCookieCount?.(url) ?? 0;
  } catch {
    return 0;
  }
}

/** One site's storage and cookies (both schemes of `host`). */
export async function clearSiteDataForHost(host: string): Promise<boolean> {
  const api = web();
  if (!api?.clearSiteData) return false;
  const results = await Promise.all(
    [`https://${host}`, `http://${host}`].map((origin) => api.clearSiteData!(origin).catch(() => false)),
  );
  return results.some(Boolean);
}

export async function clearSiteDataForOrigin(origin: string): Promise<boolean> {
  return (await web()?.clearSiteData?.(origin).catch(() => false)) ?? false;
}

/** Every site's cookies and storage in the active profile. */
export async function clearAllSiteData(): Promise<boolean> {
  return (await web()?.clearAllSiteData?.().catch(() => false)) ?? false;
}
