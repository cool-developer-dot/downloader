/**
 * P6 fix investigation: Device videos → quiet.mp4 → Up next → two-audio.mp4 restarts quiet.mp4 (reported on a phone).
 *
 * These walk the JavaScript path a switch takes — the route id, the queue, the Up next / ⏮ / ⏭ target, the session
 * request — for device, library and playlist ids alike. They pass on the current code: they show which layers are
 * NOT the cause (docs/work-log/p6-device-next-trace.md). The full Player can't be rendered here (no Jest and no React
 * renderer in this repo; tests run on node:test), so the rest is left to the `[P6-DEVNEXT]` lines on a device.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { playerPath } from '@/navigation/constants/route-paths';

import { previousTarget } from './engine/player-keys';
import { parseRouteMediaId } from './media-id';
import {
  P6_DEVNEXT_TAG,
  p6CallerNames,
  p6DevNextLog,
  p6QueueSummary,
  p6UriTail,
} from './p6-devnext-diagnostics';
import {
  playQueueOnOpen,
  queueNeighbours,
  setPlayQueue,
  setPlayQueueCurrent,
  usePlayQueueStore,
} from './play-queue';
import { shouldReuseSession } from './session-host/mini-player-policy';
import {
  __resetPlayerSessionHostForTests,
  openPlayerSession,
  usePlayerSessionHostStore,
} from './session-host/player-session-store';

/** What `useLocalSearchParams` hands the Player for a param expo-router stored (it decodes once). */
function localSearchParam(stored: string): string {
  try {
    return decodeURIComponent(stored);
  } catch {
    return stored;
  }
}

/** The param a push of `playerPath(id)` stores: tried both ways (kept encoded, or decoded by the router). */
function pushedParams(id: string): string[] {
  const segment = playerPath(id).slice('/player/'.length);
  return [segment, decodeURIComponent(segment)];
}

/** `openPlayer(id, queue)` as far as JavaScript goes: the queue, then the Player route's id. */
function openFromList(id: string, queue: readonly string[]): string | null {
  if (playQueueOnOpen(usePlayQueueStore.getState(), id, queue) === 'replace') {
    setPlayQueue(queue);
  }
  const ids = pushedParams(id).map((stored) => parseRouteMediaId(localSearchParam(stored)));
  assert.equal(new Set(ids).size, 1, 'the route id is the same however the router stores the pushed param');
  const mediaId = ids[0] ?? null;
  openPlayerSession(mediaId);
  setPlayQueueCurrent(mediaId);
  return mediaId;
}

/** `goToMedia(id)`: `setParams({ id })` stores the id raw; the Player reads it back and opens its session. */
function goToMedia(id: string): string | null {
  const mediaId = parseRouteMediaId(localSearchParam(id));
  openPlayerSession(mediaId);
  setPlayQueueCurrent(mediaId);
  return mediaId;
}

function requested(): { key: number | null; mediaId: string | null } {
  const request = usePlayerSessionHostStore.getState().request;
  return { key: request?.key ?? null, mediaId: request?.mediaId ?? null };
}

const SOURCES = [
  { kind: 'device videos', a: 'device:1000000034', b: 'device:1000000035' },
  { kind: 'library', a: 'dl-quiet', b: 'dl-two-audio' },
  // A playlist's entries are library or device ids; its queue is the playlist's order.
  { kind: 'playlist', a: 'dl-episode-1', b: 'device:1000000077' },
] as const;

afterEach(() => {
  __resetPlayerSessionHostForTests();
  setPlayQueue(undefined);
  setPlayQueueCurrent(null);
});

describe('P6: switching from one video to another', () => {
  for (const { kind, a, b } of SOURCES) {
    test(`${kind}: Up next → B switches the session to B`, () => {
      assert.equal(openFromList(a, [a, b]), a);
      const before = requested();
      assert.equal(before.mediaId, a);

      assert.equal(goToMedia(b), b);
      const after = requested();
      assert.equal(after.mediaId, b);
      assert.notEqual(after.key, before.key, 'a new session (its runner remounts with a new player)');
      assert.equal(usePlayQueueStore.getState().currentId, b);
    });

    test(`${kind}: ⏮ at 1 s with [B, A] goes to B, not a restart of A`, () => {
      openFromList(a, [b, a]);
      const { previousId } = queueNeighbours(usePlayQueueStore.getState().ids, a);
      assert.equal(previousId, b);
      assert.equal(previousTarget(1, previousId != null), 'previous');
      assert.equal(goToMedia(previousId as string), b);
      assert.equal(requested().mediaId, b);
    });

    test(`${kind}: ⏭ with [A, B] goes to B`, () => {
      openFromList(a, [a, b]);
      const { nextId } = queueNeighbours(usePlayQueueStore.getState().ids, a);
      assert.equal(nextId, b);
      assert.equal(goToMedia(nextId as string), b);
      assert.equal(requested().mediaId, b);
    });

    test(`${kind}: the same video again keeps its session (tapping it in the list or the mini player)`, () => {
      openFromList(a, [a, b]);
      const first = requested().key;
      openFromList(a, [a, b]);
      assert.equal(requested().key, first);
      assert.equal(shouldReuseSession({ mediaId: a, error: null }, b), false);
    });
  }

  test('⏮ with nothing before A restarts A by design (P15: no previous video)', () => {
    const a = 'device:1000000034';
    openFromList(a, [a, 'device:1000000035']);
    const { previousId } = queueNeighbours(usePlayQueueStore.getState().ids, a);
    assert.equal(previousId, null);
    assert.equal(previousTarget(1, previousId != null), 'restart');
  });

  test('a device id survives the route: device:<id> → device%3A<id> → device:<id>', () => {
    assert.equal(playerPath('device:1000000034'), '/player/device%3A1000000034');
    for (const stored of pushedParams('device:1000000034')) {
      assert.equal(parseRouteMediaId(localSearchParam(stored)), 'device:1000000034');
    }
    assert.equal(parseRouteMediaId(['device:1000000035']), 'device:1000000035');
  });
});

describe('[P6-DEVNEXT] diagnostics', () => {
  test('log nothing outside a development build', () => {
    const lines: unknown[][] = [];
    const previous = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      assert.equal(p6DevNextLog('route', { raw: 'device:1' }, (...args) => lines.push(args)), false);
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = previous;
    }
    assert.deepEqual(lines, []);
  });

  test('in a development build, one tagged line with the data as JSON', () => {
    const lines: unknown[][] = [];
    const previous = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    try {
      assert.equal(p6DevNextLog('route', { raw: 'device:1', parsed: 'device:1' }, (...args) => lines.push(args)), true);
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = previous;
    }
    assert.deepEqual(lines, [[P6_DEVNEXT_TAG, 'route', '{"raw":"device:1","parsed":"device:1"}']]);
  });

  test('the queue summary: length, the first ids, where the target is', () => {
    const queue = Array.from({ length: 25 }, (_, i) => `device:${i}`);
    const summary = p6QueueSummary(queue, 'device:7');
    assert.equal(summary.length, 25);
    assert.equal(summary.head.length, 20);
    assert.equal(summary.targetIndex, 7);
    assert.equal(p6QueueSummary(queue, '1000000034').targetIndex, -1);
    assert.equal(p6QueueSummary([], null).targetIndex, -1);
  });

  test('a source is logged by its last segment only, a caller by function names only', () => {
    assert.equal(p6UriTail('content://media/external/video/media/1234'), '1234');
    assert.equal(p6UriTail('file:///data/user/0/app/files/v.mp4?x=1'), 'v.mp4');
    assert.equal(p6UriTail(null), null);
    const stack = [
      'Error',
      '    at openPlayerSession (/app/src/player/session-host/player-session-store.ts:42:3)',
      '    at goToMedia (address at index.android.bundle:1:2345)',
      '    at anonymous (index.android.bundle:1:99)',
    ].join('\n');
    assert.deepEqual(p6CallerNames(stack), ['openPlayerSession', 'goToMedia']);
    assert.deepEqual(p6CallerNames(undefined), []);
  });
});
