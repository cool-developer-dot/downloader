/**
 * Seek preview frames (F14): while the scrubber is dragged, a small frame of the video at the finger's position. Frames
 * come from expo-video's `generateThumbnailsAsync` (one MediaMetadataRetriever per call on Android — not cheap), so:
 * at most one request in flight, the latest position wins, a new request starts at most every
 * [SEEK_PREVIEW_INTERVAL_MS], frames are cached by [SEEK_PREVIEW_BUCKET_SECONDS]-second buckets (bounded, evicted
 * frames released), and everything is dropped when the player closes. Pure — the frame type and timers are injected.
 */

/** A new frame request starts at most this often while the finger moves. */
export const SEEK_PREVIEW_INTERVAL_MS = 150;
/** Positions within the same bucket share one frame. */
export const SEEK_PREVIEW_BUCKET_SECONDS = 1;
/** Frames kept for re-visited positions; older ones are released. */
export const SEEK_PREVIEW_CACHE_LIMIT = 40;
/** Frames are generated no wider than this (pixels); the preview shows them at [SEEK_PREVIEW_WIDTH_DP]. */
export const SEEK_PREVIEW_MAX_WIDTH_PX = 256;
/** On-screen size of the preview's longer side (dp). */
export const SEEK_PREVIEW_WIDTH_DP = 160;
/** Requests that fail in a row before the loader stops asking (an audio file, an unreadable source). */
export const SEEK_PREVIEW_MAX_FAILURES = 3;

export type SeekPreviewLoaderDeps<T> = {
  /** A frame at `seconds` (rejects when the source has none). */
  generate: (seconds: number) => Promise<T>;
  /** The frame for the position asked for last. */
  onFrame: (bucket: number, frame: T) => void;
  /** Frees a frame's native image (evicted, or the loader is gone). */
  release?: (frame: T) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  intervalMs?: number;
  cacheLimit?: number;
};

export type SeekPreviewLoader = {
  /** The finger is at `seconds`: show its frame (cached at once, else as soon as a request may start). */
  request: (seconds: number) => void;
  /** Drops every cached frame (released) and any wanted position. */
  clear: () => void;
  /** The player closed: clears, and ignores what is still in flight. */
  dispose: () => void;
  /** False once the source proved it has no frames. */
  readonly active: boolean;
  /** For tests: what is cached and in flight. */
  readonly cachedBuckets: number[];
  readonly inFlightBucket: number | null;
};

export function seekPreviewBucket(seconds: number): number {
  return Math.max(0, Math.floor(seconds / SEEK_PREVIEW_BUCKET_SECONDS));
}

export function createSeekPreviewLoader<T>(deps: SeekPreviewLoaderDeps<T>): SeekPreviewLoader {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const interval = deps.intervalMs ?? SEEK_PREVIEW_INTERVAL_MS;
  const limit = Math.max(1, deps.cacheLimit ?? SEEK_PREVIEW_CACHE_LIMIT);
  // Insertion order is recency: a hit is moved to the end, eviction takes the first.
  const cache = new Map<number, T>();
  let wanted: number | null = null;
  let inFlight: number | null = null;
  let lastStart = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  let failures = 0;
  let disposed = false;

  const release = (frame: T) => {
    try {
      deps.release?.(frame);
    } catch {
      // A frame already gone is fine.
    }
  };

  const put = (bucket: number, frame: T) => {
    const previous = cache.get(bucket);
    if (previous !== undefined && previous !== frame) {
      release(previous);
    }
    cache.delete(bucket);
    cache.set(bucket, frame);
    while (cache.size > limit) {
      const [oldest, oldFrame] = cache.entries().next().value as [number, T];
      cache.delete(oldest);
      release(oldFrame);
    }
  };

  const cancelTimer = () => {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const pump = () => {
    if (disposed || failures >= SEEK_PREVIEW_MAX_FAILURES || inFlight != null || wanted == null) {
      return;
    }
    if (cache.has(wanted)) {
      return;
    }
    const wait = lastStart + interval - now();
    if (wait > 0) {
      if (timer == null) {
        timer = setTimer(() => {
          timer = null;
          pump();
        }, wait);
      }
      return;
    }
    const bucket = wanted;
    inFlight = bucket;
    lastStart = now();
    deps.generate(bucket * SEEK_PREVIEW_BUCKET_SECONDS).then(
      (frame) => {
        inFlight = null;
        if (disposed) {
          release(frame);
          return;
        }
        failures = 0;
        put(bucket, frame);
        if (wanted === bucket) {
          deps.onFrame(bucket, frame);
        }
        pump();
      },
      () => {
        inFlight = null;
        failures += 1;
        // Never ask for the same failing position again at once; a new position may still work.
        if (wanted === bucket) {
          wanted = null;
        }
        pump();
      },
    );
  };

  const clearAll = () => {
    cancelTimer();
    wanted = null;
    for (const frame of cache.values()) {
      release(frame);
    }
    cache.clear();
  };

  return {
    request(seconds: number) {
      if (disposed || !Number.isFinite(seconds) || failures >= SEEK_PREVIEW_MAX_FAILURES) {
        return;
      }
      const bucket = seekPreviewBucket(seconds);
      wanted = bucket;
      const hit = cache.get(bucket);
      if (hit !== undefined) {
        cache.delete(bucket);
        cache.set(bucket, hit);
        deps.onFrame(bucket, hit);
        return;
      }
      pump();
    },
    clear: clearAll,
    dispose() {
      clearAll();
      disposed = true;
    },
    get active() {
      return !disposed && failures < SEEK_PREVIEW_MAX_FAILURES;
    },
    get cachedBuckets() {
      return [...cache.keys()];
    },
    get inFlightBucket() {
      return inFlight;
    },
  };
}

/** The preview's on-screen size for a frame of `width` × `height` (its longer side is [SEEK_PREVIEW_WIDTH_DP]). */
export function seekPreviewSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) {
    return { width: SEEK_PREVIEW_WIDTH_DP, height: Math.round((SEEK_PREVIEW_WIDTH_DP * 9) / 16) };
  }
  if (width >= height) {
    return { width: SEEK_PREVIEW_WIDTH_DP, height: Math.round((SEEK_PREVIEW_WIDTH_DP * height) / width) };
  }
  return { width: Math.round((SEEK_PREVIEW_WIDTH_DP * width) / height), height: SEEK_PREVIEW_WIDTH_DP };
}

/** Left edge of the preview centred over the thumb at `progress`, kept inside the track. */
export function seekPreviewLeft(progress: number, trackWidth: number, previewWidth: number): number {
  const centre = Math.max(0, Math.min(1, progress)) * trackWidth;
  return Math.max(0, Math.min(trackWidth - previewWidth, centre - previewWidth / 2));
}
