/**
 * Phase 7A — completed filename sanitization.
 * Filename component only — never a filesystem path.
 */

const CONTROL_OR_RESERVED = /[<>:"|?*\u0000-\u001f]/g;
const MAX_BASE_LENGTH = 80;
const MAX_FILE_NAME_LENGTH = 120;

function stripUrlToSegment(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    // Never keep query/hash — signed tokens must not enter filenames.
    const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    return segment || '';
  } catch {
    return '';
  }
}

/**
 * Sanitize a single filename component for completed media.
 * Rejects traversal, reserved chars, control chars, and unbounded length.
 */
export function sanitizeCompletedFileName(raw: string | null | undefined): string {
  let name = typeof raw === 'string' ? raw : '';
  name = stripUrlToSegment(name);
  name = name.split('?')[0]?.split('#')[0] ?? name;
  name = name.replace(/[/\\]/g, '_');
  name = name.replace(CONTROL_OR_RESERVED, '_');
  name = name.replace(/\s+/g, ' ').trim();

  if (!name || name === '.' || name === '..') {
    return 'video';
  }

  // Collapse path-like traversal residues after slash/backslash rewrite.
  name = name.replace(/\.\./g, '_');
  name = name.replace(/^\.+/, '_');
  name = name.replace(/_+/g, '_');
  name = name.replace(/\s+/g, ' ').trim();

  if (!name || name === '.' || name === '..' || name === '_') {
    return 'video';
  }

  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const ext = hasExt ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) : '';
  let base = hasExt ? name.slice(0, dot) : name;
  base = base.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').replace(/_+/g, '_');
  base = base.replace(/^\.+/, '_').replace(/\.+$/, '');
  if (!base || base === '.' || base === '..' || base === '_') {
    base = 'video';
  }
  base = base.slice(0, MAX_BASE_LENGTH);

  const combined = ext ? `${base}.${ext}` : base;
  return combined.slice(0, MAX_FILE_NAME_LENGTH) || 'video';
}

/** Stem without extension (already sanitized). */
export function completedFileStem(fileName: string): string {
  const sanitized = sanitizeCompletedFileName(fileName);
  const dot = sanitized.lastIndexOf('.');
  if (dot > 0 && dot < sanitized.length - 1) {
    return sanitized.slice(0, dot);
  }
  return sanitized;
}

/** Extension without leading dot, or empty. */
export function completedFileExtension(fileName: string): string {
  const sanitized = sanitizeCompletedFileName(fileName);
  const dot = sanitized.lastIndexOf('.');
  if (dot <= 0 || dot === sanitized.length - 1) {
    return '';
  }
  return sanitized.slice(dot + 1).toLowerCase();
}

export function joinCompletedFileName(stem: string, extension: string): string {
  const safeStem = completedFileStem(stem || 'video');
  const ext = extension.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!ext) {
    return safeStem.slice(0, MAX_FILE_NAME_LENGTH);
  }
  const maxStem = Math.max(1, MAX_FILE_NAME_LENGTH - ext.length - 1);
  return `${safeStem.slice(0, maxStem)}.${ext}`;
}

export { MAX_BASE_LENGTH, MAX_FILE_NAME_LENGTH };
