import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canMoveTab,
  insertTabAfter,
  moveTabBy,
  moveTabTo,
  normalizePinnedOrder,
  normalizeTabSortOrder,
  planCloseTabs,
  restoreClosedTabs,
  setTabPinned,
  sortTabsForDisplay,
  type OrderableTab,
} from './tab-list-ops.ts';

function tab(id: string, extra: Partial<OrderableTab> = {}): OrderableTab {
  return { id, url: `https://${id}.example/`, pinned: false, createdAt: 0, lastActiveAt: 0, ...extra };
}

const ids = (tabs: readonly OrderableTab[]) => tabs.map((t) => t.id).join(',');

describe('pinned tabs come first', () => {
  test('normalize keeps each block in order', () => {
    const list = [tab('a'), tab('b', { pinned: true }), tab('c'), tab('d', { pinned: true })];
    assert.equal(ids(normalizePinnedOrder(list)), 'b,d,a,c');
  });

  test('pin goes to the end of the pinned block, unpin to the start of the rest', () => {
    const list = [tab('p', { pinned: true }), tab('a'), tab('b'), tab('c')];
    const pinned = setTabPinned(list, 'c', true);
    assert.equal(ids(pinned), 'p,c,a,b');
    assert.equal(pinned[1]!.pinned, true);
    const unpinned = setTabPinned(pinned, 'p', false);
    assert.equal(ids(unpinned), 'c,p,a,b');
    assert.equal(unpinned[1]!.pinned, false);
  });

  test('pinning a pinned tab is a no-op', () => {
    const list = [tab('p', { pinned: true }), tab('a')];
    assert.equal(ids(setTabPinned(list, 'p', true)), 'p,a');
  });
});

describe('reorder (#11)', () => {
  const list = [tab('p1', { pinned: true }), tab('p2', { pinned: true }), tab('a'), tab('b'), tab('c')];

  test('moves inside the unpinned block', () => {
    assert.equal(ids(moveTabTo(list, 'c', 2)), 'p1,p2,c,a,b');
    assert.equal(ids(moveTabTo(list, 'a', 4)), 'p1,p2,b,c,a');
  });

  test('an unpinned tab can never move into the pinned block, nor a pinned one out of it', () => {
    assert.equal(ids(moveTabTo(list, 'c', 0)), 'p1,p2,c,a,b');
    assert.equal(ids(moveTabTo(list, 'p1', 4)), 'p2,p1,a,b,c');
  });

  test('Move up / Move down respect the block edges', () => {
    assert.equal(ids(moveTabBy(list, 'b', -1)), 'p1,p2,b,a,c');
    assert.equal(canMoveTab(list, 'a', -1), false);
    assert.equal(canMoveTab(list, 'p2', 1), false);
    assert.equal(canMoveTab(list, 'p2', -1), true);
    assert.equal(canMoveTab(list, 'c', 1), false);
    assert.equal(ids(moveTabBy(list, 'c', 1)), ids(list));
  });

  test('unknown tab leaves the list unchanged', () => {
    assert.equal(ids(moveTabTo(list, 'zz', 0)), ids(list));
  });
});

describe('duplicate / background position (#7, #51)', () => {
  test('the copy goes right after its tab', () => {
    const list = [tab('a'), tab('b'), tab('c')];
    assert.equal(ids(insertTabAfter(list, 'a', tab('a2'))), 'a,a2,b,c');
  });

  test('an unpinned copy of a pinned tab goes after the pinned block; a pinned copy stays in it', () => {
    const list = [tab('p', { pinned: true }), tab('q', { pinned: true }), tab('a')];
    assert.equal(ids(insertTabAfter(list, 'p', tab('n'))), 'p,q,n,a');
    assert.equal(ids(insertTabAfter(list, 'p', tab('n', { pinned: true }))), 'p,n,q,a');
  });

  test('no anchor appends', () => {
    assert.equal(ids(insertTabAfter([tab('a')], null, tab('b'))), 'a,b');
  });
});

describe('closing several tabs (#9, #10)', () => {
  const list = [tab('p', { pinned: true }), tab('a'), tab('b'), tab('c')];

  test('Close other tabs keeps the chosen and the pinned tabs', () => {
    const plan = planCloseTabs(list, 'b', ['a', 'c']);
    assert.equal(ids(plan.remaining), 'p,b');
    assert.deepEqual(plan.closed.map((s) => [s.tab.id, s.index]), [['a', 1], ['c', 3]]);
    assert.equal(plan.activeTabId, 'b');
  });

  test('closing the active tab picks its left neighbour that stays open', () => {
    const plan = planCloseTabs(list, 'c', ['b', 'c']);
    assert.equal(plan.activeTabId, 'a');
  });

  test('closing the first tabs picks the first remaining one', () => {
    const plan = planCloseTabs(list, 'p', ['p', 'a']);
    assert.equal(plan.activeTabId, 'b');
  });

  test('closing everything leaves nothing (the caller adds the start page)', () => {
    const plan = planCloseTabs(list, 'a', ['p', 'a', 'b', 'c']);
    assert.equal(plan.remaining.length, 0);
    assert.equal(plan.activeTabId, null);
  });
});

describe('reopen at the old position (#3, Undo)', () => {
  test('a group comes back in its old places', () => {
    const list = [tab('p', { pinned: true }), tab('a'), tab('b'), tab('c')];
    const plan = planCloseTabs(list, 'b', ['a', 'c']);
    const back = restoreClosedTabs(plan.remaining, plan.closed, 10);
    assert.equal(ids(back.tabs), 'p,a,b,c');
    assert.equal(back.dropped.length, 0);
  });

  test('a pinned tab comes back pinned and inside the pinned block', () => {
    const list = [tab('p', { pinned: true }), tab('q', { pinned: true }), tab('a')];
    const plan = planCloseTabs(list, 'a', ['q']);
    const back = restoreClosedTabs(plan.remaining, plan.closed, 10);
    assert.equal(ids(back.tabs), 'p,q,a');
    assert.equal(back.tabs[1]!.pinned, true);
  });

  test('an old index past the end appends', () => {
    const back = restoreClosedTabs([tab('a')], [{ tab: tab('z'), index: 7 }], 10);
    assert.equal(ids(back.tabs), 'a,z');
  });

  test('never above the tab limit: the rest is reported as dropped', () => {
    const open = Array.from({ length: 9 }, (_, i) => tab(`t${i}`));
    const back = restoreClosedTabs(open, [{ tab: tab('x'), index: 0 }, { tab: tab('y'), index: 1 }], 10);
    assert.equal(back.tabs.length, 10);
    assert.deepEqual(back.restored.map((t) => t.id), ['x']);
    assert.deepEqual(back.dropped.map((t) => t.id), ['y']);
  });

  test('a tab that is already open is not added twice', () => {
    const back = restoreClosedTabs([tab('a')], [{ tab: tab('a'), index: 0 }], 10);
    assert.equal(ids(back.tabs), 'a');
    assert.equal(back.restored.length, 0);
  });
});

describe('sort orders (#17)', () => {
  const list = [
    tab('p', { pinned: true, url: 'https://zzz.example/', createdAt: 9, lastActiveAt: 1 }),
    tab('a', { url: 'https://www.wikipedia.org/x', createdAt: 3, lastActiveAt: 50 }),
    tab('b', { url: 'https://bbc.com/urdu', createdAt: 1, lastActiveAt: 10 }),
    tab('c', { url: 'vidorax://home', createdAt: 2, lastActiveAt: 99 }),
    tab('d', { url: 'https://bbc.com/news', createdAt: 4, lastActiveAt: 5 }),
  ];
  const site = (url: string) => {
    const m = /^https?:\/\/(?:www\.)?([^/]+)/.exec(url);
    return m ? m[1]! : '';
  };

  test('manual keeps the list order', () => {
    assert.equal(ids(sortTabsForDisplay(list, 'manual', site)), 'p,a,b,c,d');
  });

  test('site groups by site, start pages last, ties keep manual order', () => {
    assert.equal(ids(sortTabsForDisplay(list, 'site', site)), 'p,b,d,a,c');
  });

  test('last used: newest first, pinned still first', () => {
    assert.equal(ids(sortTabsForDisplay(list, 'lastUsed', site)), 'p,c,a,b,d');
  });

  test('opened: oldest first', () => {
    assert.equal(ids(sortTabsForDisplay(list, 'opened', site)), 'p,b,c,a,d');
  });

  test('an unknown stored value falls back to manual', () => {
    assert.equal(normalizeTabSortOrder('random'), 'manual');
    assert.equal(normalizeTabSortOrder('site'), 'site');
  });
});
