/**
 * Live progress statistics for v2 downloads (H5), fed by the engine's own events through a second listener — the
 * existing bridge and its coalescer are untouched. Stats are kept in memory only, for this app session.
 *
 * Events can arrive at up to 4 Hz per download; the screens only need a second's resolution, so the stats live in
 * a plain map and the UI is told to re-read them at most once a second (`useProgressStatsRevision`).
 */

import type { DownloadState } from '@modules/vidorax-media/src/VidoraMedia.types';

import { createStore } from '@/store/shared/create-store';

import { getV2Engine } from './engine-port';
import { applyProgressSample, EMPTY_PROGRESS_STATS, markInactive, type ProgressStats } from './progress-stats';

const PUBLISH_INTERVAL_MS = 1_000;
const TERMINAL: readonly DownloadState[] = ['completed', 'failed', 'cancelled'];

const statsById = new Map<string, ProgressStats>();
let dirty = false;
let timer: ReturnType<typeof setInterval> | null = null;
let attached = false;

/** Bumped (≤ 1 Hz) whenever any download's stats changed; components select it to re-render. */
export const useProgressStatsRevision = createStore<{ revision: number }>(() => ({ revision: 0 }));

export function getProgressStats(id: string): ProgressStats | null {
  return statsById.get(id) ?? null;
}

function publishSoon(): void {
  dirty = true;
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    if (dirty) {
      dirty = false;
      useProgressStatsRevision.setState((state) => ({ revision: state.revision + 1 }));
      return;
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }, PUBLISH_INTERVAL_MS);
}

/** Exposed for tests and the listener below. */
export function recordProgressEvent(event: {
  id: string;
  phase: 'download' | 'processing';
  bytesDone: number;
  speedBps: number;
}, at: number = Date.now()): void {
  const current = statsById.get(event.id) ?? EMPTY_PROGRESS_STATS;
  const next = applyProgressSample(current, { at, phase: event.phase, bytesDone: event.bytesDone, speedBps: event.speedBps });
  if (next !== current) {
    statsById.set(event.id, next);
    publishSoon();
  }
}

/** Exposed for tests and the listener below. */
export function recordStateEvent(id: string, state: DownloadState): void {
  const current = statsById.get(id);
  if (!current) {
    return;
  }
  if (TERMINAL.includes(state)) {
    statsById.delete(id);
    publishSoon();
    return;
  }
  if (state !== 'downloading') {
    const next = markInactive(current);
    if (next !== current) {
      statsById.set(id, next);
      publishSoon();
    }
  }
}

export function resetProgressStatsForTests(): void {
  statsById.clear();
  dirty = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Subscribes once to the engine's progress and state events. A build without the native module has no stats. */
export function ensureV2ProgressStats(): void {
  if (attached) {
    return;
  }
  const engine = getV2Engine();
  if (!engine) {
    return;
  }
  attached = true;
  engine.addListener('onDownloadProgress', (event) => {
    try {
      recordProgressEvent(event);
    } catch {
      // Statistics must never disturb downloads.
    }
  });
  engine.addListener('onDownloadStateChange', ({ record }) => {
    try {
      recordStateEvent(record.id, record.state);
    } catch {
      // Statistics must never disturb downloads.
    }
  });
}
