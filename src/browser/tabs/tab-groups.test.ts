import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseTabsEnvelope } from './tab-envelope.ts';
import {
  addToGroup,
  closedGroupsFromSave,
  createGroup,
  EMPTY_GROUPS,
  groupBySite,
  groupsForSave,
  groupsFromSave,
  layoutRows,
  nextColor,
  pruneTabs,
  pushClosedGroup,
  removeFromGroup,
  restorePlan,
  timelineSections,
  ungroup,
  updateGroup,
  type ClosedGroup,
} from './tab-groups.ts';

const incog = (id: string) => id.startsWith('incog-');
const rules = { homeUrl: 'vidorax://home', isHomeUrl: (u: string) => u === 'vidorax://home', sanitizeUrl: (u: string) => u, maxTabs: 10, now: 1_000 };

describe('B2 #6 tab groups', () => {
  test('create, move in and out, rename and recolour, collapse, ungroup; empty groups go', () => {
    let s = createGroup(EMPTY_GROUPS, { id: 'g1', name: '  Work   stuff ', color: 'blue', tabIds: ['a', 'b'], incognito: false }, incog);
    assert.deepEqual(s.groups.map((g) => [g.id, g.name, g.color]), [['g1', 'Work stuff', 'blue']]);
    s = createGroup(s, { id: 'g2', name: 'خبریں', color: nextColor(s), tabIds: ['c'], incognito: false }, incog);
    assert.equal(s.groups[1].color, 'red', 'the next colour');
    s = addToGroup(s, 'b', 'g2', incog);
    assert.deepEqual(s.membership, { a: 'g1', b: 'g2', c: 'g2' });
    s = removeFromGroup(s, 'a');
    assert.deepEqual(s.groups.map((g) => g.id), ['g2'], 'g1 had no tabs left');
    s = updateGroup(s, 'g2', { name: 'Urdu news', color: 'green', collapsed: true });
    assert.deepEqual([s.groups[0].name, s.groups[0].color, s.groups[0].collapsed], ['Urdu news', 'green', true]);
    s = ungroup(s, 'g2');
    assert.deepEqual(s, EMPTY_GROUPS);
  });

  test('incognito tabs group only with incognito tabs', () => {
    let s = createGroup(EMPTY_GROUPS, { id: 'n', name: '', color: 'grey', tabIds: ['a', 'incog-1'], incognito: false }, incog);
    assert.deepEqual(s.membership, { a: 'n' });
    s = createGroup(s, { id: 'i', name: '', color: 'pink', tabIds: ['incog-1'], incognito: true }, incog);
    assert.equal(addToGroup(s, 'a', 'i', incog), s, 'a normal tab never joins an incognito group');
    assert.equal(addToGroup(s, 'incog-1', 'n', incog), s);
  });

  test('closed tabs leave their groups', () => {
    const s = createGroup(EMPTY_GROUPS, { id: 'g', name: 'x', color: 'grey', tabIds: ['a', 'b'], incognito: false }, incog);
    assert.deepEqual(pruneTabs(s, new Set(['b', 'z'])).membership, { b: 'g' });
    assert.deepEqual(pruneTabs(s, new Set(['z'])), EMPTY_GROUPS);
    assert.equal(pruneTabs(s, new Set(['a', 'b'])), s);
  });

  test('a group is one block where its first tab is, in the list order (pins first); collapsed hides its tabs', () => {
    let s = createGroup(EMPTY_GROUPS, { id: 'g', name: 'g', color: 'grey', tabIds: ['pinned', 'c'], incognito: false }, incog);
    const order = ['pinned', 'a', 'b', 'c', 'd'];
    assert.deepEqual(
      layoutRows(s, order).map((r) => (r.kind === 'group' ? `[${r.tabIds.join(',')}]` : r.tabId)),
      ['[pinned,c]', 'pinned', 'c', 'a', 'b', 'd'],
    );
    // Another sort (B1: by title) moves the block with its first tab.
    assert.deepEqual(
      layoutRows(s, ['a', 'c', 'b', 'pinned', 'd']).map((r) => (r.kind === 'group' ? 'G' : r.tabId)),
      ['a', 'G', 'c', 'pinned', 'b', 'd'],
    );
    s = updateGroup(s, 'g', { collapsed: true });
    assert.deepEqual(layoutRows(s, order).map((r) => (r.kind === 'group' ? 'G' : r.tabId)), ['G', 'a', 'b', 'd']);
  });

  test('#258 group by site: two or more ungrouped normal tabs of a site', () => {
    let n = 0;
    const tabs = [
      { id: '1', url: 'https://www.dawn.com/a', incognito: false },
      { id: '2', url: 'https://dawn.com/b', incognito: false },
      { id: '3', url: 'https://ur.wikipedia.org/x', incognito: false },
      { id: '4', url: 'vidorax://home', incognito: false },
      { id: 'incog-5', url: 'https://dawn.com/c', incognito: true },
    ];
    const s = groupBySite(EMPTY_GROUPS, tabs, () => `g${++n}`);
    assert.deepEqual(s.groups.map((g) => g.name), ['dawn.com']);
    assert.deepEqual(s.membership, { '1': 'g1', '2': 'g1' });
  });
});

describe('B2 saved tab data (schema 3), read by its fields', () => {
  test('an old save (schema 1: no pins, no positions, no groups) still opens, with no groups', () => {
    const old = { schemaVersion: 1, activeTabId: 'b', tabs: [{ id: 'a', url: 'https://a.test/', title: 'A', lastActiveAt: 5 }, { id: 'b', url: 'https://b.test/', title: 'B', lastActiveAt: 9 }], updatedAt: 1 };
    const parsed = parseTabsEnvelope(old, rules)!;
    assert.deepEqual(parsed.tabs.map((t) => t.id), ['b', 'a']);
    assert.deepEqual(groupsFromSave(old, new Set(['a', 'b'])), EMPTY_GROUPS);
  });

  test('a new save round-trips its groups; incognito groups and unsaved tabs are never written', () => {
    let s = createGroup(EMPTY_GROUPS, { id: 'g', name: 'Lahore', color: 'cyan', tabIds: ['a', 'b'], incognito: false }, incog);
    s = updateGroup(s, 'g', { collapsed: true });
    s = createGroup(s, { id: 'i', name: 'secret', color: 'red', tabIds: ['incog-1'], incognito: true }, incog);
    const saved = groupsForSave(s, ['a', 'b']);
    assert.deepEqual(saved, { groups: [{ id: 'g', name: 'Lahore', color: 'cyan', collapsed: true }], membership: { a: 'g', b: 'g' } });
    const envelope = { schemaVersion: 3, activeTabId: 'a', tabs: [{ id: 'a', url: 'https://a.test/', groupId: 'g' }, { id: 'b', url: 'https://b.test/', groupId: 'g' }], groups: saved.groups, updatedAt: 1 };
    const back = groupsFromSave(envelope, new Set(['a', 'b']));
    assert.deepEqual(back.membership, { a: 'g', b: 'g' });
    assert.deepEqual(back.groups, [{ id: 'g', name: 'Lahore', color: 'cyan', collapsed: true, incognito: false }]);
    assert.ok(!JSON.stringify(saved).includes('secret'));
  });

  test('unknown fields and versions are ignored; broken parts are no groups, never an error', () => {
    const future = {
      schemaVersion: 99,
      somethingNew: { x: 1 },
      activeTabId: 'a',
      tabs: [{ id: 'a', url: 'https://a.test/', groupId: 'g', tabColour: 'x', position: 0, pinned: true }, { id: 'b', url: 'https://b.test/', groupId: 'missing', position: 1 }],
      groups: [{ id: 'g', name: 'G', color: 'ultraviolet', collapsed: 'yes', extra: true }, 'junk', { name: 'no id' }],
      updatedAt: 1,
    };
    const parsed = parseTabsEnvelope(future, rules)!;
    assert.deepEqual(parsed.tabs.map((t) => [t.id, t.pinned]), [['a', true], ['b', false]]);
    const groups = groupsFromSave(future, new Set(['a', 'b']));
    assert.deepEqual(groups.membership, { a: 'g' });
    assert.deepEqual(groups.groups, [{ id: 'g', name: 'G', color: 'grey', collapsed: false, incognito: false }]);
    assert.deepEqual(groupsFromSave({ groups: 'nope', tabs: 7 }, new Set()), EMPTY_GROUPS);
    assert.deepEqual(groupsFromSave(null, new Set()), EMPTY_GROUPS);
  });
});

describe('B2 #259 timeline and #288 group history', () => {
  test('Today, Yesterday, Earlier by the phone’s day; incognito tabs never appear', () => {
    const now = new Date(2026, 10, 10, 15, 0).getTime();
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).getTime();
    const t = timelineSections(
      [
        { id: 'a', url: 'https://a.test/', title: 'A', lastActiveAt: at(10, 9), incognito: false },
        { id: 'incog-1', url: 'https://secret.test/', title: 'S', lastActiveAt: at(10, 14), incognito: true },
        { id: 'b', url: 'https://b.test/', title: 'B', lastActiveAt: at(8, 9), incognito: false },
      ],
      [{ id: 'c', url: 'https://c.test/', title: 'C', closedAt: at(9, 23) }],
      now,
    );
    assert.deepEqual(t.today.map((e) => e.id), ['a']);
    assert.deepEqual(t.yesterday.map((e) => [e.id, e.kind]), [['c', 'closed']]);
    assert.deepEqual(t.earlier.map((e) => e.id), ['b']);
  });

  test('the last 10 closed groups; restore what fits at the tab limit', () => {
    const group = (i: number): ClosedGroup => ({ id: `g${i}`, name: `G${i}`, color: 'grey', tabs: [{ url: `https://${i}.test/`, title: '' }], closedAt: i });
    let list: ClosedGroup[] = [];
    for (let i = 1; i <= 12; i++) list = pushClosedGroup(list, group(i));
    assert.equal(list.length, 10);
    assert.equal(list[0].id, 'g12');
    assert.equal(pushClosedGroup(list, { ...group(99), tabs: [] }).length, 10, 'an empty group is not kept');
    const big: ClosedGroup = { ...group(1), tabs: Array.from({ length: 5 }, (_, i) => ({ url: `https://x${i}.test/`, title: '' })) };
    assert.deepEqual(restorePlan(big, 8, 10), { open: big.tabs.slice(0, 2), skipped: 3 });
    assert.deepEqual(restorePlan(big, 10, 10).open, []);
    assert.deepEqual(closedGroupsFromSave([{ id: 'x', tabs: [{ url: 'https://a.test/' }], color: 'nope' }, 'junk']), [
      { id: 'x', name: '', color: 'grey', tabs: [{ url: 'https://a.test/', title: '' }], closedAt: 0 },
    ]);
  });
});
