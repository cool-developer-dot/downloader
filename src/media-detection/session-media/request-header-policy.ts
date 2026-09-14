/**
 * Phase 6B — strict allowlist for ephemeral media request headers.
 * Authorization is CONDITIONAL and never auto-captured.
 */

export const SESSION_MEDIA_ALLOWED_HEADERS = [
  'accept',
  'referer',
  'user-agent',
  'cookie',
  'origin',
  'range',
] as const;

/** Never auto-attach; only if a future proven same-resource path exists. */
export const SESSION_MEDIA_CONDITIONAL_HEADERS = ['authorization'] as const;

export const SESSION_MEDIA_DENIED_HEADERS = [
  'proxy-authorization',
  'set-cookie',
  'host',
  'content-length',
  'connection',
  'sec-websocket-key',
  'sec-websocket-version',
] as const;

const ALLOWED = new Set<string>(SESSION_MEDIA_ALLOWED_HEADERS);
const DENIED = new Set<string>(SESSION_MEDIA_DENIED_HEADERS);

export function isAllowedSessionMediaHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (!lower || DENIED.has(lower)) {
    return false;
  }
  return ALLOWED.has(lower);
}

/**
 * Filter a header map to the Phase 6B allowlist.
 * Drops Authorization unless `allowAuthorization` is explicitly true.
 */
export function filterSessionMediaHeaders(
  headers: Record<string, string> | null | undefined,
  options?: { allowAuthorization?: boolean },
): Record<string, string> {
  if (!headers) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.trim().toLowerCase();
    if (!value?.trim()) {
      continue;
    }
    if (lower === 'authorization') {
      if (options?.allowAuthorization) {
        out[key.trim()] = value.trim();
      }
      continue;
    }
    if (!isAllowedSessionMediaHeader(key)) {
      continue;
    }
    out[key.trim()] = value.trim();
  }
  return out;
}

/** Remove secrets before caching / serializing request context. */
export function stripSecretRequestHeaders(
  headers: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.trim().toLowerCase();
    if (
      lower === 'cookie' ||
      lower === 'authorization' ||
      lower === 'set-cookie' ||
      lower === 'proxy-authorization'
    ) {
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}
