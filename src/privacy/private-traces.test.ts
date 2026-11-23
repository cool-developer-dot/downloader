import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { createPlayCountTracker } from '../library/play-count.ts';
import {
  bindPlaybackPersistence,
  dropPlaybackSessionFor,
  unbindPlaybackPersistenceForTests,
} from '../playback/bind-playback-persistence.ts';
import { PLAYBACK_LOCAL_NAMESPACE } from '../playback/constants.ts';
import { PlaybackPersistenceCoordinator } from '../playback/coordinator.ts';
import { listLocalPlaybackSummaries } from '../playback/hooks.ts';
import { deletePlaybackState, loadPlaybackState, resetPlaybackStorageForTests } from '../playback/persistence.ts';
import { emitPlaybackEvent, subscribePlaybackEvents } from '../player/playback-events.ts';

import { __resetPrivateMediaGuardForTests, isMovedToPrivate, markMovedToPrivate } from './private-media-guard.ts';
import { hidePrivateTraces, privateTracesPlan, type PrivateTracesDeps } from './private-traces.ts';

/**
 * P11 #686: a video moved to Private is hidden everywhere outside it — the session's later events record nothing,
 * the coordinator doesn't write it again, and playlists, the queue, the Player's memory, play counts and bookmarks
 * forget it — while every other video stays exactly as it was.
 */

afterEach(() => {
  __resetPrivateMediaGuardForTests();
  unbindPlaybackPersistenceForTests();
  resetPlaybackStorageForTests();
});

/** An in-memory phone: every place a library video leaves a trace outside Private. */
function fakePhone(session: { mediaId: string | null; fullPlayer: boolean } = { mediaId: null, fullPlayer: false }) {
  const state = {
    marked: [] as string[],
    dropped: [] as string[],
    playback: new Set(['moved', 'other']),
    playStats: new Set(['moved', 'other']),
    bookmarks: new Set(['moved', 'other']),
    playlists: new Map<string, string[]>([
      ['road-trip', ['other', 'moved']],
      ['music', ['other']],
    ]),
    choices: new Set(['moved', 'other']),
    notes: new Set(['moved', 'other']),
    queue: { ids: ['other', 'moved', 'third'], currentId: 'moved' as string | null },
    session: { ...session },
    closedMiniPlayer: 0,
  };
  const deps: PrivateTracesDeps = {
    markMovedToPrivate: (id) => state.marked.push(id),
    dropPlaybackSession: (id) => state.dropped.push(id),
    forgetPlayback: (id) => state.playback.delete(id),
    forgetPlayStatsAndBookmarks: async (ids) => {
      for (const id of ids) {
        state.playStats.delete(id);
        state.bookmarks.delete(id);
      }
    },
    playlistsWith: async (id) => [...state.playlists].filter(([, ids]) => ids.includes(id)).map(([pid]) => pid),
    removeFromPlaylist: async (pid, id) => {
      state.playlists.set(pid, (state.playlists.get(pid) ?? []).filter((entry) => entry !== id));
      return true;
    },
    forgetPlayerChoices: (id) => state.choices.delete(id),
    forgetItemNotes: (ids) => ids.forEach((id) => state.notes.delete(id)),
    snapshot: () => ({
      sessionMediaId: state.session.mediaId,
      fullPlayerShown: state.session.fullPlayer,
      queueIds: state.queue.ids,
      queueCurrentId: state.queue.currentId,
    }),
    closeMiniPlayer: () => {
      state.closedMiniPlayer += 1;
      state.session.mediaId = null;
    },
    setQueueCurrent: (id) => {
      state.queue.currentId = id;
    },
    removeFromQueue: (id) => {
      if (state.queue.currentId !== id) {
        state.queue.ids = state.queue.ids.filter((entry) => entry !== id);
      }
    },
  };
  return { state, deps };
}

describe('P11 private traces: the plan for the session and the queue', () => {
  const base = { sessionMediaId: null, fullPlayerShown: false, queueIds: ['a', 'm', 'b'], queueCurrentId: 'a' };

  test('the mini player playing it stops; the queue forgets it', () => {
    assert.deepEqual(privateTracesPlan('m', { ...base, sessionMediaId: 'm', queueCurrentId: 'm' }), {
      closeMiniPlayer: true,
      clearQueueCurrent: true,
      removeFromQueue: true,
    });
  });

  test('the full Player showing it moves on by itself: the session and its queue place are left to it', () => {
    assert.deepEqual(privateTracesPlan('m', { ...base, sessionMediaId: 'm', fullPlayerShown: true, queueCurrentId: 'm' }), {
      closeMiniPlayer: false,
      clearQueueCurrent: false,
      removeFromQueue: false,
    });
  });

  test('not playing: only out of the queue; another video playing is never touched', () => {
    assert.deepEqual(privateTracesPlan('m', { ...base, sessionMediaId: 'a' }), {
      closeMiniPlayer: false,
      clearQueueCurrent: false,
      removeFromQueue: true,
    });
    assert.deepEqual(privateTracesPlan('x', { ...base, sessionMediaId: 'a' }), {
      closeMiniPlayer: false,
      clearQueueCurrent: false,
      removeFromQueue: false,
    });
    assert.deepEqual(privateTracesPlan('', base), { closeMiniPlayer: false, clearQueueCurrent: false, removeFromQueue: false });
  });
});

describe('P11 private traces: hidden everywhere', () => {
  test('every trace of the moved video goes; the other videos keep theirs', async () => {
    const { state, deps } = fakePhone({ mediaId: 'moved', fullPlayer: false });
    const report = await hidePrivateTraces('moved', deps);

    assert.deepEqual(report.failed, []);
    assert.deepEqual(state.marked, ['moved']);
    assert.deepEqual(state.dropped, ['moved']);
    assert.deepEqual([...state.playback], ['other'], 'Watch history / Continue watching');
    assert.deepEqual([...state.playStats], ['other'], 'play counts and Most played');
    assert.deepEqual([...state.bookmarks], ['other']);
    assert.deepEqual(Object.fromEntries(state.playlists), { 'road-trip': ['other'], music: ['other'] });
    assert.equal(report.playlistsCleared, 1);
    assert.deepEqual([...state.choices], ['other'], 'loops, fit, subtitle choices');
    assert.deepEqual([...state.notes], ['other'], 'tags, notes, artist');
    assert.equal(state.closedMiniPlayer, 1, 'the mini player stops');
    assert.deepEqual(state.queue, { ids: ['other', 'third'], currentId: null });
  });

  test('moved from the full Player: the Player keeps its session and moves on; everything else is forgotten', async () => {
    const { state, deps } = fakePhone({ mediaId: 'moved', fullPlayer: true });
    const report = await hidePrivateTraces('moved', deps);
    assert.equal(state.closedMiniPlayer, 0);
    assert.deepEqual(state.queue, { ids: ['other', 'moved', 'third'], currentId: 'moved' }, 'the Player removes it next');
    assert.equal(report.plan.closeMiniPlayer, false);
    assert.deepEqual([...state.playback], ['other']);
  });

  test('a step that fails doesn’t stop the others, and is reported', async () => {
    const { state, deps } = fakePhone();
    const report = await hidePrivateTraces('moved', {
      ...deps,
      forgetPlayerChoices: () => {
        throw new Error('storage');
      },
      playlistsWith: async () => {
        throw new Error('db');
      },
    });
    assert.deepEqual(report.failed.sort(), ['player-choices', 'playlists']);
    assert.deepEqual([...state.playback], ['other']);
    assert.deepEqual([...state.playStats], ['other']);
    assert.deepEqual([...state.notes], ['other']);
  });

  test('safe to run twice (the move and the library’s “deleted” event may both forget it)', async () => {
    const { state, deps } = fakePhone();
    await hidePrivateTraces('moved', deps);
    const second = await hidePrivateTraces('moved', deps);
    assert.deepEqual(second.failed, []);
    assert.equal(second.playlistsCleared, 0);
    assert.deepEqual([...state.playStats], ['other']);
  });

  test('an empty id does nothing', async () => {
    const { state, deps } = fakePhone();
    await hidePrivateTraces('  ', deps);
    assert.deepEqual(state.marked, []);
    assert.equal(state.playback.size, 2);
  });
});

describe('P11 private traces: the playing session records nothing more', () => {
  const now = Date.parse('2026-11-23T10:00:00.000Z');

  function realCoordinator() {
    const coordinator = new PlaybackPersistenceCoordinator({
      getUserId: () => PLAYBACK_LOCAL_NAMESPACE,
      sync: null,
      clock: { now: () => now },
    });
    bindPlaybackPersistence({ coordinator, isHistoryPaused: () => false });
    return coordinator;
  }

  /** What the move does to the playback side (the real modules; the rest faked). */
  async function move(mediaId: string) {
    const { deps } = fakePhone();
    await hidePrivateTraces(mediaId, {
      ...deps,
      markMovedToPrivate,
      dropPlaybackSession: (id) => {
        dropPlaybackSessionFor(id);
      },
      forgetPlayback: (id) => deletePlaybackState(PLAYBACK_LOCAL_NAMESPACE, id),
    });
  }

  test('the guard drops its events at the source; other videos’ events go through', () => {
    const seen: string[] = [];
    const unsubscribe = subscribePlaybackEvents((event) => seen.push(`${event.type}:${event.mediaId}`));
    markMovedToPrivate('moved');
    assert.equal(isMovedToPrivate('moved'), true);
    assert.equal(isMovedToPrivate('moved-2'), false, 'never a prefix match');
    emitPlaybackEvent({ type: 'paused', mediaId: 'moved', positionSeconds: 5, at: now });
    emitPlaybackEvent({ type: 'paused', mediaId: 'other', positionSeconds: 5, at: now });
    unsubscribe();
    assert.deepEqual(seen, ['paused:other']);
  });

  test('after the move, the paused / exit events and the next video’s start write nothing back', async () => {
    realCoordinator();
    emitPlaybackEvent({ type: 'playbackStarted', mediaId: 'moved', at: now - 60_000 });
    emitPlaybackEvent({ type: 'positionChanged', mediaId: 'moved', positionSeconds: 300, durationSeconds: 1200, at: now - 59_000 });
    assert.ok(loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, 'moved'), 'recorded while it played');

    await move('moved');
    emitPlaybackEvent({ type: 'paused', mediaId: 'moved', positionSeconds: 310, at: now - 50_000 });
    emitPlaybackEvent({ type: 'playerExited', mediaId: 'moved', positionSeconds: 310, at: now - 49_000 });
    emitPlaybackEvent({ type: 'playbackStarted', mediaId: 'next', at: now - 40_000 });
    emitPlaybackEvent({ type: 'positionChanged', mediaId: 'next', positionSeconds: 100, durationSeconds: 1200, at: now - 39_000 });
    emitPlaybackEvent({ type: 'playerExited', mediaId: 'next', positionSeconds: 100, at: now - 38_000 });

    assert.equal(loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, 'moved'), null);
    assert.deepEqual(
      listLocalPlaybackSummaries().map((summary) => summary.mediaId),
      ['next'],
      'Watch history and Continue watching',
    );
  });

  test('why the coordinator’s session is dropped: without it, the next video’s start writes the moved one back', () => {
    realCoordinator();
    emitPlaybackEvent({ type: 'playbackStarted', mediaId: 'moved', at: now - 60_000 });
    emitPlaybackEvent({ type: 'positionChanged', mediaId: 'moved', positionSeconds: 300, durationSeconds: 1200, at: now - 59_000 });
    deletePlaybackState(PLAYBACK_LOCAL_NAMESPACE, 'moved');
    markMovedToPrivate('moved');
    // (no dropPlaybackSessionFor)
    emitPlaybackEvent({ type: 'playbackStarted', mediaId: 'next', at: now - 40_000 });
    assert.ok(loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, 'moved'), 'the gap P11 closes');
  });

  test('dropPlaybackSessionFor only drops that video’s session', () => {
    const coordinator = realCoordinator();
    emitPlaybackEvent({ type: 'playbackStarted', mediaId: 'other', at: now });
    assert.equal(dropPlaybackSessionFor('moved'), false);
    assert.equal(coordinator.getActiveState()?.mediaId, 'other');
    assert.equal(dropPlaybackSessionFor('other'), true);
    assert.equal(coordinator.getActiveState(), null);
  });

  test('no play is counted after the move, even with the same session still sending', async () => {
    const counted: string[] = [];
    const tracker = createPlayCountTracker({
      isHistoryPaused: () => false,
      isCountable: () => true,
      onCount: (mediaId) => counted.push(mediaId),
    });
    const unsubscribe = subscribePlaybackEvents((event) => tracker.handle(event));
    emitPlaybackEvent({ type: 'playbackStarted', mediaId: 'moved', at: now });
    for (let s = 0; s <= 20; s += 1) {
      emitPlaybackEvent({ type: 'positionChanged', mediaId: 'moved', positionSeconds: s, durationSeconds: 600, at: now + s * 1000 });
    }
    await move('moved');
    for (let s = 21; s <= 60; s += 1) {
      emitPlaybackEvent({ type: 'positionChanged', mediaId: 'moved', positionSeconds: s, durationSeconds: 600, at: now + s * 1000 });
    }
    unsubscribe();
    assert.deepEqual(counted, []);
  });
});
