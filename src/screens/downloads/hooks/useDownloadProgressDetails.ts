import { useMemo } from 'react';

import { isEngineOwned } from '@/downloads/v2';
import {
  averageSpeedBps,
  elapsedActiveMs,
  formatElapsed,
  remainingBytes,
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
};

const NONE: DownloadProgressDetails = { remaining: null, averageSpeed: null, elapsed: null, graph: null };

/**
 * Remaining size, average speed, elapsed (active) time and the last minute's speed for one v2 download that is
 * queued, running or paused. Every value is null when it is unknown; v1 rows and finished rows get nothing.
 */
export function useDownloadProgressDetails(id: string | null | undefined): DownloadProgressDetails {
  const revision = useProgressStatsRevision((state) => state.revision);
  const status = useDownloadsStore((state) => (id ? state.itemsById[id]?.status : undefined));
  const engineOwned = useDownloadsStore((state) => (id ? isEngineOwned(state, id) : false));
  const bytesWritten = useDownloadsStore((state) => (id ? state.transferById[id]?.bytesWritten : undefined));
  const totalBytes = useDownloadsStore((state) => (id ? state.transferById[id]?.totalBytes : undefined));

  return useMemo(() => {
    if (!id || !engineOwned || !status || !LIVE_STATUSES.has(status)) {
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
    };
    // `revision` re-reads the stats map when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, engineOwned, status, bytesWritten, totalBytes, revision]);
}

/** The sum of the running v2 downloads' current speeds, formatted; null when none is known. */
export function useTotalDownloadSpeed(): string | null {
  const engineRowsById = useDownloadsStore((state) => state.engineRowsById);
  const transferById = useDownloadsStore((state) => state.transferById);

  return useMemo(() => {
    const rows = Object.entries(engineRowsById).map(([id, item]) => ({
      status: item.status,
      bytesPerSecond: transferById[id]?.bytesPerSecond ?? null,
    }));
    return formatTransferSpeed(totalSpeedBps(rows));
  }, [engineRowsById, transferById]);
}
