import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  authenticateWithBiometrics,
  biometricOutcome,
  BIOMETRIC_STRONG,
  isBiometricUnlockAvailable,
  offersBiometricUnlock,
  showsBiometricSetting,
  type BiometricPort,
} from './biometric-unlock';

function port(overrides: Partial<Record<keyof BiometricPort, unknown>> = {}) {
  const calls: unknown[] = [];
  const fake: BiometricPort = {
    hasHardwareAsync: async () => (overrides.hasHardwareAsync as boolean | undefined) ?? true,
    isEnrolledAsync: async () => (overrides.isEnrolledAsync as boolean | undefined) ?? true,
    getEnrolledLevelAsync: async () => (overrides.getEnrolledLevelAsync as number | undefined) ?? BIOMETRIC_STRONG,
    authenticateAsync: async (options) => {
      calls.push(options);
      const answer = overrides.authenticateAsync;
      if (answer instanceof Error) {
        throw answer;
      }
      return (answer as { success: true } | { success: false; error: string } | undefined) ?? { success: true };
    },
  };
  return { fake, calls };
}

describe('Unlock with fingerprint or face: gating (feat/biometric-unlock)', () => {
  test('available only with a scanner, something enrolled and strong biometrics', async () => {
    assert.equal(await isBiometricUnlockAvailable(port().fake), true);
    assert.equal(await isBiometricUnlockAvailable(port({ hasHardwareAsync: false }).fake), false);
    assert.equal(await isBiometricUnlockAvailable(port({ isEnrolledAsync: false }).fake), false);
    assert.equal(await isBiometricUnlockAvailable(port({ getEnrolledLevelAsync: 2 }).fake), false, 'weak face unlock is not enough');
    assert.equal(await isBiometricUnlockAvailable(port({ getEnrolledLevelAsync: 1 }).fake), false, 'a device PIN only');
    assert.equal(await isBiometricUnlockAvailable(null), false, 'no native module in this build');
  });

  test('a native failure while checking means not available', async () => {
    const broken: BiometricPort = {
      ...port().fake,
      hasHardwareAsync: async () => {
        throw new Error('boom');
      },
    };
    assert.equal(await isBiometricUnlockAvailable(broken), false);
  });

  test('Settings shows the option only with App Lock on and a device that can', () => {
    assert.equal(showsBiometricSetting({ appLockEnabled: true, available: true }), true);
    assert.equal(showsBiometricSetting({ appLockEnabled: false, available: true }), false);
    assert.equal(showsBiometricSetting({ appLockEnabled: true, available: false }), false);
  });

  test('the lock screen offers it only when it is on, possible, and the app is locked', () => {
    const base = { settingOn: true, appLockEnabled: true, available: true, locked: true };
    assert.equal(offersBiometricUnlock(base), true);
    assert.equal(offersBiometricUnlock({ ...base, settingOn: false }), false, 'off by default');
    assert.equal(offersBiometricUnlock({ ...base, appLockEnabled: false }), false);
    assert.equal(offersBiometricUnlock({ ...base, available: false }), false, 'e.g. fingerprints removed since');
    assert.equal(offersBiometricUnlock({ ...base, locked: false }), false);
  });

  test('outcomes: recognised, cancelled (use the PIN), locked out, or failed', () => {
    assert.equal(biometricOutcome({ success: true }), 'success');
    for (const error of ['user_cancel', 'app_cancel', 'system_cancel', 'user_fallback']) {
      assert.equal(biometricOutcome({ success: false, error }), 'cancelled', error);
    }
    assert.equal(biometricOutcome({ success: false, error: 'lockout' }), 'lockout');
    for (const error of ['not_enrolled', 'not_available', 'authentication_failed', 'timeout', 'unknown']) {
      assert.equal(biometricOutcome({ success: false, error }), 'failed', error);
    }
    assert.equal(biometricOutcome(null), 'failed');
  });

  test('the prompt asks for strong biometrics with no device-PIN fallback (the App Lock PIN is the fallback)', async () => {
    const { fake, calls } = port();
    assert.equal(await authenticateWithBiometrics(fake, { promptMessage: 'Unlock VidoraX', cancelLabel: 'Use PIN' }), 'success');
    assert.deepEqual(calls, [
      { promptMessage: 'Unlock VidoraX', cancelLabel: 'Use PIN', disableDeviceFallback: true, biometricsSecurityLevel: 'strong' },
    ]);
  });

  test('the prompt never throws, and without the module it fails over to the PIN', async () => {
    assert.equal(await authenticateWithBiometrics(port({ authenticateAsync: new Error('crash') }).fake, { promptMessage: 'x', cancelLabel: 'y' }), 'failed');
    assert.equal(await authenticateWithBiometrics(null, { promptMessage: 'x', cancelLabel: 'y' }), 'failed');
  });
});
