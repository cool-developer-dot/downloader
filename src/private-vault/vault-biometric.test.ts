import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isExpectingSystemScreen } from '@/security/app-lock/expected-system-screen';

import { isExternalUiOpen } from './external-ui';
import { unlockPrivateWithBiometrics } from './vault-biometric';

describe('Private with fingerprint or face (feat/biometric-unlock)', () => {
  test('the prompt runs as a screen of the action: neither Private nor App Lock locks for it', async () => {
    let privateOpen = false;
    let appLockGrace = false;
    const outcome = await unlockPrivateWithBiometrics(async () => {
      privateOpen = isExternalUiOpen();
      appLockGrace = isExpectingSystemScreen();
      return 'success';
    });
    assert.equal(outcome, 'success');
    assert.equal(privateOpen, true);
    assert.equal(appLockGrace, true);
    assert.equal(isExternalUiOpen(), false);
  });

  test('a cancelled, locked-out or failing prompt leaves the PIN as the way in', async () => {
    assert.equal(await unlockPrivateWithBiometrics(async () => 'cancelled'), 'cancelled');
    assert.equal(await unlockPrivateWithBiometrics(async () => 'lockout'), 'lockout');
    assert.equal(
      await unlockPrivateWithBiometrics(async () => {
        throw new Error('native');
      }),
      'failed',
    );
    assert.equal(isExternalUiOpen(), false);
  });
});
