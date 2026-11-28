import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FILE_TYPES, type FileType } from '@/files/ui/file-types';

import { FILE_ACTIONS, fileActionsFor } from './file-actions';

const ctx = (type: FileType, overrides: Partial<Parameters<typeof fileActionsFor>[0]> = {}) => ({
  type,
  missing: false,
  canLock: true,
  canSaveTo: true,
  canChecksum: true,
  ...overrides,
});

describe('Files F3 · design 45: which rows the actions sheet shows', () => {
  test('the design’s order: Play, Details, Show in folder, Share, Send to device, Save to…, Lock file, Verify checksum, Open with, Rename, Delete', () => {
    assert.deepEqual(FILE_ACTIONS, [
      'play',
      'details',
      'show-in-folder',
      'share',
      'send-to-device',
      'save-to',
      'lock',
      'checksum',
      'open-with',
      'rename',
      'delete',
    ]);
    assert.deepEqual(fileActionsFor(ctx('video')), [...FILE_ACTIONS]);
  });

  test('for each FileType: Play only for video and audio; an APK never gets Play or Open with', () => {
    const expectations: Record<FileType, { play: boolean; openWith: boolean }> = {
      video: { play: true, openWith: true },
      audio: { play: true, openWith: true },
      image: { play: false, openWith: true },
      doc: { play: false, openWith: true },
      archive: { play: false, openWith: true },
      apk: { play: false, openWith: false },
      other: { play: false, openWith: true },
    };
    for (const type of FILE_TYPES) {
      const rows = fileActionsFor(ctx(type));
      assert.equal(rows.includes('play'), expectations[type].play, `${type} play`);
      assert.equal(rows.includes('open-with'), expectations[type].openWith, `${type} open with`);
      // Every file can be looked at, shared, renamed and deleted.
      for (const always of ['details', 'show-in-folder', 'share', 'send-to-device', 'rename', 'delete'] as const) {
        assert.ok(rows.includes(always), `${type} ${always}`);
      }
    }
  });

  test('a missing file: only Details and Delete', () => {
    for (const type of FILE_TYPES) {
      assert.deepEqual(fileActionsFor(ctx(type, { missing: true })), ['details', 'delete']);
    }
  });

  test('rows this build or file can’t do are hidden', () => {
    const rows = fileActionsFor(ctx('video', { canLock: false, canSaveTo: false, canChecksum: false }));
    assert.ok(!rows.includes('lock'));
    assert.ok(!rows.includes('save-to'));
    assert.ok(!rows.includes('checksum'));
    assert.ok(rows.includes('play'));
  });
});

describe('a file Android’s downloader saved for the browser (picture, document, archive…)', () => {
  test('plays or opens, shares and deletes; the library-only rows are hidden', () => {
    assert.deepEqual(fileActionsFor(ctx('image', { systemDownload: true })), ['share', 'send-to-device', 'open-with', 'delete']);
    assert.deepEqual(fileActionsFor(ctx('audio', { systemDownload: true })), ['play', 'share', 'send-to-device', 'open-with', 'delete']);
    assert.deepEqual(fileActionsFor(ctx('apk', { systemDownload: true })), ['share', 'send-to-device', 'delete']);
  });
});
