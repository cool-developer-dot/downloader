import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  decideActivityStopped,
  decideAppLifecycleAction,
  shouldArmPictureInPicture,
} from './app-lifecycle-policy';

describe('leaving the player', () => {
  test('a playing video pauses in the background when no PiP window can open', () => {
    assert.deepEqual(decideAppLifecycleAction({ nextState: 'background', isPlaying: true }), {
      action: 'background_pause',
    });
    assert.deepEqual(
      decideAppLifecycleAction({
        nextState: 'background',
        isPlaying: true,
        pictureInPicture: { armed: false, active: false },
      }),
      { action: 'background_pause' },
    );
  });

  test('with PiP armed the video keeps playing while the window opens', () => {
    assert.deepEqual(
      decideAppLifecycleAction({
        nextState: 'background',
        isPlaying: true,
        pictureInPicture: { armed: true, active: false },
      }),
      { action: 'await_picture_in_picture' },
    );
  });

  test('inside the PiP window nothing pauses', () => {
    assert.deepEqual(
      decideAppLifecycleAction({
        nextState: 'background',
        isPlaying: true,
        pictureInPicture: { armed: true, active: true },
      }),
      { action: 'none' },
    );
  });

  test('coming back never starts playback by itself', () => {
    assert.deepEqual(decideAppLifecycleAction({ nextState: 'active', isPlaying: false }), {
      action: 'foreground_no_autoplay',
    });
  });

  test('a paused video has nothing to do in the background', () => {
    assert.deepEqual(decideAppLifecycleAction({ nextState: 'background', isPlaying: false }), { action: 'none' });
  });

  test('a video nobody can see stops: PiP dismissed, no PiP window, screen off', () => {
    assert.equal(decideActivityStopped({ isPlaying: true }), 'pause');
    assert.equal(decideActivityStopped({ isPlaying: false }), 'none');
  });

  test('PiP is armed only for a playing, visible, healthy video on a supported device', () => {
    const ready = { supported: true, isPlaying: true, isReady: true, hasError: false, isSurfaceRevealed: true };
    assert.equal(shouldArmPictureInPicture(ready), true);
    assert.equal(shouldArmPictureInPicture({ ...ready, supported: false }), false);
    assert.equal(shouldArmPictureInPicture({ ...ready, isPlaying: false }), false);
    assert.equal(shouldArmPictureInPicture({ ...ready, hasError: true }), false);
    assert.equal(shouldArmPictureInPicture({ ...ready, isSurfaceRevealed: false }), false);
    assert.equal(shouldArmPictureInPicture({ ...ready, isReady: false }), false);
  });
});

describe('Keep playing in background (Settings → Player)', () => {
  const states = ['background', 'inactive'] as const;

  test('on: a playing video keeps playing in the background, also from landscape fullscreen', () => {
    for (const nextState of states) {
      // Landscape fullscreen leaves the app the same way: the decision does not depend on it.
      for (const pictureInPicture of [undefined, { armed: false, active: false }]) {
        assert.deepEqual(
          decideAppLifecycleAction({ nextState, isPlaying: true, pictureInPicture, backgroundPlayback: true }),
          { action: 'continue_in_background' },
        );
      }
    }
  });

  test('off: exactly today’s pause', () => {
    for (const nextState of states) {
      assert.deepEqual(decideAppLifecycleAction({ nextState, isPlaying: true, backgroundPlayback: false }), {
        action: 'background_pause',
      });
      assert.deepEqual(decideAppLifecycleAction({ nextState, isPlaying: true }), { action: 'background_pause' });
    }
  });

  test('PiP is unchanged either way: armed opens the window, inside it nothing pauses', () => {
    for (const backgroundPlayback of [true, false]) {
      assert.deepEqual(
        decideAppLifecycleAction({
          nextState: 'background',
          isPlaying: true,
          pictureInPicture: { armed: true, active: false },
          backgroundPlayback,
        }),
        { action: 'await_picture_in_picture' },
      );
      assert.deepEqual(
        decideAppLifecycleAction({
          nextState: 'background',
          isPlaying: true,
          pictureInPicture: { armed: true, active: true },
          backgroundPlayback,
        }),
        { action: 'none' },
      );
    }
  });

  test('a paused video stays paused and coming back never autoplays', () => {
    assert.deepEqual(decideAppLifecycleAction({ nextState: 'background', isPlaying: false, backgroundPlayback: true }), {
      action: 'none',
    });
    assert.deepEqual(decideAppLifecycleAction({ nextState: 'active', isPlaying: false, backgroundPlayback: true }), {
      action: 'foreground_no_autoplay',
    });
  });

  test('the activity stopping (screen off, left without PiP) keeps playing only when on', () => {
    assert.equal(decideActivityStopped({ isPlaying: true, backgroundPlayback: true }), 'none');
    assert.equal(decideActivityStopped({ isPlaying: true, backgroundPlayback: false }), 'pause');
    assert.equal(decideActivityStopped({ isPlaying: true }), 'pause');
    assert.equal(decideActivityStopped({ isPlaying: false, backgroundPlayback: true }), 'none');
  });

  test('dismissing the PiP window still pauses with the setting on', () => {
    assert.equal(
      decideActivityStopped({ isPlaying: true, backgroundPlayback: true, pictureInPictureEnded: true }),
      'pause',
    );
  });
});
