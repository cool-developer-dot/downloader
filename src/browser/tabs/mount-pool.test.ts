import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { reconcileMountPool } from './mount-pool';
import type { BrowserTab } from './types';

function tab(id: string, lastMountedAt: number | null): BrowserTab {
  return {
    id,
    url: `https://example.org/${id}`,
    title: id,
    createdAt: 0,
    lastActiveAt: lastMountedAt ?? 0,
    desktopMode: false,
    desktopModeSource: 'default',
    loading: false,
    progress: 0,
    canGoBack: true,
    canGoForward: true,
    error: null,
    navigationEpoch: 1,
    mountState: 'MOUNTED_INACTIVE',
    lastMountedAt,
  };
}

describe('mount pool stays bounded and reports every eviction', () => {
  test('the active tab is always mounted', () => {
    const result = reconcileMountPool({
      tabs: [tab('a', 10), tab('b', 20)],
      activeTabId: 'b',
      mountedTabIds: ['a'],
    });
    assert.ok(result.mountedTabIds.includes('b'));
  });

  test('clamping to the active tab evicts every parked mount', () => {
    const tabs = [tab('a', 10), tab('b', 20), tab('c', 30)];
    const result = reconcileMountPool({
      tabs,
      activeTabId: 'c',
      mountedTabIds: ['a', 'b', 'c'],
      maxMounted: 1,
    });

    assert.deepEqual(result.mountedTabIds, ['c']);
    assert.deepEqual([...result.evictedTabIds].sort(), ['a', 'b']);
    // Every evicted tab is marked EVICTED with history flags reset — never a
    // half-updated tab that still claims native Back/Forward.
    for (const id of ['a', 'b']) {
      const evicted = result.tabs.find((t) => t.id === id)!;
      assert.equal(evicted.mountState, 'EVICTED');
      assert.equal(evicted.canGoBack, false);
      assert.equal(evicted.canGoForward, false);
      assert.equal(evicted.lastMountedAt, null);
    }
  });

  test('eviction picks the least recently mounted inactive tab', () => {
    const result = reconcileMountPool({
      tabs: [tab('a', 10), tab('b', 50), tab('c', 30)],
      activeTabId: 'c',
      mountedTabIds: ['a', 'b'],
      maxMounted: 2,
    });

    assert.deepEqual(result.evictedTabIds, ['a']);
    assert.equal(result.evictedTabId, 'a');
    assert.ok(result.mountedTabIds.includes('c'));
    assert.equal(result.mountedTabIds.length, 2);
  });

  test('a budget below one still keeps the active tab mounted', () => {
    const result = reconcileMountPool({
      tabs: [tab('a', 10), tab('b', 20)],
      activeTabId: 'a',
      mountedTabIds: ['a', 'b'],
      maxMounted: 0,
    });

    assert.deepEqual(result.mountedTabIds, ['a']);
    assert.deepEqual(result.evictedTabIds, ['b']);
  });

  test('mounts for tabs that no longer exist are dropped', () => {
    const result = reconcileMountPool({
      tabs: [tab('a', 10)],
      activeTabId: 'a',
      mountedTabIds: ['a', 'gone'],
    });
    assert.deepEqual(result.mountedTabIds, ['a']);
  });
});
