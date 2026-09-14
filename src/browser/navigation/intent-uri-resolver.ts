/**
 * Pure Android intent:// URI resolver.
 * Presentation/navigation policy only — no Linking, no WebView, no store.
 */

export type IntentResolutionType = 'WEB_FALLBACK' | 'EXTERNAL_APP' | 'BLOCKED';

export type IntentResolution =
  | {
      type: 'WEB_FALLBACK';
      url: string;
      packageName?: string;
      fingerprint: string;
      source: 'browser_fallback_url' | 'scheme_reconstruction';
    }
  | {
      type: 'EXTERNAL_APP';
      intentUri: string;
      packageName?: string;
      fingerprint: string;
    }
  | {
      type: 'BLOCKED';
      reason: string;
      fingerprint: string;
      packageName?: string;
    };

export type ParsedAndroidIntent = {
  raw: string;
  authorityPathQuery: string;
  host: string | null;
  pathWithQuery: string;
  scheme: string | null;
  packageName: string | null;
  action: string | null;
  browserFallbackUrl: string | null;
  fingerprint: string;
};

const INTENT_PREFIX = /^intent:/i;
const INTENT_SECTION = /#Intent;/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isHttpOrHttps(url: string): boolean {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isDangerousWebUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return (
    lower.startsWith('javascript:') ||
    lower.startsWith('file:') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('content:') ||
    lower.startsWith('intent:') ||
    lower.startsWith('view-source:')
  );
}

/**
 * App-link bounce hosts (e.g. applink.instagram.com) often re-emit intent://.
 * Generic detection — not Instagram-specific product logic.
 */
export function isAppLinkBounceHost(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return false;
  }
  return hostname.toLowerCase().startsWith('applink.');
}

export function isIntentScheme(url: string): boolean {
  return INTENT_PREFIX.test(url.trim());
}

/**
 * Build a stable identity for loop protection (no secrets).
 */
export function buildIntentFingerprint(parsed: {
  host: string | null;
  pathWithQuery: string;
  scheme: string | null;
  packageName: string | null;
  browserFallbackUrl: string | null;
}): string {
  const fallbackHost = (() => {
    if (!parsed.browserFallbackUrl) {
      return '';
    }
    try {
      return new URL(parsed.browserFallbackUrl).host.toLowerCase();
    } catch {
      return 'invalid-fallback';
    }
  })();
  return [
    (parsed.scheme ?? '').toLowerCase(),
    (parsed.host ?? '').toLowerCase(),
    parsed.pathWithQuery.split('#')[0] ?? '',
    (parsed.packageName ?? '').toLowerCase(),
    fallbackHost,
  ].join('|');
}

/**
 * Parse intent:// URI fields. Never executes extras / components.
 */
export function parseAndroidIntentUri(rawUrl: string): ParsedAndroidIntent | null {
  const raw = rawUrl.trim();
  if (!raw || !isIntentScheme(raw)) {
    return null;
  }

  const sectionMatch = INTENT_SECTION.exec(raw);
  const before = sectionMatch ? raw.slice(0, sectionMatch.index) : raw;
  const after = sectionMatch
    ? raw.slice(sectionMatch.index + sectionMatch[0].length)
    : '';

  // intent://HOST/PATH?QUERY  OR  intent:HOST/PATH (rare)
  let authorityPathQuery = before.replace(/^intent:/i, '');
  if (authorityPathQuery.startsWith('//')) {
    authorityPathQuery = authorityPathQuery.slice(2);
  }

  const slash = authorityPathQuery.indexOf('/');
  const host =
    slash >= 0 ? authorityPathQuery.slice(0, slash) : authorityPathQuery.split('?')[0] ?? '';
  const pathWithQuery = slash >= 0 ? authorityPathQuery.slice(slash) : '';

  let scheme: string | null = null;
  let packageName: string | null = null;
  let action: string | null = null;
  let browserFallbackUrl: string | null = null;

  for (const part of after.split(';')) {
    const token = part.trim();
    if (!token || token.toLowerCase() === 'end') {
      continue;
    }
    const eq = token.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = token.slice(0, eq).trim();
    const value = safeDecode(token.slice(eq + 1).trim());
    const keyLower = key.toLowerCase();

    if (keyLower === 'scheme') {
      scheme = value.toLowerCase().replace(/:$/, '');
    } else if (keyLower === 'package') {
      packageName = value;
    } else if (keyLower === 'action') {
      action = value;
    } else if (key === 'S.browser_fallback_url' || keyLower === 's.browser_fallback_url') {
      browserFallbackUrl = value;
    }
    // Deliberately ignore component=, category=, and other extras.
  }

  const parsed: ParsedAndroidIntent = {
    raw,
    authorityPathQuery,
    host: host || null,
    pathWithQuery,
    scheme,
    packageName,
    action,
    browserFallbackUrl,
    fingerprint: '',
  };
  parsed.fingerprint = buildIntentFingerprint(parsed);
  return parsed;
}

function reconstructHttpUrl(parsed: ParsedAndroidIntent): string | null {
  if (parsed.scheme !== 'http' && parsed.scheme !== 'https') {
    return null;
  }
  if (!parsed.host) {
    return null;
  }
  // Reject hosts that look like scheme smuggling.
  if (/[^\w.-]/.test(parsed.host) || parsed.host.includes('..')) {
    return null;
  }
  const path = parsed.pathWithQuery || '/';
  if (!path.startsWith('/')) {
    return null;
  }
  const candidate = `${parsed.scheme}://${parsed.host}${path}`;
  if (!isHttpOrHttps(candidate) || isDangerousWebUrl(candidate)) {
    return null;
  }
  try {
    // Normalize via URL parser.
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

/**
 * Resolve an Android intent:// URI into a safe browser action.
 * Prefer in-app HTTP(S) fallbacks. Never returns a raw intent for Linking.openURL.
 */
export function resolveAndroidIntentUri(rawUrl: string): IntentResolution {
  const parsed = parseAndroidIntentUri(rawUrl);
  if (!parsed) {
    return {
      type: 'BLOCKED',
      reason: 'malformed_intent',
      fingerprint: `blocked|${rawUrl.slice(0, 64)}`,
    };
  }

  // 1) Explicit browser fallback URL
  if (parsed.browserFallbackUrl) {
    const fallback = parsed.browserFallbackUrl.trim();
    if (isDangerousWebUrl(fallback) || !isHttpOrHttps(fallback)) {
      // Non-HTTP fallback is not safe for in-browser load.
      // May still allow EXTERNAL_APP if package/intent is resolvable.
      if (parsed.packageName || parsed.scheme) {
        return {
          type: 'EXTERNAL_APP',
          intentUri: parsed.raw,
          packageName: parsed.packageName ?? undefined,
          fingerprint: parsed.fingerprint,
        };
      }
      return {
        type: 'BLOCKED',
        reason: 'unsafe_browser_fallback',
        fingerprint: parsed.fingerprint,
        packageName: parsed.packageName ?? undefined,
      };
    }
    return {
      type: 'WEB_FALLBACK',
      url: fallback,
      packageName: parsed.packageName ?? undefined,
      fingerprint: parsed.fingerprint,
      source: 'browser_fallback_url',
    };
  }

  // 2) Reconstruct http(s)://host/path from scheme= + authority
  const reconstructed = reconstructHttpUrl(parsed);
  if (reconstructed) {
    return {
      type: 'WEB_FALLBACK',
      url: reconstructed,
      packageName: parsed.packageName ?? undefined,
      fingerprint: parsed.fingerprint,
      source: 'scheme_reconstruction',
    };
  }

  // 3) No safe web target — external app if intent has enough signal
  if (parsed.packageName || (parsed.scheme && parsed.scheme !== 'http' && parsed.scheme !== 'https')) {
    return {
      type: 'EXTERNAL_APP',
      intentUri: parsed.raw,
      packageName: parsed.packageName ?? undefined,
      fingerprint: parsed.fingerprint,
    };
  }

  // 4) Nothing safe
  return {
    type: 'BLOCKED',
    reason: 'unresolvable_intent',
    fingerprint: parsed.fingerprint,
    packageName: parsed.packageName ?? undefined,
  };
}
