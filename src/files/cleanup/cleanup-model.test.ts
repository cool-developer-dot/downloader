import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCleanPlan,
  dayKey,
  DEFAULT_LOW_SPACE,
  groupsFromHashes,
  lowSpaceDecision,
  normalizeLowSpaceSettings,
  sizeCandidates,
} from './cleanup-model';

const MB = 1024 * 1024;
const item = (id: string, fileSize: string, downloadedAt: string | null = null) => ({ id, fileSize, downloadedAt });

describe('duplicates', () => {
  test('only same-size items are candidates; empty files never', () => {
    const groups = sizeCandidates([item('a', '100'), item('b', '100'), item('c', '200'), item('d', '0'), item('e', '0')]);
    assert.deepEqual(groups, [['a', 'b']]);
  });

  test('two identical files form one group; same size, different content forms none', () => {
    const items = [item('a', '100', '2026-11-01'), item('b', '100', '2026-11-05'), item('c', '100', '2026-11-03')];
    const hashes = new Map([
      ['a', 'h1'],
      ['b', 'h1'],
      ['c', 'h2'],
    ]);
    const groups = groupsFromHashes(items, hashes);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]!.items.map((x) => x.id), ['b', 'a']); // newest first
  });

  test('an item with no hash (cancelled, unreadable) is left out', () => {
    const groups = groupsFromHashes([item('a', '1'), item('b', '1')], new Map([['a', 'h']]));
    assert.deepEqual(groups, []);
  });

  test('groups with the biggest files come first', () => {
    const items = [item('s1', '10'), item('s2', '10'), item('b1', '999'), item('b2', '999')];
    const hashes = new Map([
      ['s1', 'x'],
      ['s2', 'x'],
      ['b1', 'y'],
      ['b2', 'y'],
    ]);
    assert.deepEqual(groupsFromHashes(items, hashes).map((g) => g.hash), ['y', 'x']);
  });
});

describe('one-tap clean plan', () => {
  test('total adds the parts; bad numbers count as 0', () => {
    assert.deepEqual(buildCleanPlan({ cacheBytes: 10, leftoverBytes: 20, tempBytes: Number.NaN, binExpiredBytes: -5 }), {
      cacheBytes: 10,
      leftoverBytes: 20,
      tempBytes: 0,
      binExpiredBytes: 0,
      total: 30,
    });
  });
});

describe('low space', () => {
  const now = new Date(2026, 10, 26, 10).getTime();

  test('settings: defaults on and 1 GB; only 500 MB / 1 GB / 2 GB allowed', () => {
    assert.deepEqual(DEFAULT_LOW_SPACE, { enabled: true, thresholdBytes: 1024 * MB });
    assert.deepEqual(normalizeLowSpaceSettings({ enabled: false, thresholdBytes: 500 * MB }), { enabled: false, thresholdBytes: 500 * MB });
    assert.deepEqual(normalizeLowSpaceSettings({ thresholdBytes: 3 }), DEFAULT_LOW_SPACE);
  });

  test('under the limit: low, and a notification once per day', () => {
    const settings = DEFAULT_LOW_SPACE;
    assert.deepEqual(lowSpaceDecision({ settings, freeBytes: 900 * MB, lastAlertDay: null, nowMs: now }), { low: true, notify: true });
    assert.deepEqual(lowSpaceDecision({ settings, freeBytes: 900 * MB, lastAlertDay: dayKey(now), nowMs: now }), { low: true, notify: false });
    const tomorrow = now + 24 * 60 * 60 * 1000;
    assert.equal(lowSpaceDecision({ settings, freeBytes: 900 * MB, lastAlertDay: dayKey(now), nowMs: tomorrow }).notify, true);
  });

  test('over the limit, switched off, or free space unknown: never', () => {
    assert.deepEqual(lowSpaceDecision({ settings: DEFAULT_LOW_SPACE, freeBytes: 5000 * MB, lastAlertDay: null, nowMs: now }), { low: false, notify: false });
    assert.equal(lowSpaceDecision({ settings: { enabled: false, thresholdBytes: 2048 * MB }, freeBytes: 1, lastAlertDay: null, nowMs: now }).low, false);
    assert.equal(lowSpaceDecision({ settings: DEFAULT_LOW_SPACE, freeBytes: null, lastAlertDay: null, nowMs: now }).low, false);
  });

  test('dayKey is the local date', () => assert.equal(dayKey(now), '2026-11-26'));
});
