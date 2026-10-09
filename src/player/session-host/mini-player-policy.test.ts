import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  miniPlayerPrimaryAction,
  shouldCloseFailedSession,
  shouldDismissOnRelease,
  shouldReuseSession,
  shouldShowMiniPlayer,
  type SessionSnapshot,
} from './mini-player-policy';
import {
  __resetPlayerSessionHostForTests,
  attachFullPlayer,
  closePlayerSession,
  openPlayerSession,
  publishLiveSession,
  selectVisibilityInput,
  setPlayerSessionPictureInPicture,
  usePlayerSessionHostStore,
  withdrawLiveSession,
  type LivePlayerSession,
} from './player-session-store';

const playing: SessionSnapshot = { mediaId: 'm1', error: null, isCompleted: false, isPlaying: true, isReady: true };

describe('when the mini player shows', () => {
  test('only for a playable session the user left: not next to the full Player, not in PiP', () => {
    assert.equal(shouldShowMiniPlayer({ session: playing, fullPlayerCount: 0, pictureInPictureActive: false }), true);
    assert.equal(shouldShowMiniPlayer({ session: playing, fullPlayerCount: 1, pictureInPictureActive: false }), false);
    assert.equal(shouldShowMiniPlayer({ session: playing, fullPlayerCount: 0, pictureInPictureActive: true }), false);
  });

  test('never without a session, for a failed one, or for a Player route without media', () => {
    assert.equal(shouldShowMiniPlayer({ session: null, fullPlayerCount: 0, pictureInPictureActive: false }), false);
    for (const error of ['MEDIA_NOT_FOUND', 'FILE_UNAVAILABLE', 'UNSUPPORTED_MEDIA', 'PLAYBACK_FAILED'] as const) {
      assert.equal(shouldShowMiniPlayer({ session: { ...playing, error }, fullPlayerCount: 0, pictureInPictureActive: false }), false);
    }
    assert.equal(shouldShowMiniPlayer({ session: { ...playing, mediaId: null }, fullPlayerCount: 0, pictureInPictureActive: false }), false);
  });

  test('a paused, loading or finished session still shows (resume, wait, or replay from it)', () => {
    for (const session of [
      { ...playing, isPlaying: false },
      { ...playing, isPlaying: false, isReady: false },
      { ...playing, isPlaying: false, isCompleted: true },
    ]) {
      assert.equal(shouldShowMiniPlayer({ session, fullPlayerCount: 0, pictureInPictureActive: false }), true);
    }
  });

  test('a session that failed after the user left is closed; one failing on the full Player stays for its error screen', () => {
    const failed = { ...playing, error: 'FILE_UNAVAILABLE' as const };
    assert.equal(shouldCloseFailedSession({ session: failed, fullPlayerCount: 0, pictureInPictureActive: false }), true);
    assert.equal(shouldCloseFailedSession({ session: failed, fullPlayerCount: 1, pictureInPictureActive: false }), false);
    assert.equal(shouldCloseFailedSession({ session: playing, fullPlayerCount: 0, pictureInPictureActive: false }), false);
  });
});

describe('the mini player controls', () => {
  test('pause while playing, replay once finished, play when paused, nothing before the media loads', () => {
    assert.equal(miniPlayerPrimaryAction(playing), 'pause');
    assert.equal(miniPlayerPrimaryAction({ ...playing, isPlaying: false }), 'play');
    assert.equal(miniPlayerPrimaryAction({ ...playing, isPlaying: false, isCompleted: true }), 'replay');
    assert.equal(miniPlayerPrimaryAction({ ...playing, isPlaying: false, isReady: false }), 'none');
    assert.equal(miniPlayerPrimaryAction({ ...playing, error: 'PLAYBACK_FAILED' }), 'none');
  });

  test('a swipe dismisses past 40% of the width or with a fling the same way, never on a small drag', () => {
    assert.equal(shouldDismissOnRelease(160, 0, 400), true);
    assert.equal(shouldDismissOnRelease(-170, 0, 400), true);
    assert.equal(shouldDismissOnRelease(60, 1200, 400), true);
    assert.equal(shouldDismissOnRelease(60, -1200, 400), false, 'fling back toward the start');
    assert.equal(shouldDismissOnRelease(40, 200, 400), false);
    assert.equal(shouldDismissOnRelease(300, 0, 0), false, 'not laid out yet');
  });
});

describe('the one shared session', () => {
  beforeEach(() => __resetPlayerSessionHostForTests());

  function live(key: number, mediaId: string | null, extra: Partial<LivePlayerSession['session']> = {}): LivePlayerSession {
    return {
      key,
      requestedMediaId: mediaId,
      session: { mediaId, error: null, isCompleted: false, isPlaying: true, isReady: true, ...extra },
    } as unknown as LivePlayerSession;
  }

  test('reopening the same media keeps the session (mini player → full Player: no restart)', () => {
    const first = openPlayerSession('m1');
    publishLiveSession(live(first, 'm1'));
    assert.equal(openPlayerSession('m1'), first);
    assert.equal(usePlayerSessionHostStore.getState().live?.key, first);
    assert.equal(shouldReuseSession({ mediaId: 'm1', error: null }, 'm1'), true);
  });

  test('another media replaces the session; a failed one is restarted, not reused', () => {
    const first = openPlayerSession('m1');
    publishLiveSession(live(first, 'm1'));
    const second = openPlayerSession('m2');
    assert.notEqual(second, first);
    assert.equal(usePlayerSessionHostStore.getState().live, null, 'the old session is no longer published');
    publishLiveSession(live(first, 'm1'));
    assert.equal(usePlayerSessionHostStore.getState().live, null, 'a late publish from the replaced runner is ignored');

    publishLiveSession(live(second, 'm2', { error: 'FILE_UNAVAILABLE' }));
    assert.notEqual(openPlayerSession('m2'), second);
    assert.equal(shouldReuseSession({ mediaId: null, error: null }, null), false);
  });

  test('the full Player hides the mini player while attached; leaving shows it; PiP hides it', () => {
    const key = openPlayerSession('m1');
    publishLiveSession(live(key, 'm1'));
    const detach = attachFullPlayer();
    assert.equal(shouldShowMiniPlayer(selectVisibilityInput(usePlayerSessionHostStore.getState())), false);
    setPlayerSessionPictureInPicture(true);
    detach();
    detach();
    assert.equal(usePlayerSessionHostStore.getState().fullPlayerCount, 0, 'detaching twice counts once');
    assert.equal(usePlayerSessionHostStore.getState().pictureInPictureActive, false, 'no PiP window without the full Player');
    assert.equal(shouldShowMiniPlayer(selectVisibilityInput(usePlayerSessionHostStore.getState())), true);
  });

  test('closing ends the session (stale closes of an older session are ignored)', () => {
    const first = openPlayerSession('m1');
    const second = openPlayerSession('m2');
    closePlayerSession(first);
    assert.equal(usePlayerSessionHostStore.getState().request?.key, second);
    publishLiveSession(live(second, 'm2'));
    closePlayerSession(second);
    assert.equal(usePlayerSessionHostStore.getState().request, null);
    assert.equal(usePlayerSessionHostStore.getState().live, null);
    withdrawLiveSession(second);
    assert.equal(shouldShowMiniPlayer(selectVisibilityInput(usePlayerSessionHostStore.getState())), false);
  });
});
