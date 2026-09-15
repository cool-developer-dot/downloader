import {
  EXTENSION_TO_CONTAINER,
  EXTENSION_TO_MIME,
  MIME_TO_EXTENSION,
  PROGRESSIVE_AUDIO_EXTENSIONS,
  PROGRESSIVE_VIDEO_EXTENSIONS,
  STREAM_EXTENSIONS,
  WEAK_MEDIA_EXTENSIONS,
} from '../constants';
import type { MediaCategory, MediaContainer, StreamType } from '../types';
import { resolveVideoFormatHint } from '../resource/video-resource';

const VIDEO_SET = new Set<string>(PROGRESSIVE_VIDEO_EXTENSIONS);
const AUDIO_SET = new Set<string>(PROGRESSIVE_AUDIO_EXTENSIONS);
const STREAM_SET = new Set<string>(STREAM_EXTENSIONS);
const WEAK_SET = new Set<string>(WEAK_MEDIA_EXTENSIONS);

/**
 * Extract a file extension from a URL path (ignores query/hash).
 */
export function parseExtensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const last = pathname.split('/').pop() ?? '';
    const dot = last.lastIndexOf('.');
    if (dot <= 0 || dot === last.length - 1) {
      return null;
    }
    const ext = last.slice(dot + 1).replace(/[^a-z0-9]/g, '');
    return ext || null;
  } catch {
    return null;
  }
}

export function parseExtensionFromMime(mime: string | null | undefined): string | null {
  if (!mime) {
    return null;
  }
  const base = mime.split(';')[0]?.trim().toLowerCase();
  if (!base) {
    return null;
  }
  return MIME_TO_EXTENSION[base] ?? null;
}

export function resolveExtension(
  url: string,
  mimeType?: string | null,
): string | null {
  const format = resolveVideoFormatHint({ url, mimeType });
  if (format) return format === 'hls' ? 'm3u8' : format;
  return parseExtensionFromUrl(url) ?? parseExtensionFromMime(mimeType);
}

export function resolveContainer(extension: string | null): MediaContainer {
  if (!extension) {
    return 'unknown';
  }
  return EXTENSION_TO_CONTAINER[extension] ?? 'unknown';
}

export function resolveMimeType(
  extension: string | null,
  mimeType?: string | null,
): string | null {
  if (mimeType) {
    return mimeType.split(';')[0]?.trim().toLowerCase() || null;
  }
  if (!extension) {
    return null;
  }
  return EXTENSION_TO_MIME[extension] ?? null;
}

export function resolveCategory(
  container: MediaContainer,
  extension: string | null,
): MediaCategory | null {
  if (
    container === 'hls' ||
    container === 'dash' ||
    (extension != null && STREAM_SET.has(extension))
  ) {
    return 'stream';
  }
  if (
    VIDEO_SET.has(container) ||
    (extension != null && VIDEO_SET.has(extension))
  ) {
    return 'video';
  }
  if (
    AUDIO_SET.has(container) ||
    (extension != null && AUDIO_SET.has(extension))
  ) {
    return 'audio';
  }
  return null;
}

export function resolveStreamType(
  container: MediaContainer,
  category: MediaCategory | null,
): StreamType {
  if (container === 'hls') {
    return 'HLS';
  }
  if (container === 'dash') {
    return 'DASH';
  }
  if (category === 'stream') {
    return 'HLS';
  }
  return 'DIRECT';
}

export function isWeakMediaExtension(extension: string | null): boolean {
  return extension != null && WEAK_SET.has(extension);
}

/**
 * Candidate signal check — extension OR media MIME.
 * Weak extensions (.ts) require a verifying MIME (not extension alone).
 */
export function isSupportedMediaUrl(
  url: string,
  mimeType?: string | null,
): boolean {
  const fromMime = mimeType ? parseExtensionFromMime(mimeType) : null;
  if (fromMime != null) {
    return resolveCategory(resolveContainer(fromMime), fromMime) != null;
  }

  const extension = parseExtensionFromUrl(url);
  if (!extension) {
    return false;
  }

  if (isWeakMediaExtension(extension)) {
    return false;
  }

  return resolveCategory(resolveContainer(extension), extension) != null;
}

/** True when MIME alone proves media without path extension. */
export function isMediaMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) {
    return false;
  }
  const base = mimeType.split(';')[0]?.trim().toLowerCase();
  if (!base) {
    return false;
  }
  if (base.startsWith('video/')) {
    return true;
  }
  if (
    base === 'application/vnd.apple.mpegurl' ||
    base === 'application/x-mpegurl' ||
    base === 'audio/mpegurl' ||
    base === 'application/dash+xml'
  ) {
    return true;
  }
  if (base.startsWith('audio/') && parseExtensionFromMime(base) != null) {
    return true;
  }
  return false;
}
