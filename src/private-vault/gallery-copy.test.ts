import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { isExternalUiOpen } from './external-ui';
import {
  canOfferGalleryRemoval,
  galleryRemovalMessageKey,
  getGalleryCopyPort,
  normalizeRemovalOutcome,
  removeGalleryCopyAfterMove,
  setGalleryCopyPortForTests,
  type GalleryCopyPort,
} from './gallery-copy';

const URI = 'content://media/external_primary/video/media/41';

afterEach(() => setGalleryCopyPortForTests(undefined));

describe('Also remove the Gallery copy (H21)', () => {
  test('offered only for a video with a Gallery copy, on a build that can remove it', () => {
    const port: GalleryCopyPort = { removeGalleryCopy: async () => 'removed' };
    assert.equal(canOfferGalleryRemoval(URI, port), true);
    assert.equal(canOfferGalleryRemoval(null, port), false);
    assert.equal(canOfferGalleryRemoval('', port), false);
    assert.equal(canOfferGalleryRemoval(URI, null), false);
    assert.equal(getGalleryCopyPort(), null, 'no native module under Node');
  });

  test('the native answer is passed through; anything unknown counts as a failure', () => {
    for (const outcome of ['removed', 'gone', 'not_ours', 'declined', 'failed'] as const) {
      assert.equal(normalizeRemovalOutcome(outcome), outcome);
    }
    assert.equal(normalizeRemovalOutcome('deleted'), 'failed');
    assert.equal(normalizeRemovalOutcome(undefined), 'failed');
  });

  test('what the user is told', () => {
    assert.equal(galleryRemovalMessageKey('removed'), 'privateVault.galleryCopyRemoved');
    assert.equal(galleryRemovalMessageKey('gone'), 'privateVault.galleryCopyRemoved');
    assert.equal(galleryRemovalMessageKey('declined'), 'privateVault.galleryCopyKept');
    assert.equal(galleryRemovalMessageKey('not_ours'), 'privateVault.galleryCopyNotRemoved');
    assert.equal(galleryRemovalMessageKey('failed'), 'privateVault.galleryCopyNotRemoved');
  });

  test('the removal runs as an external UI (Android may show its delete dialog), with exactly that copy', async () => {
    const asked: string[] = [];
    let openDuringCall = false;
    const port: GalleryCopyPort = {
      async removeGalleryCopy(uri) {
        asked.push(uri);
        openDuringCall = isExternalUiOpen();
        return 'removed';
      },
    };
    assert.equal(await removeGalleryCopyAfterMove(URI, port), 'removed');
    assert.deepEqual(asked, [URI]);
    assert.equal(openDuringCall, true);
    assert.equal(isExternalUiOpen(), false);
  });

  test('a failing native call, a missing port or no copy never throw', async () => {
    const failing: GalleryCopyPort = {
      async removeGalleryCopy() {
        throw new Error('boom');
      },
    };
    assert.equal(await removeGalleryCopyAfterMove(URI, failing), 'failed');
    assert.equal(isExternalUiOpen(), false);
    assert.equal(await removeGalleryCopyAfterMove(URI, null), 'failed');
    assert.equal(await removeGalleryCopyAfterMove('', { removeGalleryCopy: async () => 'removed' }), 'failed');
  });

  test('a declined Android dialog is reported as kept', async () => {
    assert.equal(await removeGalleryCopyAfterMove(URI, { removeGalleryCopy: async () => 'declined' }), 'declined');
  });
});
