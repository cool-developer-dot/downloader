import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { en } from '@/localization/en';
import { flattenCatalog } from '@/localization/types';

import {
  REMOTE_OFF,
  formatPin,
  lockSecondsLeft,
  remoteQrText,
  startErrorKey,
  stopReasonKey,
} from './remote-presentation';

const running = { ...REMOTE_OFF, running: true, url: 'http://192.168.1.20:41234', address: '192.168.1.20', port: 41234, pin: '012345' };
const keys = new Set(Object.keys(flattenCatalog(en)));

describe('Remote control screen (P6)', () => {
  it('shows the PIN in two groups', () => {
    assert.equal(formatPin('012345'), '012 345');
    assert.equal(formatPin(null), '');
    assert.equal(formatPin('12'), '');
  });

  it('puts the PIN after # in the QR code so it never reaches a server', () => {
    assert.equal(remoteQrText(running), 'http://192.168.1.20:41234/#pin=012345');
    assert.equal(remoteQrText({ ...running, pin: null }), 'http://192.168.1.20:41234/');
    assert.equal(remoteQrText(REMOTE_OFF), null);
  });

  it('says why it stopped by itself, not when the user turned it off', () => {
    assert.equal(stopReasonKey({ ...REMOTE_OFF, stopReason: 'idle' }), 'remoteControl.stoppedIdle');
    assert.equal(stopReasonKey({ ...REMOTE_OFF, stopReason: 'wifi_lost' }), 'remoteControl.stoppedWifi');
    assert.equal(stopReasonKey({ ...REMOTE_OFF, stopReason: 'background' }), 'remoteControl.stoppedBackground');
    assert.equal(stopReasonKey({ ...REMOTE_OFF, stopReason: 'user' }), null);
    assert.equal(stopReasonKey({ ...running, stopReason: 'idle' }), null);
    for (const reason of ['idle', 'wifi_lost', 'background', 'error'] as const) {
      assert.ok(keys.has(stopReasonKey({ ...REMOTE_OFF, stopReason: reason })!));
    }
  });

  it('counts a PIN lock down in whole seconds', () => {
    assert.equal(lockSecondsLeft({ ...running, lockedUntil: 10_500 }, 1_000), 10);
    assert.equal(lockSecondsLeft({ ...running, lockedUntil: 500 }, 1_000), 0);
    assert.equal(lockSecondsLeft(running, 1_000), 0);
  });

  it('explains a failed start', () => {
    assert.equal(startErrorKey('ERR_NO_WIFI'), 'remoteControl.needsWifi');
    assert.equal(startErrorKey('ERR_REMOTE_START'), 'remoteControl.startFailed');
    assert.equal(startErrorKey(undefined), 'remoteControl.startFailed');
  });
});
