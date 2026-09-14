/**
 * mediaId is a logical download identity — never a filesystem path.
 */

const PATH_LIKE =
  /[/\\]|\.\.|file:|content:|https?:|^\s*$|\u0000/i;

/**
 * Validate and normalize a navigation mediaId.
 * Rejects path traversal, schemes, and empty values.
 */
export function assertSafeMediaId(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new Error('invalid_media_id');
  }
  const trimmed = raw.trim();
  if (!trimmed || PATH_LIKE.test(trimmed)) {
    throw new Error('invalid_media_id');
  }
  // Defense in depth: reject percent-encoded path separators.
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    throw new Error('invalid_media_id');
  }
  if (decoded !== trimmed && PATH_LIKE.test(decoded)) {
    throw new Error('invalid_media_id');
  }
  if (trimmed.length > 128) {
    throw new Error('invalid_media_id');
  }
  return trimmed;
}

export function parseRouteMediaId(
  raw: string | string[] | undefined,
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    return assertSafeMediaId(decodeURIComponent(value));
  } catch {
    return null;
  }
}
