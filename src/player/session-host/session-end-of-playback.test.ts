import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { EndOfPlaybackAction } from '../end-of-playback';
import {
  markSessionAutoAdvance,
  runSessionEndOfPlayback,
  takeSessionAutoAdvance,
  type SessionEndDeps,
} from './session-end-of-playback';

type Calls = { replays: number; opened: string[]; folderReads: number };

function deps(
  over: Partial<{
    full: number;
    action: EndOfPlaybackAction;
    queue: string[];
    autoPlayNext: boolean;
    folderNext: string | null;
    sleepAtEnd: boolean;
    fullAfterFolder: number;
  }> = {},
): { deps: SessionEndDeps; calls: Calls } {
  const calls: Calls = { replays: 0, opened: [], folderReads: 0 };
  let full = over.full ?? 0;
  return {
    calls,
    deps: {
      fullPlayerCount: () => full,
      endAction: () => over.action ?? 'stop',
      queue: () => over.queue ?? [],
      autoPlayNext: () => over.autoPlayNext ?? false,
      folderNextId: async () => {
        calls.folderReads += 1;
        if (over.fullAfterFolder != null) {
          full = over.fullAfterFolder;
        }
        return over.folderNext ?? null;
      },
      sleepAtEnd: () => over.sleepAtEnd ?? false,
      replay: () => {
        calls.replays += 1;
      },
      openNext: (id) => {
        calls.opened.push(id);
      },
    },
  };
}

describe('the session runner at the end of a video (mini player)', () => {
  test('the full Player decides while it shows the session', async () => {
    const { deps: d, calls } = deps({ full: 1, action: 'repeatAll', queue: ['a', 'b'] });
    assert.deepEqual(await runSessionEndOfPlayback('a', d), { kind: 'skipped' });
    assert.deepEqual(calls, { replays: 0, opened: [], folderReads: 0 });
  });

  test('Stop (the default) stops', async () => {
    const { deps: d, calls } = deps({ queue: ['a', 'b'] });
    assert.equal((await runSessionEndOfPlayback('a', d)).kind, 'stop');
    assert.deepEqual(calls.opened, []);
    assert.equal(calls.replays, 0);
  });

  test('Repeat one plays the same video again', async () => {
    const { deps: d, calls } = deps({ action: 'repeatOne', queue: ['a', 'b'] });
    assert.equal((await runSessionEndOfPlayback('a', d)).kind, 'replay');
    assert.equal(calls.replays, 1);
  });

  test('Repeat all opens the next of the queue, and after the last the first', async () => {
    const first = deps({ action: 'repeatAll', queue: ['a', 'b', 'c'] });
    await runSessionEndOfPlayback('b', first.deps);
    assert.deepEqual(first.calls.opened, ['c']);
    const last = deps({ action: 'repeatAll', queue: ['a', 'b', 'c'] });
    await runSessionEndOfPlayback('c', last.deps);
    assert.deepEqual(last.calls.opened, ['a']);
  });

  test('Auto Play Next opens the next of the queue and stops after the last', async () => {
    const middle = deps({ autoPlayNext: true, queue: ['device:1', 'device:2'] });
    await runSessionEndOfPlayback('device:1', middle.deps);
    assert.deepEqual(middle.calls.opened, ['device:2']);
    assert.equal(middle.calls.folderReads, 0);
    const end = deps({ autoPlayNext: true, queue: ['device:1', 'device:2'] });
    assert.equal((await runSessionEndOfPlayback('device:2', end.deps)).kind, 'stop');
    assert.deepEqual(end.calls.opened, []);
  });

  test('Auto Play Next with no queue takes the next video of the folder', async () => {
    const { deps: d, calls } = deps({ autoPlayNext: true, queue: ['a'], folderNext: 'f2' });
    await runSessionEndOfPlayback('a', d);
    assert.deepEqual(calls.opened, ['f2']);
    assert.equal(calls.folderReads, 1);
  });

  test('the folder is not read when it cannot decide', async () => {
    const off = deps({ autoPlayNext: false, folderNext: 'f2' });
    await runSessionEndOfPlayback('a', off.deps);
    const repeat = deps({ action: 'repeatOne', autoPlayNext: true, folderNext: 'f2' });
    await runSessionEndOfPlayback('a', repeat.deps);
    assert.equal(off.calls.folderReads + repeat.calls.folderReads, 0);
  });

  test('the full Player opened while the folder was read: it decides', async () => {
    const { deps: d, calls } = deps({ autoPlayNext: true, folderNext: 'f2', fullAfterFolder: 1 });
    assert.deepEqual(await runSessionEndOfPlayback('a', d), { kind: 'skipped' });
    assert.deepEqual(calls.opened, []);
  });

  test('"End of this video" (P18) stops, whatever else is set', async () => {
    const { deps: d, calls } = deps({ action: 'repeatAll', queue: ['a', 'b'], sleepAtEnd: true });
    assert.equal((await runSessionEndOfPlayback('a', d)).kind, 'stop');
    assert.deepEqual(calls, { replays: 0, opened: [], folderReads: 0 });
  });

  test('no media: nothing to do', async () => {
    const { deps: d } = deps({ action: 'repeatAll', queue: ['a', 'b'] });
    assert.deepEqual(await runSessionEndOfPlayback(null, d), { kind: 'skipped' });
  });
});

describe('the video the runner moved to starts once, even in the background', () => {
  test('taken once for that video, within 30 s', () => {
    markSessionAutoAdvance('b', 1_000);
    assert.equal(takeSessionAutoAdvance('a', 2_000), false);
    assert.equal(takeSessionAutoAdvance('b', 2_000), true);
    assert.equal(takeSessionAutoAdvance('b', 2_000), false);
  });

  test('too late: not started', () => {
    markSessionAutoAdvance('b', 0);
    assert.equal(takeSessionAutoAdvance('b', 31_000), false);
  });

  test('nothing marked, or no media', () => {
    assert.equal(takeSessionAutoAdvance(null), false);
    assert.equal(takeSessionAutoAdvance('x'), false);
  });
});
