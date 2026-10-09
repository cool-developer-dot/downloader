import assert from 'node:assert/strict';
import { test } from 'node:test';

import { qualityConfirmRoute } from './confirm-route';

test('a current browser offer goes to the v2 hand-off', () => {
  assert.equal(
    qualityConfirmRoute({ openedForBrowserOffer: true, selectionLocked: true, offerCurrent: true }),
    'browser_offer',
  );
});

test('a browser offer whose page moved on is stale, never the paste-link path', () => {
  // The lock is still held but the page generation changed under it.
  assert.equal(
    qualityConfirmRoute({ openedForBrowserOffer: true, selectionLocked: true, offerCurrent: false }),
    'stale',
  );
  // A navigation released the lock while the sheet stayed open (e.g. the player moved on to the next video).
  assert.equal(
    qualityConfirmRoute({ openedForBrowserOffer: true, selectionLocked: false, offerCurrent: false }),
    'stale',
  );
  // A second tap after the stale path ended the selection is still stale.
  assert.equal(
    qualityConfirmRoute({ openedForBrowserOffer: true, selectionLocked: false, offerCurrent: true }),
    'stale',
  );
});

test('a sheet not opened for a browser offer keeps the paste-link path', () => {
  assert.equal(
    qualityConfirmRoute({ openedForBrowserOffer: false, selectionLocked: false, offerCurrent: false }),
    'paste_link',
  );
});
