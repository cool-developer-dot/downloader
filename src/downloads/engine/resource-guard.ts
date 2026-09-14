/**
 * Guardrails for what the progressive file downloader can honestly transfer.
 * HLS/playlists require a separate segment engine — refuse rather than fake.
 */

import { isPrivateOrLocalHostname } from '@/media-detection/utils/url';

const BLOCKED_EXTENSIONS = new Set(['m3u8', 'mpd', 'm3u']);

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const SAFE_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'mkv',
  'mp3',
  'm4a',
  'aac',
  'wav',
  'ogg',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'pdf',
  'bin',
]);

export function isPlaylistOrStreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname.toLowerCase();
    const ext = path.includes('.') ? path.split('.').pop() ?? '' : '';
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return true;
    }
    if (path.includes('.m3u8') || path.includes('.mpd')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Prefer verified analyze/5B transport metadata over URL extension alone.
 * HLS without `.m3u8` still routes to the HLS worker when streamType says so.
 * Progressive/AUDIO keep URL playlist detection as a safety net.
 */
export function shouldUseHlsTransfer(input: {
  sourceUrl: string;
  streamType?: string | null;
}): boolean {
  const streamType = input.streamType?.trim().toUpperCase() ?? '';
  if (streamType === 'HLS') {
    return true;
  }
  return isPlaylistOrStreamUrl(input.sourceUrl);
}

/**
 * Progressive transfer source must be http(s), well-formed, and non-SSRF.
 * Reuses media-detection private-host rules — does not log query/credentials.
 */
export function isSafeHttpUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 8_192) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('file:') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('about:')
  ) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (!parsed.hostname) {
      return false;
    }
    if (isPrivateOrLocalHostname(parsed.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip path traversal, reserved chars, query strings, and control characters.
 * Never trust remote titles/filenames directly.
 */
export function sanitizeFileName(raw: string): string {
  let name = typeof raw === 'string' ? raw.trim() : '';

  // If a full URL was passed, keep only the last path segment.
  if (/^https?:\/\//i.test(name)) {
    try {
      const parsed = new URL(name);
      const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
      name = segment || 'download.bin';
    } catch {
      name = 'download.bin';
    }
  }

  // Drop query/hash fragments that sometimes ride along remote filenames.
  name = name.split('?')[0]?.split('#')[0] ?? name;
  name = name.replace(/[/\\]/g, '_');
  name = name.replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  name = name.replace(/\s+/g, ' ').trim();

  // Block bare relative segments before stripping leading dots.
  if (!name || name === '.' || name === '..') {
    return 'download.bin';
  }

  name = name.replace(/^\.+/, '_');
  name = name.replace(/_+/g, '_');

  if (!name || name === '.' || name === '..' || name === '_') {
    return 'download.bin';
  }

  // Preserve extension when truncating long names.
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const ext = hasExt ? name.slice(dot + 1).toLowerCase().slice(0, 16) : '';
  const base = hasExt ? name.slice(0, dot) : name;
  const maxBase = Math.max(1, 180 - (ext ? ext.length + 1 : 0));
  const trimmedBase = base.slice(0, maxBase).trim() || 'download';
  const combined = ext ? `${trimmedBase}.${ext}` : trimmedBase;
  return combined || 'download.bin';
}

export function extensionOf(fileName: string): string {
  const cleaned = sanitizeFileName(fileName);
  const dot = cleaned.lastIndexOf('.');
  if (dot <= 0 || dot === cleaned.length - 1) {
    return '';
  }
  const ext = cleaned.slice(dot + 1).toLowerCase();
  return SAFE_EXTENSIONS.has(ext) || /^[a-z0-9]{1,16}$/.test(ext) ? ext : '';
}

export function extensionFromMime(mimeType: string | null | undefined): string {
  if (!mimeType?.trim()) {
    return '';
  }
  const key = mimeType.trim().split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_TO_EXT[key] ?? '';
}

export function extensionFromUrl(sourceUrl: string | null | undefined): string {
  if (!sourceUrl?.trim()) {
    return '';
  }
  try {
    const parsed = new URL(sourceUrl.trim());
    const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    return extensionOf(segment);
  } catch {
    return '';
  }
}

/**
 * Resolve a safe on-disk filename with extension priority:
 * 1) analyzed/provided fileName
 * 2) MIME type
 * 3) validated URL extension
 * 4) safe fallback (.bin)
 */
export function resolveDownloadFileName(input: {
  fileName?: string | null;
  mimeType?: string | null;
  sourceUrl?: string | null;
}): string {
  const sanitized = sanitizeFileName(input.fileName?.trim() || 'download');
  let ext = extensionOf(sanitized);
  if (!ext) {
    ext = extensionFromMime(input.mimeType);
  }
  if (!ext) {
    ext = extensionFromUrl(input.sourceUrl);
  }
  if (!ext) {
    ext = 'bin';
  }

  if (extensionOf(sanitized)) {
    return sanitized;
  }

  const base =
    sanitized === 'download.bin' || sanitized === 'download'
      ? 'download'
      : sanitized;
  return sanitizeFileName(`${base}.${ext}`);
}

export function mimeFromFileName(fileName: string | null | undefined): string | null {
  const ext = extensionOf(fileName ?? '');
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mkv':
      return 'video/x-matroska';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    default:
      return null;
  }
}
