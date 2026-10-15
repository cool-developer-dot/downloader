/**
 * Progress details (H5) derived only from what the v2 engine's events already carry (`DownloadProgressEvent`:
 * bytesDone, totalBytes, speedBps; `DownloadStateEvent` for the state). Nothing here asks the engine for more.
 *
 * - Remaining Size (#308): totalBytes − bytesDone, when the total is known.
 * - Average Speed (#312) and Elapsed Time (#314): accumulated only over intervals between two consecutive `download`
 *   progress events of a downloading record that are at most `MAX_ACTIVE_GAP_MS` apart. Paused, waiting (network,
 *   retry), queued and processing time never counts, and neither does a gap the app did not observe (JavaScript
 *   asleep in the background): those intervals are unknown, so they are left out rather than guessed. The figures
 *   cover what this app session saw.
 * - Speed Graph (#316): the engine's own speed, one value per second over the last `GRAPH_WINDOW_MS`.
 * - Total Speed Overview (#322): the sum of the running downloads' current speeds.
 *
 * Every selector returns null for a value it cannot know; none returns NaN, Infinity or a negative number.
 */

export const MAX_ACTIVE_GAP_MS = 5_000;
export const GRAPH_WINDOW_MS = 60_000;
export const GRAPH_BUCKET_MS = 1_000;
/** Average speed and elapsed time are shown once at least this much active time was seen. */
export const MIN_ACTIVE_MS = 1_000;

export type SpeedSample = { at: number; bps: number };

export type ProgressStats = {
  /** Wall clock (ms) and bytes of the last `download` event, while the record is downloading; null otherwise. */
  lastAt: number | null;
  lastBytes: number | null;
  activeMs: number;
  activeBytes: number;
  /** Engine speeds inside the graph window, oldest first. */
  samples: SpeedSample[];
};

export type ProgressSampleInput = {
  at: number;
  phase: 'download' | 'processing';
  bytesDone: number;
  speedBps: number;
};

export const EMPTY_PROGRESS_STATS: ProgressStats = {
  lastAt: null,
  lastBytes: null,
  activeMs: 0,
  activeBytes: 0,
  samples: [],
};

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function trimSamples(samples: SpeedSample[], now: number): SpeedSample[] {
  const from = now - GRAPH_WINDOW_MS;
  let start = 0;
  while (start < samples.length && samples[start]!.at < from) {
    start += 1;
  }
  return start === 0 ? samples : samples.slice(start);
}

/** Pure: one progress event of a downloading record. A processing event ends the active stretch. */
export function applyProgressSample(stats: ProgressStats, input: ProgressSampleInput): ProgressStats {
  const at = finiteNonNegative(input.at);
  if (at == null) {
    return stats;
  }
  if (input.phase !== 'download') {
    return markInactive(stats);
  }
  const bytes = finiteNonNegative(input.bytesDone);
  const speed = finiteNonNegative(input.speedBps);

  let { activeMs, activeBytes } = stats;
  if (stats.lastAt != null && stats.lastBytes != null && bytes != null) {
    const gap = at - stats.lastAt;
    const delta = bytes - stats.lastBytes;
    // Only an observed, continuous, forward stretch counts (a restart from zero is not negative progress).
    if (gap > 0 && gap <= MAX_ACTIVE_GAP_MS && delta >= 0) {
      activeMs += gap;
      activeBytes += delta;
    }
  }

  const samples = speed == null ? stats.samples : [...stats.samples, { at, bps: speed }];
  return {
    lastAt: bytes == null ? null : at,
    lastBytes: bytes,
    activeMs,
    activeBytes,
    samples: trimSamples(samples, at),
  };
}

/** Pure: the record stopped downloading (paused, waiting, processing, finished); the next event starts afresh. */
export function markInactive(stats: ProgressStats): ProgressStats {
  if (stats.lastAt == null && stats.lastBytes == null) {
    return stats;
  }
  return { ...stats, lastAt: null, lastBytes: null };
}

export function remainingBytes(bytesDone: number | null | undefined, totalBytes: number | null | undefined): number | null {
  const done = finiteNonNegative(bytesDone);
  const total = finiteNonNegative(totalBytes);
  if (done == null || total == null || total <= 0 || done > total) {
    return null;
  }
  return total - done;
}

export function averageSpeedBps(stats: ProgressStats | null | undefined): number | null {
  if (!stats || stats.activeMs < MIN_ACTIVE_MS || stats.activeBytes <= 0) {
    return null;
  }
  const value = stats.activeBytes / (stats.activeMs / 1000);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function elapsedActiveMs(stats: ProgressStats | null | undefined): number | null {
  if (!stats || !Number.isFinite(stats.activeMs) || stats.activeMs < MIN_ACTIVE_MS) {
    return null;
  }
  return stats.activeMs;
}

/**
 * Pure: the speed graph as one value per second, oldest first, ending at `now` (the last value is the newest
 * second). A second with no event is 0 (nothing moved that the app saw). Null when fewer than two samples exist.
 */
export function speedGraphPoints(
  stats: ProgressStats | null | undefined,
  now: number,
): { points: number[]; maxBps: number } | null {
  if (!stats || !Number.isFinite(now)) {
    return null;
  }
  const samples = stats.samples.filter((s) => s.at <= now && s.at > now - GRAPH_WINDOW_MS);
  if (samples.length < 2) {
    return null;
  }
  const buckets = Math.round(GRAPH_WINDOW_MS / GRAPH_BUCKET_MS);
  const points = new Array<number>(buckets).fill(0);
  for (const sample of samples) {
    const age = now - sample.at;
    const index = buckets - 1 - Math.floor(age / GRAPH_BUCKET_MS);
    if (index >= 0 && index < buckets) {
      // The newest sample of a second wins (events arrive in order).
      points[index] = sample.bps;
    }
  }
  const maxBps = Math.max(...points);
  if (!Number.isFinite(maxBps) || maxBps <= 0) {
    return null;
  }
  return { points, maxBps };
}

export type SpeedRow = { status: string; bytesPerSecond: number | null | undefined };

/** Pure: the sum of the running downloads' speeds; null when no running download has a known speed. */
export function totalSpeedBps(rows: readonly SpeedRow[]): number | null {
  let total = 0;
  let known = false;
  for (const row of rows) {
    if (row.status !== 'DOWNLOADING') {
      continue;
    }
    const speed = finiteNonNegative(row.bytesPerSecond);
    if (speed == null) {
      continue;
    }
    known = true;
    total += speed;
  }
  return known && Number.isFinite(total) ? total : null;
}

/** "m:ss" or "h:mm:ss"; null for an unknown or sub-second duration. */
export function formatElapsed(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < MIN_ACTIVE_MS) {
    return null;
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}
