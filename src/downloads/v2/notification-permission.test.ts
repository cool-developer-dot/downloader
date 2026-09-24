import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  decideNotificationPermission,
  ensureDownloadNotificationPermission,
  resetNotificationPermissionPromptForTests,
} from './notification-permission';

describe('download notification permission', () => {
  test('Android 12 and below never needs a runtime prompt', () => {
    assert.equal(
      decideNotificationPermission({ platform: 'android', version: 31, granted: false, alreadyAsked: false }),
      'not-required',
    );
  });

  test('Android 13+ asks once and then reports the denial', () => {
    assert.equal(
      decideNotificationPermission({ platform: 'android', version: 33, granted: false, alreadyAsked: false }),
      'ask',
    );
    assert.equal(
      decideNotificationPermission({ platform: 'android', version: 36, granted: false, alreadyAsked: true }),
      'denied',
      'a second prompt in the same run would be silently refused by Android',
    );
    assert.equal(
      decideNotificationPermission({ platform: 'android', version: 36, granted: true, alreadyAsked: true }),
      'granted',
    );
  });

  test('a build without the permission API still starts downloads', async () => {
    resetNotificationPermissionPromptForTests();
    assert.equal(await ensureDownloadNotificationPermission(), 'not-required');
  });
});
