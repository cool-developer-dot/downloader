import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { appHoldsSecure, privateFolderHoldsSecure } from '@/privacy/secure-window';

import {
  ALWAYS_ON_PROTECTIONS,
  DEFAULT_SECURITY_SETTINGS,
  getSecuritySettings,
  isInfoRowProtection,
  normalizeSecuritySettings,
  securityPageModel,
  setBlockScreenshots,
} from './security-settings';

afterEach(() => setBlockScreenshots(false));

describe('Files F10 · design 64: the Security page', () => {
  test('the defaults: Block screenshots off; encryption, Hide history and Malware warning always on', () => {
    assert.deepEqual(DEFAULT_SECURITY_SETTINGS, { blockScreenshots: false });
    assert.deepEqual(getSecuritySettings(), { blockScreenshots: false });
    const page = securityPageModel({ appLockEnabled: false, settings: DEFAULT_SECURITY_SETTINGS });
    assert.deepEqual(page.appLock, { on: false });
    assert.equal(page.lockAfter, null);
    assert.equal(page.pinButton, 'set-up-app-lock');
    assert.deepEqual(ALWAYS_ON_PROTECTIONS, ['fileEncryption', 'hideHistory', 'malwareWarning']);
    for (const key of ALWAYS_ON_PROTECTIONS) {
      assert.deepEqual(page.protections[key], { on: true, canChange: false });
    }
  });

  test('Malware warning is a plain "Always on" row; encryption and Hide history stay switches', () => {
    assert.deepEqual(
      ALWAYS_ON_PROTECTIONS.filter((key) => isInfoRowProtection(key)),
      ['malwareWarning'],
    );
  });

  test('the stored values: Block screenshots on is kept; only `true` counts as on', () => {
    setBlockScreenshots(true);
    assert.deepEqual(getSecuritySettings(), { blockScreenshots: true });
    const page = securityPageModel({ appLockEnabled: true, settings: getSecuritySettings() });
    assert.deepEqual(page.blockScreenshots, { on: true });
    // App Lock locks as soon as VidoraX leaves the screen: Lock after reads "Immediately".
    assert.equal(page.lockAfter, 'immediately');
    assert.equal(page.pinButton, 'change-pin');
    assert.deepEqual(normalizeSecuritySettings({ blockScreenshots: 'yes' }), { blockScreenshots: false });
    assert.deepEqual(normalizeSecuritySettings(null), { blockScreenshots: false });
  });

  test('Block screenshots secures every screen; Private keeps its own switch', () => {
    assert.equal(appHoldsSecure({ settingOn: true }), true);
    assert.equal(appHoldsSecure({ settingOn: false }), false);
    // Private's own rule is unchanged: on Private only, while its setting is on.
    assert.equal(privateFolderHoldsSecure({ settingOn: true, screenFocused: true }), true);
    assert.equal(privateFolderHoldsSecure({ settingOn: false, screenFocused: true }), false);
  });
});
