/**
 * B12 #124 HTTPS-only mode — the pure rules. With it on, a page asked for over `http://` is opened over `https://`
 * instead. If the site has no secure version, the browser says so and the user may open the plain page this once
 * (that site then stays allowed until the app closes). Local and intranet addresses are left alone: they rarely have
 * a certificate a phone trusts.
 *
 * A build that may not open plain http at all (release: no cleartext in the manifest, a product decision) is
 * 'secure-only': every http page is tried over https, local ones too, and nothing can be let through.
 */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** 'off': pages open as asked. 'upgrade': the HTTPS-only switch. 'secure-only': the build can't open http. */
export type HttpPolicy = 'off' | 'upgrade' | 'secure-only';

export function httpPolicyFor(httpsOnly: boolean, cleartextAllowed: boolean): HttpPolicy {
  if (!cleartextAllowed) return 'secure-only';
  return httpsOnly ? 'upgrade' : 'off';
}

export function isUpgradeExemptHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.lan') ||
    h.endsWith('.internal') ||
    IPV4.test(h) ||
    h.startsWith('[') ||
    !h.includes('.')
  );
}

/** The `https://` address to open instead of `url`, or null when it stays as it is. `allowed`: hosts the user let through. */
export function httpsUpgradeFor(url: string, allowed: ReadonlySet<string>, policy: HttpPolicy = 'upgrade'): string | null {
  if (policy === 'off') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!host) return null;
  if (policy === 'upgrade' && (isUpgradeExemptHost(host) || allowed.has(host))) return null;
  parsed.protocol = 'https:';
  if (parsed.port === '80') parsed.port = '';
  return parsed.toString();
}

export type HttpNavigation = { kind: 'allow' } | { kind: 'upgrade'; url: string } | { kind: 'no-secure-version' };

/** An https upgrade still waiting for its answer: the http address it came from, and upgrades of its host in a row. */
export type PendingUpgrade = { from: string; count: number };

/** This many upgrades of one host without a page loading in between is a redirect loop. */
export const MAX_UPGRADES_IN_A_ROW = 3;

function withoutHash(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * A main-frame navigation the page started. `upgrading`: recent upgrades by host. The secure page sending the browser
 * back to the very http address it was upgraded from, or round and round, means there is no working secure version —
 * upgrading again would loop. An http link to another page of that host is just upgraded.
 */
export function decideHttpNavigation(
  url: string,
  policy: HttpPolicy,
  allowed: ReadonlySet<string>,
  upgrading: ReadonlyMap<string, PendingUpgrade>,
): HttpNavigation {
  const upgraded = httpsUpgradeFor(url, allowed, policy);
  if (!upgraded) return { kind: 'allow' };
  const pending = upgrading.get(new URL(upgraded).hostname.toLowerCase());
  if (pending && (withoutHash(pending.from) === withoutHash(url) || pending.count >= MAX_UPGRADES_IN_A_ROW)) {
    return { kind: 'no-secure-version' };
  }
  return { kind: 'upgrade', url: upgraded };
}

/** Error pages that mean the connection wasn't secure: the lock and site info say so, not "secure". */
export function isSecurityFailure(code: string | null | undefined): boolean {
  return code === 'ssl_error' || code === 'https_unavailable' || code === 'https_required';
}
