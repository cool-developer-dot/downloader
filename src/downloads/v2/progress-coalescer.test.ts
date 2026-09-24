import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadProgressEvent } from '@modules/vidorax-media/src/VidoraMedia.types';

import { createDownloadProgressCoalescer } from './progress-coalescer';

/** Deterministic clock + scheduler so the cadence is asserted, not slept through. */
function harness(intervalMs = 250) {
  let clock = 1_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextHandle = 1;
  const applied: DownloadProgressEvent[] = [];

  const coalescer = createDownloadProgressCoalescer((event) => applied.push(event), {
    intervalMs,
    now: () => clock,
    schedule: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: clock + ms, fn });
      return handle;
    },
    cancel: (handle) => {
      timers.delete(handle as number);
    },
  });

  function advance(ms: number): void {
    const target = clock + ms;
    for (;;) {
      let dueHandle: number | null = null;
      let dueAt = Infinity;
      for (const [handle, timer] of timers) {
        if (timer.at <= target && timer.at < dueAt) {
          dueAt = timer.at;
          dueHandle = handle;
        }
      }
      if (dueHandle == null) {
        break;
      }
      const timer = timers.get(dueHandle)!;
      timers.delete(dueHandle);
      clock = timer.at;
      timer.fn();
    }
    clock = target;
  }

  return { coalescer, applied, advance, pendingTimers: () => timers.size };
}

function event(id: string, bytesDone: number): DownloadProgressEvent {
  return {
    id,
    phase: 'download',
    bytesDone,
    totalBytes: 1_000,
    fraction: bytesDone / 1_000,
    speedBps: 1_000,
    etaSeconds: 1,
  } as DownloadProgressEvent;
}

describe('download progress is coalesced without losing the newest bytes', () => {
  test('the first event for a download is applied immediately', () => {
    const { coalescer, applied } = harness();
    coalescer.push(event('a', 10));
    assert.equal(applied.length, 1);
    assert.equal(applied[0]!.bytesDone, 10);
  });

  test('a burst collapses to one apply carrying the newest byte count', () => {
    const { coalescer, applied, advance } = harness(250);
    coalescer.push(event('a', 10)); // immediate
    for (let bytes = 20; bytes <= 400; bytes += 10) {
      advance(5);
      coalescer.push(event('a', bytes));
    }
    const duringBurst = applied.length;
    advance(250);

    // 40 pushes over ~200ms became a handful of applies, ending on the newest value.
    assert.ok(duringBurst <= 2, `applied ${duringBurst} times during the burst`);
    assert.equal(applied.at(-1)!.bytesDone, 400);
    const stats = coalescer.stats();
    assert.equal(stats.received, 40);
    assert.ok(stats.applied < stats.received / 4, `applied ${stats.applied} of ${stats.received}`);
  });

  test('two downloads are throttled independently', () => {
    const { coalescer, applied, advance } = harness(250);
    coalescer.push(event('a', 10));
    coalescer.push(event('b', 10));
    assert.equal(applied.length, 2);

    advance(50);
    coalescer.push(event('a', 20));
    coalescer.push(event('b', 20));
    advance(300);

    assert.deepEqual(
      applied.map((e) => `${e.id}:${e.bytesDone}`),
      ['a:10', 'b:10', 'a:20', 'b:20'],
    );
  });

  test('a state change flushes that download so the final bytes are never stranded', () => {
    const { coalescer, applied, advance } = harness(250);
    coalescer.push(event('a', 10));
    advance(20);
    coalescer.push(event('a', 900)); // buffered, not yet due
    assert.equal(applied.length, 1);

    coalescer.flush('a');
    assert.equal(applied.length, 2);
    assert.equal(applied.at(-1)!.bytesDone, 900);
  });

  test('flushing an id drops its throttle state so a restart applies at once', () => {
    const { coalescer, applied, advance } = harness(250);
    coalescer.push(event('a', 10));
    coalescer.flush('a');
    advance(10);
    coalescer.push(event('a', 20));
    assert.equal(applied.at(-1)!.bytesDone, 20, 'a re-queued download shows movement immediately');
  });

  test('dispose cancels the pending timer and stops applying', () => {
    const { coalescer, applied, advance, pendingTimers } = harness(250);
    coalescer.push(event('a', 10));
    advance(20);
    coalescer.push(event('a', 50));
    assert.ok(pendingTimers() > 0);

    coalescer.dispose();
    assert.equal(pendingTimers(), 0);

    advance(1_000);
    coalescer.push(event('a', 90));
    assert.equal(applied.length, 1, 'nothing is applied after dispose');
  });
});
