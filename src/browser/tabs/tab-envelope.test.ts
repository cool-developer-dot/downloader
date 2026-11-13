import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { envelopeTabsForWrite, parseTabsEnvelope, type EnvelopeRules } from './tab-envelope.ts';

const HOME = 'vidorax://home';
const rules: EnvelopeRules = {
  homeUrl: HOME,
  isHomeUrl: (url) => url.toLowerCase().startsWith('vidorax://home'),
  sanitizeUrl: (url) => url.replace(/[?&]token=[^&]*/, ''),
  maxTabs: 10,
  now: 1_000,
};

function v1Tab(id: string, lastActiveAt: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    url: `https://${id}.example/`,
    title: id,
    createdAt: 1,
    lastActiveAt,
    desktopMode: false,
    desktopModeSource: 'default' as const,
    ...extra,
  };
}

describe('tab envelope v1 → v2', () => {
  test('a v1 envelope keeps every tab, most recently used first (as before), none pinned', () => {
    const v1 = {
      schemaVersion: 1,
      activeTabId: 'b',
      tabs: [v1Tab('a', 10), v1Tab('b', 30), v1Tab('c', 20, { desktopMode: true, desktopModeSource: 'user' })],
      updatedAt: 5,
    };
    const parsed = parseTabsEnvelope(v1, rules)!;
    assert.deepEqual(parsed.tabs.map((t) => t.id), ['b', 'c', 'a']);
    assert.equal(parsed.activeTabId, 'b');
    assert.equal(parsed.tabs.every((t) => t.pinned === false), true);
    assert.equal(parsed.tabs[1]!.desktopMode, true);
    assert.equal(parsed.tabs[1]!.desktopModeSource, 'user');
  });

  test('a v2 envelope comes back in its saved order with pins first', () => {
    const tabs = [
      { ...v1Tab('p', 1), pinned: true },
      { ...v1Tab('x', 99), pinned: false },
      { ...v1Tab('y', 5), pinned: false },
    ];
    const written = { schemaVersion: 2, activeTabId: 'y', tabs: envelopeTabsForWrite(tabs), updatedAt: 1 };
    const round = parseTabsEnvelope(JSON.parse(JSON.stringify(written)), rules)!;
    assert.deepEqual(round.tabs.map((t) => [t.id, t.pinned]), [['p', true], ['x', false], ['y', false]]);
    assert.equal(round.activeTabId, 'y');
  });

  test('a higher, unknown schema version is read by its fields instead of dropping the tabs', () => {
    const future = {
      schemaVersion: 7,
      activeTabId: 'a',
      tabs: [{ ...v1Tab('a', 1), position: 1, pinned: false, incognito: false }, { ...v1Tab('b', 2), position: 0 }],
    };
    const parsed = parseTabsEnvelope(future, rules)!;
    assert.deepEqual(parsed.tabs.map((t) => t.id), ['b', 'a']);
  });

  test('a missing active tab falls back to the most recently used one', () => {
    const env = { activeTabId: 'gone', tabs: envelopeTabsForWrite([{ ...v1Tab('a', 5), pinned: false }, { ...v1Tab('b', 9), pinned: false }]) };
    assert.equal(parseTabsEnvelope(env, rules)!.activeTabId, 'b');
  });

  test('over the limit: the active tab always survives', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...v1Tab(`t${i}`, i), pinned: false }));
    const env = { activeTabId: 't11', tabs: envelopeTabsForWrite(many) };
    const parsed = parseTabsEnvelope(env, rules)!;
    assert.equal(parsed.tabs.length, 10);
    assert.equal(parsed.tabs.some((t) => t.id === 't11'), true);
    assert.deepEqual(parsed.tabs.slice(0, 3).map((t) => t.id), ['t0', 't1', 't2']);
  });

  test('broken rows, duplicates and unsafe URLs are dropped; secrets stripped; home normalized', () => {
    const env = {
      tabs: [
        v1Tab('ok', 1, { url: 'https://ok.example/?token=abc' }),
        v1Tab('ok', 2),
        { id: 'js', url: 'javascript:alert(1)' },
        { id: 'home', url: 'vidorax://home/' },
        null,
      ],
    };
    const parsed = parseTabsEnvelope(env, rules)!;
    assert.deepEqual(parsed.tabs.map((t) => t.id).sort(), ['home', 'ok']);
    assert.equal(parsed.tabs.find((t) => t.id === 'ok')!.url, 'https://ok.example/');
    assert.equal(parsed.tabs.find((t) => t.id === 'home')!.url, HOME);
  });

  test('nothing usable → null (the caller starts fresh)', () => {
    assert.equal(parseTabsEnvelope({ tabs: [] }, rules), null);
    assert.equal(parseTabsEnvelope('x', rules), null);
  });
});
