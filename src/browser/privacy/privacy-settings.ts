/**
 * B12 privacy settings — the pure rules. Every value is per browser profile (they are BROWSER_SETTING_KEYS, B20).
 *
 * - #112 / #113 Cookies: allow all, block third-party (default: a site embedded in another can't read or set its
 *   cookies there), or block all.
 * - #135 JavaScript: on for every site (default) or off, and a list of sites that are the other way round
 *   (`javaScriptExceptions`, a JSON array of hosts, at most {@link MAX_JAVASCRIPT_EXCEPTIONS}).
 */

export const COOKIE_POLICIES = ['allow-all', 'block-third-party', 'block-all'] as const;
export type CookiePolicy = (typeof COOKIE_POLICIES)[number];
export const DEFAULT_COOKIE_POLICY: CookiePolicy = 'block-third-party';

export function normalizeCookiePolicy(value: unknown): CookiePolicy {
  return typeof value === 'string' && (COOKIE_POLICIES as readonly string[]).includes(value)
    ? (value as CookiePolicy)
    : DEFAULT_COOKIE_POLICY;
}

export const MAX_JAVASCRIPT_EXCEPTIONS = 200;
export const DEFAULT_JAVASCRIPT_EXCEPTIONS_JSON = '[]';

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** The site a page belongs to for its settings: its host, lowercase, without a leading `www.`; null for non-web pages. */
export function siteKey(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return HOSTNAME.test(host) ? host : null;
}

export function parseJavaScriptExceptions(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const host = item.trim().toLowerCase().replace(/^www\./, '');
    if (HOSTNAME.test(host)) seen.add(host);
    if (seen.size >= MAX_JAVASCRIPT_EXCEPTIONS) break;
  }
  return [...seen];
}

export function serializeJavaScriptExceptions(hosts: readonly string[]): string {
  return JSON.stringify(parseJavaScriptExceptions([...hosts]));
}

/** Whether pages of `url`'s site run JavaScript: the default, flipped for a listed site. Non-web pages: the default. */
export function isJavaScriptAllowed(url: string | null | undefined, javaScript: boolean, exceptions: readonly string[]): boolean {
  const site = siteKey(url);
  return site !== null && exceptions.includes(site) ? !javaScript : javaScript;
}

/** The exception list after the user sets JavaScript on or off for one site. */
export function withJavaScriptForSite(
  exceptions: readonly string[],
  site: string,
  allowed: boolean,
  javaScript: boolean,
): string[] {
  const rest = exceptions.filter((host) => host !== site);
  return allowed === javaScript ? rest : [...rest, site].slice(-MAX_JAVASCRIPT_EXCEPTIONS);
}
