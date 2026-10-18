import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSeekPreviewLoader,
  SEEK_PREVIEW_INTERVAL_MS,
  SEEK_PREVIEW_MAX_FAILURES,
  seekPreviewBucket,
  seekPreviewLeft,
  seekPreviewSize,
} from './seek-preview';

/** A fake clock, timers and a generator whose requests the test resolves by hand. */
function harness(options: { cacheLimit?: number } = {}) {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const pending: { seconds: number; resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
  const shown: { bucket: number; frame: string }[] = [];
  const released: string[] = [];
  const loader = createSeekPreviewLoader<string>({
    generate: (seconds) =>
      new Promise<string>((resolve, reject) => {
        pending.push({ seconds, resolve, reject });
      }),
    onFrame: (bucket, frame) => shown.push({ bucket, frame }),
    release: (frame) => released.push(frame),
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    cacheLimit: options.cacheLimit,
  });
  const flush = () => new Promise<void>((r) => setImmediate(r));
  return {
    loader,
    pending,
    shown,
    released,
    flush,
    advance(ms: number) {
      now += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at <= now) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
    },
    async resolveNext(frame?: string) {
      const next = pending.shift();
      assert.ok(next, 'a request is in flight');
      next.resolve(frame ?? `frame@${next.seconds}`);
      await flush();
    },
    async rejectNext() {
      const next = pending.shift();
      assert.ok(next, 'a request is in flight');
      next.reject(new Error('no frame'));
      await flush();
    },
  };
}

test('positions in the same second share one frame', () => {
  assert.equal(seekPreviewBucket(12.1), 12);
  assert.equal(seekPreviewBucket(12.99), 12);
  assert.equal(seekPreviewBucket(-3), 0);
});

test('one request at a time; the latest position wins over the ones passed on the way', async () => {
  const h = harness();
  h.loader.request(10.2);
  assert.equal(h.pending.length, 1);
  assert.equal(h.pending[0].seconds, 10);
  // The finger keeps moving while the first frame is being made: only the last position is asked next.
  h.loader.request(11.5);
  h.loader.request(12.5);
  h.loader.request(13.5);
  assert.equal(h.pending.length, 1, 'never two in flight');
  h.advance(SEEK_PREVIEW_INTERVAL_MS);
  await h.resolveNext();
  // 10 s arrived after the finger moved on: cached, not shown.
  assert.deepEqual(h.shown, []);
  assert.equal(h.pending.length, 1);
  assert.equal(h.pending[0].seconds, 13, 'positions 11 and 12 were skipped');
  await h.resolveNext();
  assert.deepEqual(h.shown, [{ bucket: 13, frame: 'frame@13' }]);
});

test('requests start at most every interval (~150 ms)', async () => {
  const h = harness();
  h.loader.request(1);
  await h.resolveNext();
  h.loader.request(5);
  assert.equal(h.pending.length, 0, 'too soon after the previous start');
  h.advance(SEEK_PREVIEW_INTERVAL_MS - 1);
  assert.equal(h.pending.length, 0);
  h.advance(1);
  assert.equal(h.pending.length, 1);
  assert.equal(h.pending[0].seconds, 5);
});

test('a cached position is shown at once, without a request', async () => {
  const h = harness();
  h.loader.request(30);
  await h.resolveNext();
  h.advance(1000);
  h.loader.request(40);
  await h.resolveNext();
  h.loader.request(30.7);
  assert.equal(h.pending.length, 0);
  assert.deepEqual(h.shown.at(-1), { bucket: 30, frame: 'frame@30' });
});

test('the cache is bounded; evicted frames are released (least recently used first)', async () => {
  const h = harness({ cacheLimit: 2 });
  for (const s of [1, 2]) {
    h.advance(1000);
    h.loader.request(s);
    await h.resolveNext();
  }
  h.loader.request(1); // 1 is now the most recent
  h.advance(1000);
  h.loader.request(3);
  await h.resolveNext();
  assert.deepEqual(h.released, ['frame@2']);
  assert.deepEqual(h.loader.cachedBuckets, [1, 3]);
});

test('clear on close releases every frame; a frame finishing after dispose is released too', async () => {
  const h = harness();
  h.loader.request(1);
  await h.resolveNext();
  h.advance(1000);
  h.loader.request(2);
  h.loader.dispose();
  assert.deepEqual(h.released, ['frame@1']);
  await h.resolveNext();
  assert.deepEqual(h.released, ['frame@1', 'frame@2']);
  assert.deepEqual(h.shown, [{ bucket: 1, frame: 'frame@1' }]);
  h.loader.request(5);
  assert.equal(h.pending.length, 0, 'a disposed loader asks nothing');
});

test('a source without frames (audio) stops asking after a few failures — no loop, no crash', async () => {
  const h = harness();
  for (let i = 0; i < SEEK_PREVIEW_MAX_FAILURES; i += 1) {
    h.advance(1000);
    h.loader.request(i * 10);
    await h.rejectNext();
  }
  assert.equal(h.loader.active, false);
  h.advance(1000);
  h.loader.request(99);
  assert.equal(h.pending.length, 0);
  assert.deepEqual(h.shown, []);
});

test('a failed position is not retried in a loop; a success resets the failure count', async () => {
  const h = harness();
  h.loader.request(7);
  await h.rejectNext();
  h.advance(1000);
  assert.equal(h.pending.length, 0, 'the failed position is not asked again by itself');
  h.loader.request(8);
  await h.resolveNext();
  assert.equal(h.loader.active, true);
});

test('preview size keeps the frame’s shape; position stays inside the track', () => {
  assert.deepEqual(seekPreviewSize(256, 144), { width: 160, height: 90 });
  assert.deepEqual(seekPreviewSize(144, 256), { width: 90, height: 160 });
  assert.deepEqual(seekPreviewSize(0, 0), { width: 160, height: 90 });
  assert.equal(seekPreviewLeft(0, 300, 160), 0);
  assert.equal(seekPreviewLeft(0.5, 300, 160), 70);
  assert.equal(seekPreviewLeft(1, 300, 160), 140);
});
