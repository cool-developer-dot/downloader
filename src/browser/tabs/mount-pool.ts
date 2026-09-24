import { MAX_MOUNTED_WEBVIEWS } from './constants';
import type { BrowserTab } from './types';

/**
 * Pure mount-pool helpers.
 * Active tab is always protected. Evict least-recently-used inactive mount.
 */

export function applyMountStates(
  tabs: BrowserTab[],
  activeTabId: string,
  mountedTabIds: string[],
): BrowserTab[] {
  const mounted = new Set(mountedTabIds);
  const now = Date.now();
  return tabs.map((tab) => {
    if (!mounted.has(tab.id)) {
      return {
        ...tab,
        mountState: 'EVICTED',
        canGoBack: false,
        canGoForward: false,
      };
    }
    if (tab.id === activeTabId) {
      return {
        ...tab,
        mountState: 'MOUNTED_ACTIVE',
        lastMountedAt: tab.lastMountedAt ?? now,
      };
    }
    return {
      ...tab,
      mountState: 'MOUNTED_INACTIVE',
      lastMountedAt: tab.lastMountedAt ?? now,
    };
  });
}

/**
 * Ensures active is mounted and pool size <= MAX_MOUNTED_WEBVIEWS.
 * Returns next mounted ids + which tab was evicted (if any).
 */
export function reconcileMountPool(input: {
  tabs: BrowserTab[];
  activeTabId: string;
  mountedTabIds: string[];
  maxMounted?: number;
}): {
  mountedTabIds: string[];
  /** Last eviction — kept for existing callers. Prefer `evictedTabIds`. */
  evictedTabId: string | null;
  /** Every tab unmounted by this reconcile (a budget drop can evict several). */
  evictedTabIds: string[];
  tabs: BrowserTab[];
} {
  const max = Math.max(1, input.maxMounted ?? MAX_MOUNTED_WEBVIEWS);
  const tabIds = new Set(input.tabs.map((t) => t.id));
  let mounted = input.mountedTabIds.filter((id) => tabIds.has(id));

  if (!mounted.includes(input.activeTabId)) {
    mounted = [...mounted, input.activeTabId];
  }

  let evictedTabId: string | null = null;
  const evictedTabIds: string[] = [];

  while (mounted.length > max) {
    const inactive = mounted.filter((id) => id !== input.activeTabId);
    if (inactive.length === 0) {
      break;
    }
    // LRU among inactive: lowest lastMountedAt / lastActiveAt
    const ranked = inactive
      .map((id) => {
        const tab = input.tabs.find((t) => t.id === id)!;
        return {
          id,
          score: tab.lastMountedAt ?? tab.lastActiveAt ?? 0,
        };
      })
      .sort((a, b) => a.score - b.score);

    const victim = ranked[0]!;
    evictedTabId = victim.id;
    evictedTabIds.push(victim.id);
    mounted = mounted.filter((id) => id !== victim.id);
  }

  // Cap safety
  if (mounted.length > max) {
    const capped = [
      input.activeTabId,
      ...mounted.filter((id) => id !== input.activeTabId),
    ].slice(0, max);
    for (const id of mounted) {
      if (!capped.includes(id) && !evictedTabIds.includes(id)) {
        evictedTabIds.push(id);
        evictedTabId = id;
      }
    }
    mounted = capped;
  }

  const evicted = new Set(evictedTabIds);
  const tabs = applyMountStates(input.tabs, input.activeTabId, mounted).map((tab) => {
    if (mounted.includes(tab.id) && tab.id === input.activeTabId) {
      return { ...tab, lastMountedAt: Date.now() };
    }
    if (evicted.has(tab.id)) {
      return {
        ...tab,
        mountState: 'EVICTED' as const,
        canGoBack: false,
        canGoForward: false,
        lastMountedAt: null,
      };
    }
    return tab;
  });

  return { mountedTabIds: mounted, evictedTabId, evictedTabIds, tabs };
}

/** Cold start: mount only the active tab. */
export function coldStartMountPool(activeTabId: string): string[] {
  return [activeTabId];
}
