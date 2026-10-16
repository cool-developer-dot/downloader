import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  copySubfolders,
  DEFAULT_SAVE_LOCATION,
  folderLabelFromTreeUri,
  MAX_CATCH_UP,
  MAX_COPY_RECORDS,
  MAX_FOLDER_NAME_LENGTH,
  normalizeCopyRecords,
  normalizeSaveLocation,
  pendingCopyIds,
  reduceSaveLocation,
  sanitizeFolderName,
  showInFolderTarget,
  siteFolderName,
  withCopyRecord,
  withoutCopyRecords,
  type ExternalCopyRecord,
  type SaveLocationSettings,
} from './save-location';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3AMovies';
const SD_TREE = 'content://com.android.externalstorage.documents/tree/1A2B-3C4D%3AVideos%2FSaved';

function on(overrides: Partial<SaveLocationSettings> = {}): SaveLocationSettings {
  return { ...DEFAULT_SAVE_LOCATION, enabled: true, treeUri: TREE, folderName: 'Movies', enabledAt: 1_000, ...overrides };
}

describe('defaults', () => {
  test('everything is off: downloads are saved exactly as before', () => {
    assert.deepEqual(DEFAULT_SAVE_LOCATION, {
      enabled: false,
      treeUri: null,
      folderName: null,
      byType: false,
      bySite: false,
      enabledAt: null,
      accessLost: false,
    });
    assert.deepEqual(normalizeSaveLocation(undefined), DEFAULT_SAVE_LOCATION);
    assert.deepEqual(normalizeSaveLocation('nope'), DEFAULT_SAVE_LOCATION);
  });

  test('stored values are validated: no folder means off, a non-tree URI is dropped', () => {
    assert.equal(normalizeSaveLocation({ enabled: true }).enabled, false);
    assert.equal(normalizeSaveLocation({ enabled: true, treeUri: 'file:///sdcard/Movies' }).treeUri, null);
    assert.equal(normalizeSaveLocation({ enabled: true, treeUri: 'content://x/document/1' }).enabled, false);
    const kept = normalizeSaveLocation({ enabled: true, treeUri: TREE, folderName: 'Movies', byType: true, enabledAt: 5 });
    assert.equal(kept.enabled, true);
    assert.equal(kept.byType, true);
    assert.equal(kept.bySite, false);
    assert.equal(kept.enabledAt, 5);
  });
});

describe('choosing an option', () => {
  test('turning on without a folder does nothing until one is picked', () => {
    const next = reduceSaveLocation(DEFAULT_SAVE_LOCATION, { type: 'set-enabled', enabled: true, now: 10 });
    assert.equal(next, DEFAULT_SAVE_LOCATION);
  });

  test('picking a folder turns the copy on from that moment', () => {
    const next = reduceSaveLocation(DEFAULT_SAVE_LOCATION, { type: 'picked', treeUri: TREE, folderName: 'Movies', now: 42 });
    assert.equal(next.enabled, true);
    assert.equal(next.treeUri, TREE);
    assert.equal(next.folderName, 'Movies');
    assert.equal(next.enabledAt, 42);
  });

  test('a folder without a provider name is named from its URI', () => {
    const next = reduceSaveLocation(DEFAULT_SAVE_LOCATION, { type: 'picked', treeUri: SD_TREE, folderName: null, now: 1 });
    assert.equal(next.folderName, 'Videos/Saved');
  });

  test('Change keeps the moment the copy was turned on', () => {
    const next = reduceSaveLocation(on(), { type: 'picked', treeUri: SD_TREE, folderName: 'Saved', now: 99 });
    assert.equal(next.treeUri, SD_TREE);
    assert.equal(next.enabledAt, 1_000);
  });

  test('a URI that is not a picked folder is ignored', () => {
    const state = on();
    assert.equal(reduceSaveLocation(state, { type: 'picked', treeUri: 'https://evil.example/tree/x', folderName: 'x', now: 1 }), state);
  });

  test('off keeps the folder, so on needs no new pick; on again starts a new period', () => {
    const off = reduceSaveLocation(on(), { type: 'set-enabled', enabled: false, now: 5 });
    assert.equal(off.enabled, false);
    assert.equal(off.treeUri, TREE);
    const again = reduceSaveLocation(off, { type: 'set-enabled', enabled: true, now: 7_000 });
    assert.equal(again.enabled, true);
    assert.equal(again.enabledAt, 7_000);
  });

  test('sub-options change only themselves', () => {
    const typed = reduceSaveLocation(on(), { type: 'set-by-type', value: true });
    assert.equal(typed.byType, true);
    assert.equal(typed.bySite, false);
    const sited = reduceSaveLocation(typed, { type: 'set-by-site', value: true });
    assert.equal(sited.bySite, true);
    assert.equal(reduceSaveLocation(sited, { type: 'set-by-site', value: true }), sited);
  });

  test('Remove forgets the folder and turns the copy off', () => {
    const next = reduceSaveLocation(on({ byType: true }), { type: 'remove' });
    assert.equal(next.enabled, false);
    assert.equal(next.treeUri, null);
    assert.equal(next.folderName, null);
    assert.equal(next.byType, true);
  });
});

describe('revoked permission', () => {
  test('access lost turns the option off, forgets the folder and is shown until dismissed or re-picked', () => {
    const lost = reduceSaveLocation(on(), { type: 'access-lost' });
    assert.equal(lost.enabled, false);
    assert.equal(lost.treeUri, null);
    assert.equal(lost.accessLost, true);
    assert.equal(reduceSaveLocation(lost, { type: 'dismiss-access-lost' }).accessLost, false);
    const repicked = reduceSaveLocation(lost, { type: 'picked', treeUri: TREE, folderName: 'Movies', now: 3 });
    assert.equal(repicked.accessLost, false);
    assert.equal(repicked.enabled, true);
  });

  test('a stored "lost" flag is not kept next to a working folder', () => {
    assert.equal(normalizeSaveLocation({ enabled: true, treeUri: TREE, accessLost: true }).accessLost, false);
  });
});

describe('subfolder paths', () => {
  const video = { mimeType: 'video/mp4', site: 'instagram', pageUrl: 'https://www.instagram.com/reel/x' };

  test('no sub-options: straight into the picked folder', () => {
    assert.deepEqual(copySubfolders({ byType: false, bySite: false }, video), []);
  });

  test('type first, then site', () => {
    assert.deepEqual(copySubfolders({ byType: true, bySite: false }, video), ['Videos']);
    assert.deepEqual(copySubfolders({ byType: false, bySite: true }, video), ['Instagram']);
    assert.deepEqual(copySubfolders({ byType: true, bySite: true }, video), ['Videos', 'Instagram']);
  });

  test('audio-only files go to Audio', () => {
    assert.deepEqual(copySubfolders({ byType: true, bySite: false }, { ...video, mimeType: 'audio/mp4' }), ['Audio']);
    assert.deepEqual(copySubfolders({ byType: true, bySite: false }, { ...video, mimeType: 'AUDIO/MPEG' }), ['Audio']);
  });

  test('site folders: the Gallery names for known sites, the host for other websites', () => {
    assert.equal(siteFolderName('twitter', null), 'X');
    assert.equal(siteFolderName('tiktok', 'https://www.tiktok.com/@a/video/1'), 'TikTok');
    assert.equal(siteFolderName('web', 'https://WWW.Example.com/watch?v=1'), 'example.com');
    assert.equal(siteFolderName('web', null), 'Web');
    assert.equal(siteFolderName('web', 'not a url'), 'Web');
    assert.equal(siteFolderName('unknown-site', 'https://videos.example.org/a'), 'videos.example.org');
  });
});

describe('sanitizing folder names', () => {
  test('illegal characters become spaces and whitespace collapses', () => {
    assert.equal(sanitizeFolderName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
    assert.equal(sanitizeFolderName('tab\tand\nnewline'), 'tab and newline');
  });

  test('Urdu, Arabic, CJK and emoji are kept as they are', () => {
    assert.equal(sanitizeFolderName('میری ویڈیوز'), 'میری ویڈیوز');
    assert.equal(sanitizeFolderName('動画 🎬'), '動画 🎬');
    assert.equal(sanitizeFolderName('فيديو'), 'فيديو');
  });

  test('dots and spaces at the ends go, so "." and ".." are never names and nothing is hidden', () => {
    assert.equal(sanitizeFolderName('..'), '');
    assert.equal(sanitizeFolderName('.'), '');
    assert.equal(sanitizeFolderName('  .hidden. '), 'hidden');
    assert.equal(sanitizeFolderName('../../etc'), 'etc');
  });

  test('invisible direction marks are removed', () => {
    assert.equal(sanitizeFolderName('abc‮gpj.exe'), 'abcgpj.exe');
    assert.equal(sanitizeFolderName('‏ویڈیو‎'), 'ویڈیو');
  });

  test('long names are capped by code points without splitting a character', () => {
    const urdu = sanitizeFolderName('ویڈیو'.repeat(40));
    assert.equal(Array.from(urdu).length <= MAX_FOLDER_NAME_LENGTH, true);
    assert.equal(urdu.includes('�'), false);
    const emoji = sanitizeFolderName('🎬'.repeat(100));
    assert.equal(Array.from(emoji).length, MAX_FOLDER_NAME_LENGTH);
  });
});

describe('folder label from a tree URI', () => {
  test('internal storage and SD card folders read as their path', () => {
    assert.equal(folderLabelFromTreeUri(TREE), 'Movies');
    assert.equal(folderLabelFromTreeUri(SD_TREE), 'Videos/Saved');
    assert.equal(
      folderLabelFromTreeUri('content://com.android.externalstorage.documents/tree/primary%3A%D9%88%DB%8C%DA%88%DB%8C%D9%88'),
      'ویڈیو',
    );
  });

  test('nothing readable gives null', () => {
    assert.equal(folderLabelFromTreeUri('content://x/document/1'), null);
    assert.equal(folderLabelFromTreeUri('content://com.android.externalstorage.documents/tree/primary%3A'), null);
    assert.equal(folderLabelFromTreeUri('content://x/tree/%E0%A4%A'), null);
  });
});

describe('record keeping', () => {
  const copied = (at: number): ExternalCopyRecord => ({
    status: 'copied',
    folderUri: `${TREE}/document/primary%3AMovies`,
    documentUri: `${TREE}/document/primary%3AMovies%2Fclip.mp4`,
    name: 'clip.mp4',
    folderLabel: 'Movies',
    at,
  });

  test('a record is set per item and forgotten on delete without touching anything else', () => {
    const one = withCopyRecord({}, 'a', copied(1));
    const two = withCopyRecord(one, 'b', { status: 'failed', reason: 'storage', at: 2 });
    assert.deepEqual(Object.keys(two).sort(), ['a', 'b']);
    const without = withoutCopyRecords(two, ['a', 'zzz']);
    assert.deepEqual(Object.keys(without), ['b']);
    assert.equal(withoutCopyRecords(without, ['nope']), without);
  });

  test('records are capped, oldest dropped first, the newest always kept', () => {
    let records = {};
    for (let i = 0; i < MAX_COPY_RECORDS + 5; i += 1) {
      records = withCopyRecord(records, `id${i}`, copied(i));
    }
    assert.equal(Object.keys(records).length, MAX_COPY_RECORDS);
    assert.equal('id0' in records, false);
    assert.equal(`id${MAX_COPY_RECORDS + 4}` in records, true);
  });

  test('stored records are validated; malformed ones are dropped', () => {
    const records = normalizeCopyRecords({
      good: copied(5),
      failed: { status: 'failed', reason: 'access', at: 6 },
      badUri: { ...copied(1), folderUri: 'file:///sdcard' },
      noTime: { status: 'failed', reason: 'storage' },
      junk: 'x',
    });
    assert.deepEqual(Object.keys(records).sort(), ['failed', 'good']);
    assert.deepEqual(normalizeCopyRecords(null), {});
  });

  test('Show in folder only for an item with a copy', () => {
    assert.equal(showInFolderTarget(undefined), null);
    assert.equal(showInFolderTarget({ status: 'failed', reason: 'storage', at: 1 }), null);
    assert.deepEqual(showInFolderTarget(copied(1)), {
      folderUri: `${TREE}/document/primary%3AMovies`,
      folderLabel: 'Movies',
      name: 'clip.mp4',
    });
  });
});

describe('catch-up', () => {
  const items = [
    { id: 'old', completedAt: 500 },
    { id: 'b', completedAt: 3_000 },
    { id: 'a', completedAt: 2_000 },
    { id: 'done', completedAt: 2_500 },
    { id: 'busy', completedAt: 2_600 },
  ];

  test('items completed since the copy was turned on, without a record, oldest first', () => {
    const records = { done: { status: 'copied', folderUri: 'content://f', documentUri: 'content://d', name: 'n', folderLabel: null, at: 1 } } as const;
    assert.deepEqual(pendingCopyIds(items, records, on(), new Set(['busy'])), ['a', 'b']);
  });

  test('nothing while the copy is off or has no folder', () => {
    assert.deepEqual(pendingCopyIds(items, {}, on({ enabled: false })), []);
    assert.deepEqual(pendingCopyIds(items, {}, on({ treeUri: null })), []);
    assert.deepEqual(pendingCopyIds(items, {}, on({ enabledAt: null })), []);
  });

  test('a pass is bounded', () => {
    const many = Array.from({ length: MAX_CATCH_UP + 10 }, (_, i) => ({ id: `i${i}`, completedAt: 2_000 + i }));
    assert.equal(pendingCopyIds(many, {}, on()).length, MAX_CATCH_UP);
  });
});
