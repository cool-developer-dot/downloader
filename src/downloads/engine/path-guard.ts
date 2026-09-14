/**
 * Pure URI / filename confinement — no filesystem I/O.
 * Used by Open/Share/Rename/Play and by Node verifiers.
 */

export function stripUriQueryAndHash(uri: string): string {
  const withoutQuery = uri.split('?')[0] ?? uri;
  return withoutQuery.split('#')[0] ?? withoutQuery;
}

/**
 * True when `childUri` is the parent or a descendant.
 * Rejects prefix attacks (`/downloads/abc` vs `/downloads/abc-evil`).
 */
export function isUriInside(parentUri: string, childUri: string): boolean {
  const parent = stripUriQueryAndHash(parentUri).replace(/\/+$/, '');
  const child = stripUriQueryAndHash(childUri).replace(/\/+$/, '');
  if (!parent || !child) {
    return false;
  }
  const childParts = child.split('/');
  if (childParts.some((part) => part === '..')) {
    return false;
  }
  if (child === parent) {
    return true;
  }
  return child.startsWith(`${parent}/`);
}

/**
 * Logical on-disk basename for rename. Rejects traversal, absolute paths,
 * URI schemes, and dot-only names. Allows emoji, spaces, and long names
 * (callers still truncate via sanitizeFileName).
 */
export function isUnsafeLogicalFileName(raw: unknown): boolean {
  if (typeof raw !== 'string') {
    return true;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.length > 255) {
    return true;
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return true;
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return true;
  }
  if (trimmed === '.' || trimmed === '..' || /^\.+$/.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('..')) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('file:') ||
    lower.startsWith('content:') ||
    lower.startsWith('http:') ||
    lower.startsWith('https:')
  ) {
    return true;
  }
  if (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('~')) {
    return true;
  }
  return false;
}
