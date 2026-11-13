import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { canSaveThumbnail, hasLocalThumbnail, insertActionBefore, thumbnailSaveFailure } from './thumbnail-save';

const OK = {
  engineOwned: true,
  status: 'COMPLETED' as const,
  thumbnailUrl: 'file:///data/user/0/app/files/thumbs/a.webp',
  nativeAvailable: true,
  sdkInt: 34,
};

describe('canSaveThumbnail', () => {
  test('a finished v2 video with a local thumbnail on Android 10+', () => {
    assert.equal(canSaveThumbnail(OK), true);
  });

  test('hidden without a thumbnail, for remote posters, unfinished or v1 rows, or an old native build', () => {
    for (const thumbnailUrl of [null, undefined, '', 'https://cdn.example.com/p.jpg', 'content://x', 'file://']) {
      assert.equal(canSaveThumbnail({ ...OK, thumbnailUrl }), false, String(thumbnailUrl));
    }
    for (const status of ['DOWNLOADING', 'FAILED', 'PAUSED', 'QUEUED', 'CANCELLED'] as const) {
      assert.equal(canSaveThumbnail({ ...OK, status }), false, status);
    }
    assert.equal(canSaveThumbnail({ ...OK, engineOwned: false }), false);
    assert.equal(canSaveThumbnail({ ...OK, nativeAvailable: false }), false);
  });

  test('Android 9 and older only while the storage permission is declared', () => {
    assert.equal(canSaveThumbnail({ ...OK, sdkInt: 28 }), true);
    assert.equal(canSaveThumbnail({ ...OK, sdkInt: 24, legacyPermissionDeclared: false }), false);
    assert.equal(canSaveThumbnail({ ...OK, sdkInt: 29, legacyPermissionDeclared: false }), true);
  });

  test('hasLocalThumbnail', () => {
    assert.equal(hasLocalThumbnail('file:///x.webp'), true);
    assert.equal(hasLocalThumbnail('FILE:///x.webp'), true);
    assert.equal(hasLocalThumbnail('http://x'), false);
  });
});

describe('insertActionBefore', () => {
  const sheet = [{ id: 'open' }, { id: 'share' }, { id: 'delete' }];

  test('inserts before delete', () => {
    assert.deepEqual(insertActionBefore(sheet, { id: 'thumb' }, 'delete').map((a) => a.id), ['open', 'share', 'thumb', 'delete']);
  });

  test('appends when there is no delete; unchanged without an extra action', () => {
    assert.deepEqual(insertActionBefore([{ id: 'open' }], { id: 'thumb' }, 'delete').map((a) => a.id), ['open', 'thumb']);
    assert.equal(insertActionBefore(sheet, null, 'delete'), sheet);
  });
});

describe('thumbnailSaveFailure', () => {
  test('maps the native error codes', () => {
    assert.equal(thumbnailSaveFailure({ code: 'ERR_STORAGE_PERMISSION' }), 'permission');
    assert.equal(thumbnailSaveFailure({ code: 'ERR_NOT_FOUND' }), 'missing');
    assert.equal(thumbnailSaveFailure(new Error('x')), 'failed');
    assert.equal(thumbnailSaveFailure(null), 'failed');
  });
});
