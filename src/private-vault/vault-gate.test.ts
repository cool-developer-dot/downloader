import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isExternalUiOpen, withExternalUi } from './external-ui';
import { locksOnAppState, LOCKED_SESSION, privateEntryAction, reduceVaultSession } from './vault-gate';

describe('Private entry and App Lock', () => {
  test('nothing private without a PIN: no App Lock offers its setup', () => {
    assert.equal(privateEntryAction({ bootstrapped: true, enabled: false }), 'offer-app-lock-setup');
    assert.equal(privateEntryAction({ bootstrapped: true, enabled: true }), 'open');
    assert.equal(privateEntryAction({ bootstrapped: false, enabled: true }), 'wait');
    assert.equal(privateEntryAction({ bootstrapped: false, enabled: false }), 'wait');
  });
});

describe('section lock', () => {
  const unlocked = reduceVaultSession(LOCKED_SESSION, { type: 'pin-verified' });

  test('starts locked; only a verified PIN unlocks', () => {
    assert.equal(LOCKED_SESSION.unlocked, false);
    assert.equal(unlocked.unlocked, true);
    assert.equal(unlocked.generation, 1);
    assert.equal(reduceVaultSession(unlocked, { type: 'pin-verified' }), unlocked);
  });

  test('leaving the section or backgrounding the app locks it again', () => {
    for (const event of [{ type: 'left-section' } as const, { type: 'app-background' } as const]) {
      const locked = reduceVaultSession(unlocked, event);
      assert.equal(locked.unlocked, false, event.type);
      assert.equal(locked.generation, 2, event.type);
    }
  });

  test('App Lock turned off, or the whole app locking, locks the section', () => {
    assert.equal(reduceVaultSession(unlocked, { type: 'app-lock-changed', enabled: false, appLocked: false }).unlocked, false);
    assert.equal(reduceVaultSession(unlocked, { type: 'app-lock-changed', enabled: true, appLocked: true }).unlocked, false);
    assert.equal(reduceVaultSession(unlocked, { type: 'app-lock-changed', enabled: true, appLocked: false }), unlocked);
  });

  test('a system screen opened from inside Private (picker, permission) does not lock it', () => {
    assert.equal(reduceVaultSession(unlocked, { type: 'app-background', externalUi: true }), unlocked);
  });

  test('locking an already locked section changes nothing', () => {
    assert.equal(reduceVaultSession(LOCKED_SESSION, { type: 'left-section' }), LOCKED_SESSION);
  });

  test('every state but active locks', () => {
    assert.equal(locksOnAppState('active'), false);
    assert.equal(locksOnAppState('background'), true);
    assert.equal(locksOnAppState('inactive'), true);
  });

  test('the external-screen window always closes, even when the screen fails', async () => {
    assert.equal(isExternalUiOpen(), false);
    let inside = false;
    await withExternalUi(async () => {
      inside = isExternalUiOpen();
    });
    assert.equal(inside, true);
    await assert.rejects(
      withExternalUi(async () => {
        throw new Error('picker failed');
      }),
    );
    assert.equal(isExternalUiOpen(), false);
  });
});
