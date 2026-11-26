import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildFilesIndex } from '@/files/ui/files-index';
import { applyLibraryQuery } from '@/library/query';
import type { MediaLibraryItem } from '@/library/types';

import { normalizeHiddenIds, withoutHiddenIds, withoutHiddenItems } from './hidden-items';

const media = (id: string): MediaLibraryItem => ({
  id,
  downloadId: id,
  displayName: `${id}.mp4`,
  fileName: `${id}.mp4`,
  mimeType: 'video/mp4',
  fileSize: '100',
  quality: null,
  resolution: null,
  bitrate: null,
  duration: null,
  downloadedAt: null,
  favorite: false,
  folderId: null,
  folderName: null,
  localAvailability: 'available',
  thumbnailUri: null,
  lastPlayedAt: null,
  progressPercent: null,
  positionSeconds: null,
  completed: false,
});

const HIDDEN = new Set(['secret']);
const LIBRARY = [media('open'), media('secret'), media('other')];

describe('Files F7 #911: hidden files', () => {
  test('the Files lists leave a hidden file out, and show it when Show hidden files is on', () => {
    const files = buildFilesIndex(LIBRARY, []).files;
    assert.deepEqual(
      withoutHiddenItems(files, HIDDEN, false).map((file) => file.id),
      ['open', 'other'],
    );
    assert.deepEqual(
      withoutHiddenItems(files, HIDDEN, true).map((file) => file.id),
      ['open', 'secret', 'other'],
    );
  });

  test('the Player tab leaves it out before its own query, and shows it when the setting is on', () => {
    const query = (items: MediaLibraryItem[]) =>
      applyLibraryQuery(items, { search: '', filter: 'all', sort: 'name_asc', quality: null, folderId: null, recentDownloadWindowMs: 0, nowMs: 0 }).items.map(
        (item) => item.id,
      );
    assert.deepEqual(query(withoutHiddenItems(LIBRARY, HIDDEN, false)), ['open', 'other']);
    assert.deepEqual(query(withoutHiddenItems(LIBRARY, HIDDEN, true)), ['open', 'other', 'secret']);
  });

  test('Downloads (a list of ids) leaves it out, and shows it when the setting is on', () => {
    assert.deepEqual(withoutHiddenIds(['open', 'secret', 'queued'], HIDDEN, false), ['open', 'queued']);
    assert.deepEqual(withoutHiddenIds(['open', 'secret', 'queued'], HIDDEN, true), ['open', 'secret', 'queued']);
  });

  test('stored hidden ids are checked', () => {
    assert.deepEqual(normalizeHiddenIds(['a', 'a', '', 4, null, 'b']), ['a', 'b']);
    assert.deepEqual(normalizeHiddenIds({ a: true }), []);
  });
});
