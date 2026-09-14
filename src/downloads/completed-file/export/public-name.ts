/**
 * Phase 7C — public export display name + collision helpers (pure).
 */

const MAX_PUBLIC_NAME = 180;

/**
 * Build a sanitized public display name from Phase 7A fileName.
 * Never uses sourceUrl / signed query / auth material.
 */
export function resolvePublicExportName(input: {
  fileName: string | null | undefined;
  displayTitle?: string | null;
  mimeType?: string | null;
}): string {
  const raw = (input.fileName ?? '').trim();
  if (raw && !looksLikeUrl(raw)) {
    return clampName(sanitizeSegment(raw));
  }
  const title = (input.displayTitle ?? '').trim();
  if (title && !looksLikeUrl(title)) {
    const ext = extensionHint(input.fileName, input.mimeType);
    const stem = sanitizeSegment(title).replace(/\.[a-z0-9]{1,8}$/i, '');
    return clampName(ext ? `${stem}.${ext}` : stem || 'download.bin');
  }
  const ext = extensionHint(input.fileName, input.mimeType) || 'bin';
  return `download.${ext}`;
}

/**
 * Collision-safe next name: video.mp4 → video (1).mp4 → video (2).mp4
 * Never overwrites an unrelated public file.
 */
export function nextCollisionSafePublicName(
  baseName: string,
  attempt: number,
): string {
  if (attempt <= 0) {
    return baseName;
  }
  const dot = baseName.lastIndexOf('.');
  if (dot <= 0) {
    return `${baseName} (${attempt})`;
  }
  const stem = baseName.slice(0, dot);
  const ext = baseName.slice(dot);
  return `${stem} (${attempt})${ext}`;
}

export function buildMediaStoreMetadata(input: {
  displayName: string;
  mimeType: string;
  relativePath: string;
  sizeBytes?: number | null;
  completedAt?: string | null;
}): {
  displayName: string;
  mimeType: string;
  relativePath: string;
  sizeBytes: number | null;
  dateAddedMs: number | null;
} {
  return {
    displayName: resolvePublicExportName({ fileName: input.displayName }),
    mimeType: input.mimeType,
    relativePath: input.relativePath,
    sizeBytes:
      typeof input.sizeBytes === 'number' && Number.isFinite(input.sizeBytes)
        ? Math.max(0, Math.trunc(input.sizeBytes))
        : null,
    dateAddedMs: parseIsoMs(input.completedAt),
  };
}

function sanitizeSegment(value: string): string {
  return value
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '') || 'download';
}

function clampName(name: string): string {
  if (name.length <= MAX_PUBLIC_NAME) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  if (dot > 0 && name.length - dot <= 12) {
    const ext = name.slice(dot);
    return name.slice(0, MAX_PUBLIC_NAME - ext.length) + ext;
  }
  return name.slice(0, MAX_PUBLIC_NAME);
}

function looksLikeUrl(value: string): boolean {
  return /:\/\//.test(value) || /^https?/i.test(value);
}

function extensionHint(
  fileName: string | null | undefined,
  mimeType: string | null | undefined,
): string {
  const fromName = (fileName ?? '').trim();
  const dot = fromName.lastIndexOf('.');
  if (dot > 0 && dot < fromName.length - 1) {
    const ext = fromName.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(ext)) {
      return ext;
    }
  }
  const mime = (mimeType ?? '').toLowerCase();
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/mp2t') return 'ts';
  if (mime === 'audio/mp4') return 'm4a';
  if (mime === 'audio/mpeg') return 'mp3';
  return '';
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
