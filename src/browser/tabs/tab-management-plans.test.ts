import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { OrderableTab } from './tab-list-ops.ts';
import { planCloseMany, planDuplicate, planRestore } from './tab-management-plans.ts';

const HOME = 'vidorax://home';
type Tab = OrderableTab & { title?: string };

function tab(id: string, extra: Partial<Tab> = {}): Tab {
  return { id, url: `https://${id}.example/`, pinned: false, createdAt: 0, lastActiveAt: 0, ...extra };
}
const ids = (tabs: readonly Tab[]) => tabs.map((t) => t.id).join(',');
let homeCounter = 0;
const makeHome = (): Tab => tab(`home${(homeCounter += 1)}`, { url: HOME });
const isHomeUrl = (url: string) => url === HOME;

describe('Duplicate tab (#7)', () => {
  test('the copy follows its tab and keeps it pinned', () => {
    const list = [tab('p', { pinned: true }), tab('a'), tab('b')];
    const plan = planDuplicate(list, 'p', 10, (src) => tab(`${src.id}2`, { url: src.url }));
    assert.equal(plan.status, 'CREATED');
    if (plan.status === 'CREATED') {
      assert.equal(ids(plan.tabs), 'p,p2,a,b');
      assert.equal(plan.tabs[1]!.pinned, true);
      assert.equal(plan.tabs[1]!.url, list[0]!.url);
    }
  });

  test('at the 10-tab limit nothing is added', () => {
    const full = Array.from({ length: 10 }, (_, i) => tab(`t${i}`));
    assert.deepEqual(planDuplicate(full, 't3', 10, () => tab('x')), { status: 'LIMIT_REACHED' });
  });

  test('an unknown tab is reported', () => {
    assert.deepEqual(planDuplicate([tab('a')], 'zz', 10, () => tab('x')), { status: 'NOT_FOUND' });
  });
});

describe('Close other tabs (#9) / Close all tabs (#10)', () => {
  const list = [tab('p', { pinned: true }), tab('a'), tab('b'), tab('c')];

  test('Close other tabs keeps the chosen tab and the pinned ones, the chosen tab in front', () => {
    const plan = planCloseMany(list, 'c', { kind: 'others', keepTabId: 'b' }, false, makeHome)!;
    assert.equal(ids(plan.tabs), 'p,b');
    assert.equal(plan.activeTabId, 'b');
    assert.deepEqual(plan.closed.map((s) => s.tab.id), ['a', 'c']);
    assert.equal(plan.replacementHomeTabId, null);
  });

  test('…and closes the pinned ones too when asked', () => {
    const plan = planCloseMany(list, 'a', { kind: 'others', keepTabId: 'b' }, true, makeHome)!;
    assert.equal(ids(plan.tabs), 'b');
  });

  test('Close all leaves the pinned tabs plus one fresh start page in front', () => {
    const plan = planCloseMany(list, 'a', { kind: 'all' }, false, makeHome)!;
    assert.equal(plan.tabs.length, 2);
    assert.equal(plan.tabs[0]!.id, 'p');
    assert.equal(plan.tabs[1]!.url, HOME);
    assert.equal(plan.activeTabId, plan.tabs[1]!.id);
    assert.equal(plan.replacementHomeTabId, plan.tabs[1]!.id);
  });

  test('Close all with pinned → exactly one start-page tab', () => {
    const plan = planCloseMany(list, 'a', { kind: 'all' }, true, makeHome)!;
    assert.equal(plan.tabs.length, 1);
    assert.equal(plan.tabs[0]!.url, HOME);
    assert.equal(plan.closed.length, 4);
  });

  test('nothing to close (only pinned tabs, box not ticked) → no plan', () => {
    const pinnedOnly = [tab('p', { pinned: true }), tab('q', { pinned: true })];
    assert.equal(planCloseMany(pinnedOnly, 'p', { kind: 'all' }, false, makeHome), null);
  });
});

describe('Undo as one group', () => {
  test('Close all → Undo brings every tab back in order, the old front tab in front, the start page gone', () => {
    const list = [tab('p', { pinned: true }), tab('a'), tab('b'), tab('c')];
    const closed = planCloseMany(list, 'b', { kind: 'all' }, true, makeHome)!;
    const undo = planRestore(closed.tabs, closed.activeTabId, closed.closed, {
      maxTabs: 10,
      preferredActiveId: 'b',
      replacementHomeTabId: closed.replacementHomeTabId,
      isHomeUrl,
    });
    assert.equal(undo.status, 'RESTORED');
    if (undo.status === 'RESTORED') {
      assert.equal(ids(undo.tabs), 'p,a,b,c');
      assert.equal(undo.tabs[0]!.pinned, true);
      assert.equal(undo.activeTabId, 'b');
      assert.equal(undo.removedReplacementId, closed.replacementHomeTabId);
    }
  });

  test('a start page the user already navigated is kept', () => {
    const list = [tab('a'), tab('b')];
    const closed = planCloseMany(list, 'a', { kind: 'all' }, false, makeHome)!;
    const used = closed.tabs.map((t) => (t.id === closed.replacementHomeTabId ? { ...t, url: 'https://new.example/' } : t));
    const undo = planRestore(used, closed.activeTabId, closed.closed, {
      maxTabs: 10,
      preferredActiveId: 'a',
      replacementHomeTabId: closed.replacementHomeTabId,
      isHomeUrl,
    });
    assert.equal(undo.status === 'RESTORED' && undo.tabs.length, 3);
    assert.equal(undo.status === 'RESTORED' && undo.removedReplacementId, null);
  });

  test('at the limit what fits comes back and the rest is reported', () => {
    const open = Array.from({ length: 9 }, (_, i) => tab(`t${i}`));
    const slots = [
      { tab: tab('x'), index: 0 },
      { tab: tab('y'), index: 1 },
    ];
    const undo = planRestore(open, 't0', slots, { maxTabs: 10, preferredActiveId: null, replacementHomeTabId: null, isHomeUrl });
    assert.equal(undo.status, 'RESTORED');
    if (undo.status === 'RESTORED') {
      assert.deepEqual(undo.restored.map((t) => t.id), ['x']);
      assert.deepEqual(undo.dropped.map((t) => t.id), ['y']);
    }
    const full = [...open, tab('t9')];
    const none = planRestore(full, 't0', slots, { maxTabs: 10, preferredActiveId: null, replacementHomeTabId: null, isHomeUrl });
    assert.equal(none.status, 'LIMIT_REACHED');
  });
});
