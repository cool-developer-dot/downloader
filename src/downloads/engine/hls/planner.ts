/**
 * Deterministic HLS segment plan from a parsed VOD media playlist.
 * Playlist order is preserved. No segment bodies are loaded.
 */

import { DownloadEngineError } from '../errors';
import { HLS_TRANSFER } from './constants';
import type { HlsMediaPlaylist } from './playlist';

export type HlsPlanEntry = {
  /** Playlist order including optional init as index -1 conceptually; use kind. */
  index: number;
  url: string;
  duration: number | null;
  isInitSegment: boolean;
};

export type HlsSegmentPlan = {
  playlistUrl: string;
  containerHint: 'ts' | 'fmp4';
  initSegmentUrl: string | null;
  entries: HlsPlanEntry[];
  mediaSegmentCount: number;
  totalSegments: number;
};

export function planHlsSegments(media: HlsMediaPlaylist): HlsSegmentPlan {
  const entries: HlsPlanEntry[] = [];
  const seenIndexes = new Set<string>();

  if (media.initSegmentUrl) {
    const key = 'init';
    seenIndexes.add(key);
    entries.push({
      index: -1,
      url: media.initSegmentUrl,
      duration: null,
      isInitSegment: true,
    });
  }

  for (const segment of media.segments) {
    const key = `media:${segment.index}`;
    if (seenIndexes.has(key)) {
      continue;
    }
    seenIndexes.add(key);
    entries.push({
      index: segment.index,
      url: segment.url,
      duration: segment.duration,
      isInitSegment: false,
    });
  }

  if (entries.length === 0 || media.segments.length === 0) {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'HLS media playlist has no segments.',
    );
  }

  if (media.segments.length > HLS_TRANSFER.maxSegments) {
    throw new DownloadEngineError(
      'HLS_UNSUPPORTED',
      'This HLS playlist has too many segments to download safely.',
    );
  }

  return {
    playlistUrl: media.playlistUrl,
    containerHint: media.containerHint,
    initSegmentUrl: media.initSegmentUrl,
    entries,
    mediaSegmentCount: media.segments.length,
    totalSegments: entries.length,
  };
}

export function orderedAssemblyEntries(plan: HlsSegmentPlan): HlsPlanEntry[] {
  return plan.entries.slice();
}
