/**
 * Phase 6A — strip OAuth / auth secrets from URLs before app persistence.
 *
 * Website cookies stay in Android WebView CookieManager only.
 * App MMKV may store tab/session page URLs for restore — never raw cookies —
 * but callback URLs can embed short-lived auth secrets in the query string.
 * Strip those keys so app storage never retains them.
 */

/** Query keys that must never be written to app session/tab persistence. */
export const SENSITIVE_AUTH_QUERY_KEYS = [
  'code',
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'session',
  'session_state',
  'oauth_token',
  'auth',
  'authorization',
  'password',
  'passwd',
  'otp',
  'otp_code',
  'one_time_code',
  'client_secret',
  'assertion',
  'samlresponse',
  'wresult',
] as const;

const SENSITIVE_KEY_SET = new Set<string>(
  SENSITIVE_AUTH_QUERY_KEYS.map((k) => k.toLowerCase()),
);

/**
 * Returns a URL safe for MMKV / tab metadata persistence.
 * Preserves non-sensitive query params; drops auth secret keys only.
 * Never throws — invalid URLs pass through unchanged.
 */
export function stripSensitiveAuthQueryParams(url: string): string {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return trimmed;
    }

    let changed = false;
    const keys = [...parsed.searchParams.keys()];
    for (const key of keys) {
      if (SENSITIVE_KEY_SET.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }

    // Drop credentials if somehow present in the authority.
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      changed = true;
    }

    return changed ? parsed.toString() : trimmed;
  } catch {
    return trimmed;
  }
}

/** True when the URL query contains at least one sensitive auth key. */
export function urlContainsSensitiveAuthQuery(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_KEY_SET.has(key.toLowerCase())) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
