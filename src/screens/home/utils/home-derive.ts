import type { DownloadItem } from '@/api/types';
import { parseByteSize } from '@/library/mapper';
import { formatFileSize } from '@/media-detection/utils/format';
import { isContinueWatchingEligible, sortByLastPlayedDesc } from '@/playback/domain/continue-watching';
import {
  formatLastPlayedLabel,
  formatProgressPercentLabel,
  formatResumeLabel,
} from '@/playback/domain/format';
import type { PlaybackSummary } from '@/playback/domain/merge';

import { HOME_COPY, HOME_SECTION_LIMIT } from '../constants/home.constants';

export type HomeLocalFileMeta = {
  mediaId: string;
  fileName: string;
  fileSize: string;
  updatedAt: string;
};

export type HomeMediaTile = {
  mediaId: string;
  title: string;
  thumbnailUri: string | null;
  subtitle: string | null;
  progressPercent: number | null;
  positionSeconds: number | null;
  durationSeconds: number | null;
  lastPlayedAt: string | null;
  lastPlayedLabel: string | null;
  progressLabel: string | null;
  resumeLabel: string | null;
  completed: boolean;
};

export type HomeGreeting = {
  headline: string;
  firstName: string | null;
};

export function clampHomeSectionLimit(limit = HOME_SECTION_LIMIT): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return HOME_SECTION_LIMIT;
  }
  return Math.min(HOME_SECTION_LIMIT, Math.trunc(limit));
}

export function buildHomeGreeting(
  copy: { greetingWelcome: string } = HOME_COPY,
): HomeGreeting {
  return { headline: copy.greetingWelcome, firstName: null };
}

export function buildHomeMediaSubtitle(input: {
  fileSize?: string | null;
  quality?: string | null;
}): string | null {
  const parts: string[] = [];
  const bytes = Number(input.fileSize ?? '');
  const size = Number.isFinite(bytes) && bytes >= 0 ? formatFileSize(bytes) : null;
  if (size) {
    parts.push(size);
  }
  const quality = input.quality?.trim();
  if (quality) {
    parts.push(quality);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function downloadedAtMs(item: DownloadItem): number {
  const raw = item.downloadedAt ?? item.updatedAt ?? item.createdAt;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function uniqueByMediaId<T extends { mediaId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item.mediaId || seen.has(item.mediaId)) {
      continue;
    }
    seen.add(item.mediaId);
    out.push(item);
  }
  return out;
}

function playbackLabels(playback?: PlaybackSummary | null): Pick<
  HomeMediaTile,
  'lastPlayedLabel' | 'progressLabel' | 'resumeLabel'
> {
  const lastPlayedLabel = playback?.lastPlayedAt
    ? formatLastPlayedLabel(playback.lastPlayedAt) || null
    : null;
  const progressLabel =
    playback && playback.positionSeconds != null && playback.durationSeconds
      ? formatProgressPercentLabel(
          playback.positionSeconds,
          playback.durationSeconds,
        )
      : null;
  const resumeLabel =
    playback && playback.positionSeconds > 0
      ? formatResumeLabel(playback.positionSeconds)
      : null;
  return { lastPlayedLabel, progressLabel, resumeLabel };
}

function tileFromDownload(
  item: DownloadItem,
  playback?: PlaybackSummary | null,
): HomeMediaTile {
  return {
    mediaId: item.id,
    title: item.title.trim() || item.fileName,
    thumbnailUri: item.thumbnailUrl?.trim() || null,
    subtitle: buildHomeMediaSubtitle({
      fileSize: item.fileSize,
      quality: item.quality,
    }),
    progressPercent: playback?.progressPercent ?? null,
    positionSeconds: playback?.positionSeconds ?? null,
    durationSeconds: playback?.durationSeconds ?? null,
    lastPlayedAt: playback?.lastPlayedAt ?? null,
    completed: playback?.completed === true,
    ...playbackLabels(playback),
  };
}

function tileFromLocal(
  meta: HomeLocalFileMeta,
  playback?: PlaybackSummary | null,
): HomeMediaTile {
  return {
    mediaId: meta.mediaId,
    title: meta.fileName,
    thumbnailUri: null,
    subtitle: buildHomeMediaSubtitle({ fileSize: meta.fileSize }),
    progressPercent: playback?.progressPercent ?? null,
    positionSeconds: playback?.positionSeconds ?? null,
    durationSeconds: playback?.durationSeconds ?? null,
    lastPlayedAt: playback?.lastPlayedAt ?? null,
    completed: playback?.completed === true,
    ...playbackLabels(playback),
  };
}

export function hasLocalMedia(
  mediaId: string,
  downloadsById: Record<string, DownloadItem | undefined>,
  localById: Record<string, HomeLocalFileMeta | undefined>,
): boolean {
  const download = downloadsById[mediaId];
  if (download?.status === 'COMPLETED') {
    return true;
  }
  return Boolean(localById[mediaId]);
}

export function deriveRecentDownloadTiles(
  completed: readonly DownloadItem[],
  localById: Record<string, HomeLocalFileMeta | undefined>,
  limit = HOME_SECTION_LIMIT,
): HomeMediaTile[] {
  const bound = clampHomeSectionLimit(limit);
  const sorted = [...completed].sort((a, b) => downloadedAtMs(b) - downloadedAtMs(a));
  const tiles: HomeMediaTile[] = [];
  const seen = new Set<string>();

  for (const item of sorted) {
    if (tiles.length >= bound) {
      break;
    }
    if (!item.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    tiles.push(tileFromDownload(item));
  }

  if (tiles.length < bound) {
    const localSorted = Object.values(localById)
      .filter((meta): meta is HomeLocalFileMeta => Boolean(meta))
      .sort((a, b) => {
        const ta = Date.parse(a.updatedAt);
        const tb = Date.parse(b.updatedAt);
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });

    for (const meta of localSorted) {
      if (tiles.length >= bound) {
        break;
      }
      if (seen.has(meta.mediaId)) {
        continue;
      }
      seen.add(meta.mediaId);
      tiles.push(tileFromLocal(meta));
    }
  }

  return uniqueByMediaId(tiles).slice(0, bound);
}

export function deriveContinueWatchingTiles(
  summaries: readonly PlaybackSummary[],
  downloadsById: Record<string, DownloadItem | undefined>,
  localById: Record<string, HomeLocalFileMeta | undefined>,
  limit = HOME_SECTION_LIMIT,
): HomeMediaTile[] {
  const bound = clampHomeSectionLimit(limit);
  const tiles: HomeMediaTile[] = [];
  const seen = new Set<string>();

  for (const summary of sortByLastPlayedDesc(summaries)) {
    if (tiles.length >= bound) {
      break;
    }
    if (!summary.mediaId || seen.has(summary.mediaId)) {
      continue;
    }
    const localAvailable = hasLocalMedia(
      summary.mediaId,
      downloadsById,
      localById,
    );
    if (
      !isContinueWatchingEligible(summary, {
        localAvailable,
      })
    ) {
      continue;
    }
    const download = downloadsById[summary.mediaId];
    const local = localById[summary.mediaId];
    const tile = download
      ? tileFromDownload(download, summary)
      : local
        ? tileFromLocal(local, summary)
        : null;
    if (!tile) {
      continue;
    }
    seen.add(summary.mediaId);
    tiles.push(tile);
  }

  return tiles;
}

export function deriveRecentlyWatchedTiles(
  summaries: readonly PlaybackSummary[],
  downloadsById: Record<string, DownloadItem | undefined>,
  localById: Record<string, HomeLocalFileMeta | undefined>,
  limit = HOME_SECTION_LIMIT,
): HomeMediaTile[] {
  const bound = clampHomeSectionLimit(limit);
  const tiles: HomeMediaTile[] = [];
  const seen = new Set<string>();

  for (const summary of sortByLastPlayedDesc(summaries)) {
    if (tiles.length >= bound) {
      break;
    }
    if (!summary.mediaId || !summary.lastPlayedAt || seen.has(summary.mediaId)) {
      continue;
    }
    if (!hasLocalMedia(summary.mediaId, downloadsById, localById)) {
      continue;
    }
    const download = downloadsById[summary.mediaId];
    const local = localById[summary.mediaId];
    const tile = download
      ? tileFromDownload(download, summary)
      : local
        ? tileFromLocal(local, summary)
        : null;
    if (!tile) {
      continue;
    }
    seen.add(summary.mediaId);
    tiles.push(tile);
  }

  return tiles;
}

export function deriveManagedStorageBytes(
  completed: readonly DownloadItem[],
  localById: Record<string, HomeLocalFileMeta | undefined>,
): bigint {
  let total = 0n;
  const counted = new Set<string>();

  for (const item of completed) {
    if (!item.id || counted.has(item.id)) {
      continue;
    }
    counted.add(item.id);
    total += parseByteSize(item.fileSize);
  }

  for (const meta of Object.values(localById)) {
    if (!meta || counted.has(meta.mediaId)) {
      continue;
    }
    counted.add(meta.mediaId);
    total += parseByteSize(meta.fileSize);
  }

  return total < 0n ? 0n : total;
}

export function formatManagedStorageLabel(bytes: bigint): string | null {
  if (bytes < 0n) {
    return null;
  }
  if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    const gib = Number(bytes / 1_073_741_824n);
    return `${gib.toFixed(0)} GB`;
  }
  return formatFileSize(Number(bytes));
}

/** Used / (used + free) when both values are known. Null if not accurate. */
export function deriveStorageUsageRatio(
  usedBytes: bigint,
  availableBytes: number | null,
): number | null {
  if (availableBytes == null || !Number.isFinite(availableBytes) || availableBytes < 0) {
    return null;
  }
  if (usedBytes < 0n) {
    return null;
  }
  const used =
    usedBytes > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(usedBytes);
  const total = used + availableBytes;
  if (!(total > 0)) {
    return null;
  }
  return Math.max(0, Math.min(1, used / total));
}

export function homeMediaIdsAreStable(tiles: readonly HomeMediaTile[]): boolean {
  const ids = tiles.map((tile) => tile.mediaId);
  return ids.every((id) => typeof id === 'string' && id.length > 0) &&
    new Set(ids).size === ids.length;
}
