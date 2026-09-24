import { libraryLog } from './diagnostics';
import { isLibraryCandidate } from './eligibility';
import type { LibraryBuildSource, LocalAvailability, MediaLibraryItem } from './types';

const DISPLAY_NAME_MAX = 255;
const FILE_NAME_MAX = 255;
const QUALITY_MAX = 64;

const MIME_FROM_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

function mimeFromFileName(fileName: string | null): string | null {
  if (!fileName) {
    return null;
  }
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) {
    return null;
  }
  const ext = fileName.slice(dot + 1).toLowerCase();
  return MIME_FROM_EXT[ext] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeOptionalString(
  value: unknown,
  maxLength = DISPLAY_NAME_MAX,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

export function normalizeByteSize(value: unknown): string {
  if (typeof value === 'bigint') {
    return value < 0n ? '0' : value.toString();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return '0';
}

export function parseByteSize(value: string | null | undefined): bigint {
  if (!value || !/^\d+$/.test(value)) {
    return 0n;
  }
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function normalizeIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export function normalizeQuality(value: unknown): string | null {
  return normalizeOptionalString(value, QUALITY_MAX);
}

export function normalizeResolution(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/i.exec(trimmed);
  if (!match) {
    return null;
  }
  return `${match[1]}x${match[2]}`;
}

export function normalizeBitrate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}

export function normalizeDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

export function normalizeMimeType(
  mimeType: unknown,
  fileName: string | null,
): string | null {
  if (typeof mimeType === 'string' && mimeType.trim()) {
    const trimmed = mimeType.trim().toLowerCase();
    if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(trimmed)) {
      return trimmed;
    }
  }
  return mimeFromFileName(fileName);
}

/**
 * Remote HTTP(S) thumbnail only. Device paths and content URIs are dropped.
 */
const OWN_THUMBNAIL = /^file:\/\/\/.*\/files\/thumbs\/[^/]+\.webp$/i;

export function normalizeThumbnailUri(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  // A thumbnail VidoraX generated for its own library file (`filesDir/thumbs/<id>.webp`): local, private, and
  // ours to show. Any other local path is still refused below.
  if (OWN_THUMBNAIL.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // Any other local path is not a thumbnail this app produced.
    if (parsed.pathname.startsWith('/data/')) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

export function resolveDisplayName(
  title: string | null,
  fileName: string | null,
): string | null {
  if (title) {
    return title;
  }
  if (fileName) {
    return fileName;
  }
  return null;
}

function resolveAvailability(
  availability: LocalAvailability | null | undefined,
): LocalAvailability {
  if (
    availability === 'available' ||
    availability === 'missing' ||
    availability === 'unverified'
  ) {
    return availability;
  }
  return 'unverified';
}

/**
 * Convert a completed-download snapshot into a canonical library item.
 * Returns null for malformed / ineligible records — never throws.
 */
export function mapToMediaLibraryItem(
  raw: LibraryBuildSource | Record<string, unknown> | null | undefined,
): MediaLibraryItem | null {
  if (!raw || !isRecord(raw)) {
    libraryLog('library.invalid_record', { reason: 'not-object' }, 'warn');
    return null;
  }

  const downloadId =
    typeof raw.downloadId === 'string' && raw.downloadId.trim()
      ? raw.downloadId.trim()
      : typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : null;

  const status = typeof raw.status === 'string' ? raw.status : null;
  const fileName = normalizeOptionalString(raw.fileName, FILE_NAME_MAX);
  const localUri = typeof raw.localUri === 'string' ? raw.localUri : null;
  const localState = typeof raw.localState === 'string' ? raw.localState : null;

  if (
    !isLibraryCandidate({
      downloadId,
      status,
      fileName,
      localUri,
      localState,
    })
  ) {
    return null;
  }

  const title = normalizeOptionalString(raw.title, DISPLAY_NAME_MAX);
  const displayName = resolveDisplayName(title, fileName);
  if (!displayName || !fileName || !downloadId) {
    libraryLog(
      'library.invalid_record',
      { reason: 'missing-identity-or-name', downloadId: downloadId ?? 'unknown' },
      'warn',
    );
    return null;
  }

  const verifiedBytes =
    typeof raw.verifiedBytes === 'number' &&
    Number.isFinite(raw.verifiedBytes) &&
    raw.verifiedBytes > 0
      ? Math.trunc(raw.verifiedBytes)
      : null;

  const fileSize =
    verifiedBytes != null
      ? normalizeByteSize(verifiedBytes)
      : normalizeByteSize(raw.fileSize);

  const folderId = normalizeOptionalString(raw.folderId, 64);
  const folderName = normalizeOptionalString(raw.folderName, DISPLAY_NAME_MAX);

  return {
    id: downloadId,
    downloadId,
    displayName,
    fileName,
    mimeType: normalizeMimeType(raw.mimeType, fileName),
    fileSize,
    quality: normalizeQuality(raw.quality),
    resolution: normalizeResolution(raw.resolution),
    bitrate: normalizeBitrate(raw.bitrate),
    duration: normalizeDuration(raw.duration),
    downloadedAt: normalizeIsoDate(raw.downloadedAt),
    favorite: raw.favorite === true,
    folderId,
    folderName,
    localAvailability: resolveAvailability(
      raw.localAvailability as LocalAvailability | undefined,
    ),
    thumbnailUri: normalizeThumbnailUri(raw.thumbnailUrl ?? raw.thumbnailUri),
    lastPlayedAt: normalizeIsoDate(raw.lastPlayedAt),
    progressPercent:
      typeof raw.progressPercent === 'number' &&
      Number.isFinite(raw.progressPercent)
        ? Math.min(100, Math.max(0, raw.progressPercent))
        : null,
    positionSeconds:
      typeof raw.positionSeconds === 'number' &&
      Number.isFinite(raw.positionSeconds) &&
      raw.positionSeconds >= 0
        ? raw.positionSeconds
        : null,
    completed: raw.completed === true,
  };
}

export function dedupeLibraryItems(
  items: MediaLibraryItem[],
): MediaLibraryItem[] {
  const byId = new Map<string, MediaLibraryItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const existingTime = existing.downloadedAt
      ? Date.parse(existing.downloadedAt)
      : 0;
    const nextTime = item.downloadedAt ? Date.parse(item.downloadedAt) : 0;
    if (nextTime >= existingTime) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}
