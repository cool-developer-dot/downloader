import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { indexLibraryItems, nextInFolder } from './queue-media-index';

const item = (id: string, displayName: string, folderId: string | null, missing = false) => ({
  id,
  displayName,
  fileName: `${displayName}.mp4`,
  duration: null,
  localAvailability: missing ? ('missing' as const) : ('available' as const),
  folderId,
});

describe('next in its folder (#534 with no queue)', () => {
  const index = indexLibraryItems([
    item('e10', 'Episode 10', 'f1'),
    item('e2', 'Episode 2', 'f1'),
    item('e1', 'Episode 1', 'f1'),
    item('e3', 'Episode 3', 'f1', true),
    item('other', 'Episode 2', 'f2'),
    item('top1', 'Alpha', null),
    item('top2', 'Beta', null),
  ]);

  test('goes by name, numbers in order ("Episode 2" before "Episode 10")', () => {
    assert.equal(nextInFolder(index, 'e1'), 'e2');
  });

  test('skips a missing file, and stops at the end of the folder', () => {
    assert.equal(nextInFolder(index, 'e2'), 'e10');
    assert.equal(nextInFolder(index, 'e10'), null);
  });

  test('stays in the folder; videos in no folder share the top level', () => {
    assert.equal(nextInFolder(index, 'other'), null);
    assert.equal(nextInFolder(index, 'top1'), 'top2');
  });

  test('a video outside the library has no folder', () => {
    assert.equal(nextInFolder(index, 'device:9'), null);
    assert.equal(nextInFolder(index, null), null);
  });

  test('indexes titles (falling back to the file name), lengths and missing files', () => {
    const one = indexLibraryItems([{ ...item('x', '', null), duration: 61 }]).get('x');
    assert.deepEqual(one, { id: 'x', title: '.mp4', durationSeconds: 61, missing: false, folderKey: '' });
    assert.equal(index.get('e3')?.missing, true);
  });
});
