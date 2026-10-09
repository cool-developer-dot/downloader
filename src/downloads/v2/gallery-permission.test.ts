import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  decideGalleryPermission,
  ensureGalleryPermission,
  resetGalleryPermissionPromptForTests,
} from './gallery-permission';

describe('gallery copy permission', () => {
  test('Android 10 and later publish through MediaStore without any permission', () => {
    for (const version of [29, 33, 35, 36]) {
      assert.equal(
        decideGalleryPermission({ platform: 'android', version, granted: false, alreadyAsked: false }),
        'not-required',
        String(version),
      );
    }
  });

  test('Android 7-9 ask once from the download gesture, then report the answer', () => {
    assert.equal(decideGalleryPermission({ platform: 'android', version: 28, granted: false, alreadyAsked: false }), 'ask');
    assert.equal(decideGalleryPermission({ platform: 'android', version: 24, granted: false, alreadyAsked: true }), 'denied');
    assert.equal(decideGalleryPermission({ platform: 'android', version: 26, granted: true, alreadyAsked: true }), 'granted');
  });

  test('never a gate: without the permission API a download still starts', async () => {
    resetGalleryPermissionPromptForTests();
    assert.equal(await ensureGalleryPermission(), 'not-required');
  });
});
