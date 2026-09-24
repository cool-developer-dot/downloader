import type { DownloadProgressEvent } from '@modules/vidorax-media/src/VidoraMedia.types';

/**
 * The native transfer reports progress once per 64 KiB buffer write, so a fast
 * download emits tens of events per second per download. Each one used to reach
 * the store directly, and every store write clones the downloads maps and
 * notifies every subscriber.
 *
 * Bytes are cumulative, so an older event carries no information a newer one
 * lacks: keeping only the newest event per download id and applying on a fixed
 * cadence is lossless for what the UI shows. The first event for an id is
 * applied immediately so a download starts moving without a visible delay, and
 * a terminal state event flushes that id so the final numbers are never left
 * sitting in the buffer.
 */

export const PROGRESS_COALESCE_MS = 250;

export type ProgressCoalescerStats = {
  /** Events received from the engine. */
  received: number;
  /** Events actually handed to the sink. */
  applied: number;
};

export type ProgressCoalescerDeps = {
  intervalMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export type DownloadProgressCoalescer = {
  push: (event: DownloadProgressEvent) => void;
  /** Applies whatever is buffered. With an id, flushes only that download. */
  flush: (id?: string) => void;
  dispose: () => void;
  stats: () => ProgressCoalescerStats;
};

export function createDownloadProgressCoalescer(
  apply: (event: DownloadProgressEvent) => void,
  deps: ProgressCoalescerDeps = {},
): DownloadProgressCoalescer {
  const intervalMs = deps.intervalMs ?? PROGRESS_COALESCE_MS;
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = deps.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const pending = new Map<string, DownloadProgressEvent>();
  const lastAppliedAt = new Map<string, number>();
  let timer: unknown = null;
  let received = 0;
  let applied = 0;
  let disposed = false;

  function applyNow(event: DownloadProgressEvent): void {
    lastAppliedAt.set(event.id, now());
    applied += 1;
    apply(event);
  }

  function drain(): void {
    timer = null;
    if (pending.size === 0) {
      return;
    }
    const due: DownloadProgressEvent[] = [];
    let earliestWait = Infinity;
    const at = now();
    for (const [id, event] of pending) {
      const since = at - (lastAppliedAt.get(id) ?? 0);
      if (since >= intervalMs) {
        due.push(event);
        pending.delete(id);
      } else {
        earliestWait = Math.min(earliestWait, intervalMs - since);
      }
    }
    for (const event of due) {
      applyNow(event);
    }
    if (pending.size > 0 && !disposed) {
      timer = schedule(drain, earliestWait === Infinity ? intervalMs : earliestWait);
    }
  }

  function arm(delayMs: number): void {
    if (timer != null || disposed) {
      return;
    }
    timer = schedule(drain, delayMs);
  }

  return {
    push(event) {
      if (disposed) {
        return;
      }
      received += 1;
      const last = lastAppliedAt.get(event.id);
      if (last == null) {
        // First sighting of this download: show it moving straight away.
        applyNow(event);
        return;
      }
      const since = now() - last;
      if (since >= intervalMs && pending.size === 0) {
        applyNow(event);
        return;
      }
      pending.set(event.id, event);
      arm(Math.max(0, intervalMs - since));
    },

    flush(id) {
      if (disposed) {
        return;
      }
      if (id != null) {
        const event = pending.get(id);
        if (event) {
          pending.delete(id);
          applyNow(event);
        }
        // A finished download must not keep a throttle entry alive.
        lastAppliedAt.delete(id);
        return;
      }
      const events = [...pending.values()];
      pending.clear();
      for (const event of events) {
        applyNow(event);
      }
    },

    dispose() {
      disposed = true;
      if (timer != null) {
        cancel(timer);
        timer = null;
      }
      pending.clear();
      lastAppliedAt.clear();
    },

    stats: () => ({ received, applied }),
  };
}
