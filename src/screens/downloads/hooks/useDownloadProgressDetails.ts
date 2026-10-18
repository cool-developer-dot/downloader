import { useMemo } from 'react';

import { isEngineOwned } from '@/downloads/v2';
import {
  averageSpeedBps,
  elapsedActiveMs,
  formatElapsed,
  remainingBytes,
  type SegmentCounts,
  speedGraphPoints,
  totalSpeedBps,
} from '@/downloads/v2/progress-stats';
import { getProgressStats, useProgressStatsRevision } from '@/downloads/v2/progress-stats-store';
import { useDownloadsStore } from '@/store/downloads';

import { formatDownloadFileSize, formatTransferSpeed } from '../utils/download-format';

const LIVE_STATUSES = new Set(['DOWNLOADING', 'PAUSED', 'QUEUED']);

export type DownloadProgressDetails = {
  remaining: string | null;
  averageSpeed: string | null;
  elapsed: string | null;
  graph: { points: number[]; maxBps: number } | null;
  /** #315: segments done / in all of an HLS or DASH segment download; null for a file or when not reported. */
  segments: SegmentCounts | null;
};

const NONE: DownloadProgressDetails = {
  remaining: null,
  averageSpeed: null,
  elapsed: null,
  graph: null,
  segments: null,
};

/**
 * Remaining size, average speed, elapsed (active) time and the last minute's speed for one v2 download that is
 * queued, running or paused. Every value is null when it is unknown; v1 rows and finished rows get nothing.
 */
export function useDownloadProgressDetails(id: string | null | undefined): DownloadProgressDetails {
  const status = useDownloadsStore((state) => (id ? state.itemsById[id]?.status : undefined));
  const engineOwned = useDownloadsStore((state) => (id ? isEngineOwned(state, id) : false));
  const live = Boolean(id && engineOwned && status && LIVE_STATUSES.has(status));
  // Finished and v1 rows never follow the stats clock: they would only re-render once a second for nothing.
  const revision = useProgressStatsRevision((state) => (live ? state.revision : 0));
  const bytesWritten = useDownloadsStore((state) => (id ? state.transferById[id]?.bytesWritten : undefined));
  const totalBytes = useDownloadsStore((state) => (id ? state.transferById[id]?.totalBytes : undefined));

  return useMemo(() => {
    if (!live || !id || !status) {
      return NONE;
    }
    const stats = getProgressStats(id);
    const remaining = remainingBytes(bytesWritten, totalBytes);
    // The graph ends at the newest sample: it only changes when an event arrives anyway.
    const newestAt = stats?.samples[stats.samples.length - 1]?.at ?? null;
    return {
      remaining: remaining == null ? null : formatDownloadFileSize(String(remaining)),
      averageSpeed: formatTransferSpeed(averageSpeedBps(stats)),
      elapsed: formatElapsed(elapsedActiveMs(stats)),
      graph: status === 'DOWNLOADING' && newestAt != null ? speedGraphPoints(stats, newestAt) : null,
      segments: stats?.segments ?? null,
    };
    // `revision` re-reads the stats map when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, live, status, bytesWritten, totalBytes, revision]);
}

/** The sum of the running v2 downloads' current speeds, formatted; null when none is known. */
function selectTotalSpeedLabel(state: ReturnType<typeof useDownloadsStore.getState>): string | null {
  const rows = Object.entries(state.engineRowsById).map(([id, item]) => ({
    status: item.status,
    bytesPerSecond: state.transferById[id]?.bytesPerSecond ?? null,
  }));
  return formatTransferSpeed(totalSpeedBps(rows));
}

/** The formatted label is selected directly, so the line re-renders only when the text it shows changes. */
export function useTotalDownloadSpeed(): string | null {
  return useDownloadsStore(selectTotalSpeedLabel);
}
