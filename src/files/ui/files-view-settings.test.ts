import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  DEFAULT_FILES_VIEW_SETTINGS,
  GRID_COLUMNS,
  getFilesViewSettings,
  isConfirmBeforeDeleteOn,
  LIST_THUMBNAIL_DP,
  normalizeFilesViewSettings,
  setFilesViewSettings,
} from './files-view-settings';

afterEach(() => {
  setFilesViewSettings(DEFAULT_FILES_VIEW_SETTINGS);
});

describe('Files F2: file manager settings (vidorax.files.viewSettings.v1)', () => {
  test('the defaults: list, thumbnails on, Medium, hidden files off, Name ascending, folders first, no extensions, confirm on', () => {
    assert.deepEqual(DEFAULT_FILES_VIEW_SETTINGS, {
      viewMode: 'list',
      showThumbnails: true,
      thumbnailSize: 'medium',
      showHidden: false,
      sortKey: 'name',
      sortDirection: 'asc',
      foldersFirst: true,
      showExtensions: false,
      confirmDelete: true,
    });
    assert.deepEqual(normalizeFilesViewSettings(undefined), DEFAULT_FILES_VIEW_SETTINGS);
    assert.deepEqual(normalizeFilesViewSettings(null), DEFAULT_FILES_VIEW_SETTINGS);
    // Nothing stored yet (MMKV is empty under Node): the defaults, and deletes ask first.
    assert.deepEqual(getFilesViewSettings(), DEFAULT_FILES_VIEW_SETTINGS);
    assert.equal(isConfirmBeforeDeleteOn(), true);
    // Thumbnail size: 40 / 56 / 72 dp in a list, 4 / 3 / 2 columns in the grid.
    assert.deepEqual(LIST_THUMBNAIL_DP, { small: 40, medium: 56, large: 72 });
    assert.deepEqual(GRID_COLUMNS, { small: 4, medium: 3, large: 2 });
  });

  test('bad or old stored values are normalized', () => {
    assert.deepEqual(
      normalizeFilesViewSettings({
        viewMode: 'tiles',
        showThumbnails: 'yes',
        thumbnailSize: 'huge',
        showHidden: null,
        sortKey: 'random',
        sortDirection: 'sideways',
        foldersFirst: 7,
        showExtensions: [],
        confirmDelete: undefined,
      }),
      DEFAULT_FILES_VIEW_SETTINGS,
    );
    // Older spellings: the dp size, "descending", a combined sort, booleans as strings or numbers.
    assert.deepEqual(
      normalizeFilesViewSettings({
        viewMode: 'grid',
        thumbnailSize: 72,
        sort: 'size_desc',
        foldersFirst: 0,
        showExtensions: 'true',
        confirmDelete: 'false',
      }),
      {
        ...DEFAULT_FILES_VIEW_SETTINGS,
        viewMode: 'grid',
        thumbnailSize: 'large',
        sortKey: 'size',
        sortDirection: 'desc',
        foldersFirst: false,
        showExtensions: true,
        confirmDelete: false,
      },
    );
    assert.equal(normalizeFilesViewSettings({ sortDirection: 'ascending', sortKey: 'date' }).sortDirection, 'asc');
    // Not an object at all.
    for (const broken of ['grid', 42, true, ['list'], Number.NaN]) {
      assert.deepEqual(normalizeFilesViewSettings(broken), DEFAULT_FILES_VIEW_SETTINGS);
    }
  });

  test('unknown keys are ignored', () => {
    const value = normalizeFilesViewSettings({ viewMode: 'grid', colour: 'red', __proto__x: 1, extra: { deep: true } });
    assert.deepEqual(Object.keys(value).sort(), Object.keys(DEFAULT_FILES_VIEW_SETTINGS).sort());
    assert.equal(value.viewMode, 'grid');
  });

  test('a change applies at once and stays valid', () => {
    setFilesViewSettings({ confirmDelete: false, sortKey: 'size' });
    assert.equal(isConfirmBeforeDeleteOn(), false);
    assert.equal(getFilesViewSettings().sortKey, 'size');
    // A bad value in a change is refused (normalized), the rest kept.
    setFilesViewSettings({ viewMode: 'carousel' as never });
    assert.equal(getFilesViewSettings().viewMode, 'list');
    assert.equal(getFilesViewSettings().sortKey, 'size');
  });
});
