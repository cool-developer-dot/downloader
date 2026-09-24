import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { needsDetectionNavigationStart } from './detection-navigation-sync';

const PAGE = 'https://news.example.org/story/42';

describe('detection follows the tab navigation epoch', () => {
  test('first navigation starts detection', () => {
    assert.equal(needsDetectionNavigationStart({ url: null, epoch: null }, { url: PAGE, epoch: 1 }), true);
  });

  test('a different document starts detection', () => {
    assert.equal(
      needsDetectionNavigationStart({ url: PAGE, epoch: 1 }, { url: 'https://news.example.org/story/43', epoch: 1 }),
      true,
    );
  });

  test('a hash or trailing-slash change on the same epoch keeps the running detection', () => {
    assert.equal(needsDetectionNavigationStart({ url: PAGE, epoch: 3 }, { url: `${PAGE}/#comments`, epoch: 3 }), false);
  });

  test('reload (same document, new epoch) moves detection to the epoch native scopes are bound to', () => {
    assert.equal(needsDetectionNavigationStart({ url: PAGE, epoch: 9 }, { url: PAGE, epoch: 10 }), true);
  });

  test('switching to another tab on the same page follows that tab’s epoch', () => {
    assert.equal(needsDetectionNavigationStart({ url: PAGE, epoch: 7 }, { url: PAGE, epoch: 2 }), true);
  });

  test('switching tabs restarts detection even when the per-tab epochs collide', () => {
    assert.equal(
      needsDetectionNavigationStart(
        { url: PAGE, epoch: 1, tabId: 'tab-a' },
        { url: PAGE, epoch: 1, tabId: 'tab-b' },
      ),
      true,
    );
  });

  test('staying on the same tab and document keeps the running detection', () => {
    assert.equal(
      needsDetectionNavigationStart(
        { url: PAGE, epoch: 1, tabId: 'tab-a' },
        { url: `${PAGE}#comments`, epoch: 1, tabId: 'tab-a' },
      ),
      false,
    );
  });
});
