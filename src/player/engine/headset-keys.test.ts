import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_HEADSET_KEY_SETTINGS,
  getHeadsetKeySettings,
  normalizeHeadsetKeySettings,
  setHeadsetKeySettings,
} from './headset-keys.ts';

describe('P15 headset and key settings', () => {
  it('defaults: pause on unplug, headset buttons and remote keys on, the Player volume, not over the lock screen', () => {
    assert.deepEqual(DEFAULT_HEADSET_KEY_SETTINGS, {
      pauseOnUnplug: true,
      headsetButtons: true,
      volumeKeys: 'player',
      remoteKeys: true,
      showOnLockScreen: false,
    });
  });

  it('checks each saved field on its own', () => {
    assert.deepEqual(normalizeHeadsetKeySettings(null), DEFAULT_HEADSET_KEY_SETTINGS);
    assert.deepEqual(normalizeHeadsetKeySettings({ pauseOnUnplug: false, volumeKeys: 'loud', remoteKeys: 'yes' }), {
      ...DEFAULT_HEADSET_KEY_SETTINGS,
      pauseOnUnplug: false,
    });
    assert.equal(normalizeHeadsetKeySettings({ volumeKeys: 'seek' }).volumeKeys, 'seek');
  });

  it('keeps a change for the run', () => {
    setHeadsetKeySettings({ showOnLockScreen: true, volumeKeys: 'system' });
    assert.equal(getHeadsetKeySettings().showOnLockScreen, true);
    assert.equal(getHeadsetKeySettings().volumeKeys, 'system');
    assert.equal(getHeadsetKeySettings().pauseOnUnplug, true);
    setHeadsetKeySettings(DEFAULT_HEADSET_KEY_SETTINGS);
  });
});
