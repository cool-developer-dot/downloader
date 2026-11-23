import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PLAYER_REMOTE_COMBOS,
  nextVolumeLevel,
  playerKeyAction,
  playerKeyCapture,
  previousTarget,
} from './player-keys.ts';

const on = { volumeKeys: 'player' as const, remoteKeys: true };

describe('P15 #562 / #701 Player keys', () => {
  it('takes keys only while the Player is in front with nothing open', () => {
    assert.deepEqual(playerKeyCapture(on, { inFront: true, inputBlocked: false }), {
      volumeKeys: true,
      combos: PLAYER_REMOTE_COMBOS,
    });
    assert.deepEqual(playerKeyCapture(on, { inFront: false, inputBlocked: false }), { volumeKeys: false, combos: [] });
    // A sheet (typing in Jump to time) or the Lock: every key keeps its normal job.
    assert.deepEqual(playerKeyCapture(on, { inFront: true, inputBlocked: true }), { volumeKeys: false, combos: [] });
  });

  it('leaves the volume keys to Android, or the remote keys alone, when set so', () => {
    assert.equal(playerKeyCapture({ volumeKeys: 'system', remoteKeys: true }, { inFront: true, inputBlocked: false }).volumeKeys, false);
    assert.deepEqual(playerKeyCapture({ volumeKeys: 'player', remoteKeys: false }, { inFront: true, inputBlocked: false }).combos, []);
    assert.equal(playerKeyCapture({ volumeKeys: 'seek', remoteKeys: false }, { inFront: true, inputBlocked: false }).volumeKeys, true);
  });

  it('maps a keyboard, a TV remote and a game pad', () => {
    for (const key of ['space', 'enter', 'center', 'k']) assert.equal(playerKeyAction(key, on), 'togglePlay', key);
    assert.equal(playerKeyAction('left', on), 'seekBack');
    assert.equal(playerKeyAction('j', on), 'seekBack');
    assert.equal(playerKeyAction('right', on), 'seekForward');
    assert.equal(playerKeyAction('L', on), 'seekForward');
    assert.equal(playerKeyAction('up', on), 'volumeUp');
    assert.equal(playerKeyAction('down', on), 'volumeDown');
    assert.equal(playerKeyAction('n', on), 'next');
    assert.equal(playerKeyAction('shift+p', on), 'previous');
    assert.equal(playerKeyAction('f', on), 'toggleFullscreen');
    assert.equal(playerKeyAction('m', on), 'toggleMute');
    assert.equal(playerKeyAction('escape', on), 'exitFullscreen');
    assert.equal(playerKeyAction('ctrl+t', on), null);
    assert.equal(playerKeyAction('space', { ...on, remoteKeys: false }), null);
  });

  it('makes the volume keys change the volume, skip, or nothing', () => {
    assert.equal(playerKeyAction('volumeUp', on), 'volumeUp');
    assert.equal(playerKeyAction('volumeDown', on), 'volumeDown');
    assert.equal(playerKeyAction('volumeUp', { ...on, volumeKeys: 'seek' }), 'seekForward');
    assert.equal(playerKeyAction('volumeDown', { ...on, volumeKeys: 'seek' }), 'seekBack');
    assert.equal(playerKeyAction('volumeUp', { ...on, volumeKeys: 'system' }), null);
  });

  it('moves the volume one of 15 steps, within 0–100%', () => {
    assert.equal(nextVolumeLevel(0, 1), 1 / 15);
    assert.equal(nextVolumeLevel(7 / 15, -1), 6 / 15);
    assert.equal(nextVolumeLevel(1, 1), 1);
    assert.equal(nextVolumeLevel(0, -1), 0);
    // A level between steps snaps to the nearest step first.
    assert.equal(nextVolumeLevel(0.5, 1), 9 / 15);
    assert.equal(nextVolumeLevel(Number.NaN, 1), 1 / 15);
  });

  it('goes to the previous video only in the first 3 s, else back to the start', () => {
    assert.equal(previousTarget(1.5, true), 'previous');
    assert.equal(previousTarget(3, true), 'previous');
    assert.equal(previousTarget(3.1, true), 'restart');
    assert.equal(previousTarget(0, false), 'restart');
  });
});
