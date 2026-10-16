import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { IDLE_PLAYBACK, isVaultPlaybackUri, reduceVaultPlayback, type VaultPlayback } from './vault-playback';

const FILE = 'file:///data/user/0/com.vidorax.fast.videodownloader/cache/vault-play/3f2a9c1e-0b7d-4c55-9a10-2b3c4d5e6f70.mp4';

describe('temp-file cleanup rules', () => {
  test('a prepared file plays only for the open it belongs to', () => {
    const preparing = reduceVaultPlayback(IDLE_PLAYBACK, { type: 'open', token: 1, itemId: 'v' });
    assert.equal(preparing.state.phase, 'preparing');
    assert.equal(preparing.clearTemp, false);
    const playing = reduceVaultPlayback(preparing.state, { type: 'ready', token: 1, uri: FILE });
    assert.deepEqual(playing.state, { phase: 'playing', token: 1, itemId: 'v', uri: FILE });
    assert.equal(playing.clearTemp, false);
  });

  test('a file that arrives after the player was closed is deleted at once', () => {
    const preparing = reduceVaultPlayback(IDLE_PLAYBACK, { type: 'open', token: 1, itemId: 'v' }).state;
    const closed = reduceVaultPlayback(preparing, { type: 'close' });
    assert.equal(closed.clearTemp, true);
    const late = reduceVaultPlayback(closed.state, { type: 'ready', token: 1, uri: FILE });
    assert.equal(late.state.phase, 'idle');
    assert.equal(late.clearTemp, true);
  });

  test('a file for an older open is deleted, the newer open keeps waiting', () => {
    const newer = reduceVaultPlayback(IDLE_PLAYBACK, { type: 'open', token: 2, itemId: 'w' }).state;
    const stale = reduceVaultPlayback(newer, { type: 'ready', token: 1, uri: FILE });
    assert.equal(stale.state, newer);
    assert.equal(stale.clearTemp, true);
  });

  test('closing, leaving the section and backgrounding the app all delete the file', () => {
    const playing: VaultPlayback = { phase: 'playing', token: 1, itemId: 'v', uri: FILE };
    for (const type of ['close', 'left-section', 'app-background'] as const) {
      const step = reduceVaultPlayback(playing, { type });
      assert.equal(step.state.phase, 'idle', type);
      assert.equal(step.clearTemp, true, type);
    }
  });

  test('a failed decryption cleans up; a failure for an old open is ignored', () => {
    const preparing = reduceVaultPlayback(IDLE_PLAYBACK, { type: 'open', token: 3, itemId: 'v' }).state;
    assert.deepEqual(reduceVaultPlayback(preparing, { type: 'failed', token: 3 }), { state: IDLE_PLAYBACK, clearTemp: true });
    assert.deepEqual(reduceVaultPlayback(preparing, { type: 'failed', token: 2 }), { state: preparing, clearTemp: false });
  });

  test('the player is only ever given a decrypted copy from the vault playback folder', () => {
    assert.equal(isVaultPlaybackUri(FILE), true);
    assert.equal(isVaultPlaybackUri('content://media/external/video/1'), false);
    assert.equal(isVaultPlaybackUri('file:///data/user/0/x/files/library/web/clip.mp4'), false);
    assert.equal(isVaultPlaybackUri('file:///data/user/0/x/cache/vault-play/../files/library/clip.mp4'), false);
    assert.equal(isVaultPlaybackUri('https://example.com/vault-play/3f2a9c1e-0b7d-4c55-9a10-2b3c4d5e6f70.mp4'), false);
    const preparing = reduceVaultPlayback(IDLE_PLAYBACK, { type: 'open', token: 1, itemId: 'v' }).state;
    const refused = reduceVaultPlayback(preparing, { type: 'ready', token: 1, uri: 'file:///sdcard/Movies/clip.mp4' });
    assert.equal(refused.state.phase, 'preparing');
    assert.equal(refused.clearTemp, true);
  });
});
