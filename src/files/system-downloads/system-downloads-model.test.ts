import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { fileTypeOf } from '@/files/engine/file-types';

import { downloadIdOf, isSystemDownloadId, systemDownloadItems, systemDownloadToItem } from './system-downloads-model';

const PHOTO = { id: '41', title: 'beach.jpg', mimeType: 'image/jpeg', sizeBytes: 20480, modifiedAt: Date.UTC(2026, 10, 27), uri: 'content://downloads/all_downloads/41' };

describe('files the browser handed to Android’s DownloadManager', () => {
  test('become Files items: own id, name, type, size, date; a picture is its own thumbnail', () => {
    const item = systemDownloadToItem(PHOTO);
    assert.equal(item.id, 'sysdl:41');
    assert.equal(item.fileName, 'beach.jpg');
    assert.equal(item.displayName, 'beach');
    assert.equal(item.fileSize, '20480');
    assert.equal(item.downloadedAt, '2026-11-27T00:00:00.000Z');
    assert.equal(item.folderId, null);
    assert.equal(item.localAvailability, 'available');
    assert.equal(item.thumbnailUri, PHOTO.uri);
    assert.equal(fileTypeOf(item.mimeType, item.fileName), 'image');
  });

  test('every family of the formats guide lands in its tile', () => {
    const typeOf = (title: string, mimeType: string | null) => {
      const item = systemDownloadToItem({ ...PHOTO, title, mimeType });
      return fileTypeOf(item.mimeType, item.fileName);
    };
    assert.equal(typeOf('song.flac', 'audio/flac'), 'audio');
    assert.equal(typeOf('report.pdf', 'application/pdf'), 'doc');
    assert.equal(typeOf('sheet.xlsx', null), 'doc');
    assert.equal(typeOf('pack.zip', 'application/zip'), 'archive');
    assert.equal(typeOf('app.apk', 'application/vnd.android.package-archive'), 'apk');
    assert.equal(typeOf('clip.ogv', 'video/ogg'), 'video');
    assert.equal(typeOf('font.ttf', 'font/ttf'), 'other');
  });

  test('only a document is never shown as a picture', () => {
    assert.equal(systemDownloadToItem({ ...PHOTO, title: 'notes.pdf', mimeType: 'application/pdf' }).thumbnailUri, null);
  });

  test('bad rows are dropped, each id once', () => {
    const items = systemDownloadItems([PHOTO, PHOTO, { id: 'x', uri: 'content://a' }, { id: '7' }, null, 5]);
    assert.deepEqual(items.map((item) => item.id), ['sysdl:41']);
    assert.deepEqual(systemDownloadItems('nope'), []);
  });

  test('ids: only sysdl:<number> is one', () => {
    assert.equal(isSystemDownloadId('sysdl:41'), true);
    assert.equal(isSystemDownloadId('sysdl:'), false);
    assert.equal(isSystemDownloadId('sysdl:../x'), false);
    assert.equal(isSystemDownloadId('abc'), false);
    assert.equal(downloadIdOf('sysdl:41'), '41');
    assert.equal(downloadIdOf('41'), null);
  });
});
