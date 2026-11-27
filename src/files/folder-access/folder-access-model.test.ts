import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isRemovableTree,
  labelOfTree,
  normalizeAddedFolders,
  pickedFileId,
  treeDocumentIdOf,
  viewAddedFolders,
  volumeIdOf,
} from './folder-access-model';

const PHONE = 'content://com.android.externalstorage.documents/tree/primary%3AMovies';
const CARD = 'content://com.android.externalstorage.documents/tree/1A2B-3C4D%3ADCIM%2FCamera';
const CARD_ROOT = 'content://com.android.externalstorage.documents/tree/1A2B-3C4D%3A';
const DRIVE = 'content://com.google.android.apps.docs.storage/tree/acc%3Dx%3Bdoc%3Droot';

describe('trees and volumes', () => {
  test('document ids are decoded', () => {
    assert.equal(treeDocumentIdOf(PHONE), 'primary:Movies');
    assert.equal(treeDocumentIdOf(CARD), '1A2B-3C4D:DCIM/Camera');
    assert.equal(treeDocumentIdOf('content://x/document/1'), null);
  });

  test('primary is the phone; a card id is removable; other providers are neither', () => {
    assert.equal(volumeIdOf(PHONE), 'primary');
    assert.equal(volumeIdOf(CARD), '1A2B-3C4D');
    assert.equal(isRemovableTree(PHONE), false);
    assert.equal(isRemovableTree(CARD), true);
    assert.equal(isRemovableTree(CARD_ROOT), true);
    assert.equal(volumeIdOf(DRIVE), null);
    assert.equal(isRemovableTree(DRIVE), false);
  });

  test('labels: the last folder, or the card id at its root', () => {
    assert.equal(labelOfTree(PHONE), 'Movies');
    assert.equal(labelOfTree(CARD), 'Camera');
    assert.equal(labelOfTree(CARD_ROOT), '1A2B-3C4D');
  });
});

describe('added folders', () => {
  test('normalize: content URIs only, no duplicates, labels filled', () => {
    const out = normalizeAddedFolders([
      { treeUri: PHONE, label: 'Movies', addedAt: 1 },
      { treeUri: PHONE, label: 'again', addedAt: 2 },
      { treeUri: 'file:///sdcard', label: 'bad' },
      { treeUri: CARD },
      null,
    ]);
    assert.deepEqual(out.map((f) => [f.label, f.addedAt]), [
      ['Movies', 1],
      ['Camera', 0],
    ]);
    assert.deepEqual(normalizeAddedFolders('x'), []);
  });

  test('view: removable for the SD card chip; inaccessible once the grant is gone', () => {
    const added = normalizeAddedFolders([{ treeUri: PHONE }, { treeUri: CARD }]);
    const view = viewAddedFolders(added, [`${PHONE}/`]);
    const byLabel = Object.fromEntries(view.map((f) => [f.label, f]));
    assert.equal(byLabel.Movies!.removable, false);
    assert.equal(byLabel.Movies!.accessible, true);
    assert.equal(byLabel.Camera!.removable, true);
    assert.equal(byLabel.Camera!.accessible, false);
    // Unknown grants (older build): assume accessible.
    assert.ok(viewAddedFolders(added, null).every((f) => f.accessible));
  });
});

describe('pickedFileId', () => {
  test('stable, short, no route-breaking characters, different for different files', () => {
    const a = pickedFileId(`${PHONE}/document/primary%3AMovies%2Fa.mp4`);
    assert.equal(a, pickedFileId(`${PHONE}/document/primary%3AMovies%2Fa.mp4`));
    assert.notEqual(a, pickedFileId(`${PHONE}/document/primary%3AMovies%2Fb.mp4`));
    assert.match(a, /^saf-[0-9a-f]+$/);
  });
});
