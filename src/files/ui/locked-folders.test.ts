import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { applyLibraryQuery } from '@/library/query';
import type { MediaLibraryItem } from '@/library/types';

import { buildFilesIndex, typeCountsOf } from './files-index';
import {
  hiddenFolderIds,
  lockFolder,
  lockedNowIds,
  needsUnlock,
  normalizeLockedFolderIds,
  pruneLockedFolders,
  relockAllFolders,
  relocksOn,
  removeFolderLock,
  unlockFolderForSession,
  useLockedFoldersStore,
  withoutLockedFiles,
} from './locked-folders';

afterEach(() => {
  useLockedFoldersStore.setState({ locked: [], sessionUnlocked: [] });
});

const media = (id: string, folderId: string | null, mimeType = 'video/mp4'): MediaLibraryItem => ({
  id,
  downloadId: id,
  displayName: `${id}.mp4`,
  fileName: `${id}.mp4`,
  mimeType,
  fileSize: '100',
  quality: null,
  resolution: null,
  bitrate: null,
  duration: null,
  downloadedAt: null,
  favorite: false,
  folderId,
  folderName: null,
  localAvailability: 'available',
  thumbnailUri: null,
  lastPlayedAt: null,
  progressPercent: null,
  positionSeconds: null,
  completed: false,
});

const LIBRARY = [media('open', null), media('inA', 'A'), media('inB', 'B'), media('song', 'A', 'audio/mpeg')];
const FOLDERS = [
  { id: 'A', name: 'A', parentId: null },
  { id: 'B', name: 'B', parentId: null },
  { id: 'A1', name: 'A1', parentId: 'A' },
];

function state() {
  const { locked, sessionUnlocked } = useLockedFoldersStore.getState();
  return { locked, sessionUnlocked: new Set(sessionUnlocked) };
}

describe('Files F10 #910: folder lock', () => {
  test('a locked folder’s files are left out of the type tiles, search and the Player tab', () => {
    lockFolder('A');
    const { locked, sessionUnlocked } = state();
    const hidden = hiddenFolderIds(lockedNowIds(locked, sessionUnlocked), FOLDERS);
    // Its subfolders too, once folders nest.
    assert.deepEqual([...hidden].sort(), ['A', 'A1']);

    // Type tiles: the video and the song in A no longer count.
    const index = buildFilesIndex(LIBRARY, FOLDERS);
    const counts = typeCountsOf(withoutLockedFiles(index.files, hidden));
    assert.equal(counts.video.count, 2);
    assert.equal(counts.audio.count, 0);

    // Search works on the same filtered list (F6 searches only what this leaves).
    assert.deepEqual(
      withoutLockedFiles(index.files, hidden).map((file) => file.id),
      ['open', 'inB'],
    );

    // The Player tab: the locked ids join the folders its query leaves out.
    const playerTab = applyLibraryQuery(LIBRARY, {
      search: '',
      filter: 'all',
      sort: 'name_asc',
      quality: null,
      folderId: null,
      recentDownloadWindowMs: 0,
      nowMs: 0,
      excludedFolderIds: [...hidden],
    });
    assert.deepEqual(
      playerTab.items.map((entry) => entry.id),
      ['inB', 'open'],
    );
  });

  test('opening it asks for the PIN; after the PIN it stays open for the session', () => {
    lockFolder('A');
    assert.equal(needsUnlock('A', ['A'], state().locked, state().sessionUnlocked), true);
    // A folder under a locked one asks too.
    assert.equal(needsUnlock('A1', ['A', 'A1'], state().locked, state().sessionUnlocked), true);
    assert.equal(needsUnlock('B', ['B'], state().locked, state().sessionUnlocked), false);
    unlockFolderForSession('A');
    assert.equal(needsUnlock('A', ['A'], state().locked, state().sessionUnlocked), false);
    assert.deepEqual(lockedNowIds(state().locked, state().sessionUnlocked), []);
    // Still locked for good: the next session asks again.
    assert.deepEqual(state().locked, ['A']);
  });

  test('it locks again when the app locks, or when App Lock is turned off', () => {
    lockFolder('A');
    unlockFolderForSession('A');
    assert.equal(relocksOn({ isEnabled: true, status: 'UNLOCKED' }, { isEnabled: true, status: 'LOCKED' }), true);
    assert.equal(relocksOn({ isEnabled: true, status: 'UNLOCKED' }, { isEnabled: false, status: 'DISABLED' }), true);
    // The lock screen's own updates (an attempt, the throttle) change nothing.
    assert.equal(relocksOn({ isEnabled: true, status: 'LOCKED' }, { isEnabled: true, status: 'LOCKED' }), false);
    assert.equal(relocksOn({ isEnabled: true, status: 'LOCKED' }, { isEnabled: true, status: 'UNLOCKED' }), false);
    relockAllFolders();
    assert.equal(needsUnlock('A', ['A'], state().locked, state().sessionUnlocked), true);
  });

  test('stored ids are checked; removing a lock or deleting the folder forgets it', () => {
    assert.deepEqual(normalizeLockedFolderIds(['A', 'A', '', 3, null, 'B']), ['A', 'B']);
    assert.deepEqual(normalizeLockedFolderIds('A'), []);
    lockFolder('A');
    lockFolder('B');
    removeFolderLock('A');
    assert.deepEqual(state().locked, ['B']);
    pruneLockedFolders(['A']);
    assert.deepEqual(state().locked, []);
  });
});
