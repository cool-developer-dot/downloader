/**
 * B1 — pure tab-list rules: pinned tabs first, reorder, duplicate position, closing several tabs, reopening closed
 * tabs at their old position, and the switcher's sort orders. No React Native, no storage: everything here is
 * exercised by `tab-list-ops.test.ts` under Node.
 *
 * Invariant kept by every function: the pinned tabs form one block at the start of the list, in their own order.
 */

export type OrderableTab = {
  id: string;
  url: string;
  pinned: boolean;
  createdAt: number;
  lastActiveAt: number;
};

/** "Sort by" in the tab switcher (#17). `manual` is the drag order. */
export type TabSortOrder = 'manual' | 'site' | 'lastUsed' | 'opened';

export const TAB_SORT_ORDERS: readonly TabSortOrder[] = ['manual', 'site', 'lastUsed', 'opened'];
export const DEFAULT_TAB_SORT_ORDER: TabSortOrder = 'manual';

export function normalizeTabSortOrder(value: unknown): TabSortOrder {
  return TAB_SORT_ORDERS.includes(value as TabSortOrder) ? (value as TabSortOrder) : DEFAULT_TAB_SORT_ORDER;
}

/** Stable partition: pinned tabs first, each block in its current order. */
export function normalizePinnedOrder<T extends OrderableTab>(tabs: readonly T[]): T[] {
  const pinned = tabs.filter((tab) => tab.pinned);
  if (pinned.length === 0 || pinned.length === tabs.length) {
    return [...tabs];
  }
  return [...pinned, ...tabs.filter((tab) => !tab.pinned)];
}

export function pinnedCount(tabs: readonly OrderableTab[]): number {
  let count = 0;
  for (const tab of tabs) {
    if (tab.pinned) count += 1;
  }
  return count;
}

/** The index range a tab may be moved within: its own block (pinned or not). */
export function moveRange(tabs: readonly OrderableTab[], tabId: string): { min: number; max: number } | null {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return null;
  const pinned = pinnedCount(tabs);
  return tab.pinned ? { min: 0, max: pinned - 1 } : { min: pinned, max: tabs.length - 1 };
}

/** Moves a tab to `toIndex`, clamped to its own block. Unchanged list when the tab is unknown. */
export function moveTabTo<T extends OrderableTab>(tabs: readonly T[], tabId: string, toIndex: number): T[] {
  const ordered = normalizePinnedOrder(tabs);
  const from = ordered.findIndex((t) => t.id === tabId);
  const range = moveRange(ordered, tabId);
  if (from < 0 || !range) return ordered;
  const target = Math.min(range.max, Math.max(range.min, Math.round(toIndex)));
  if (target === from) return ordered;
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** Move up (-1) / Move down (+1) for screen readers and the tab menu. */
export function moveTabBy<T extends OrderableTab>(tabs: readonly T[], tabId: string, delta: -1 | 1): T[] {
  const ordered = normalizePinnedOrder(tabs);
  const from = ordered.findIndex((t) => t.id === tabId);
  if (from < 0) return ordered;
  return moveTabTo(ordered, tabId, from + delta);
}

export function canMoveTab(tabs: readonly OrderableTab[], tabId: string, delta: -1 | 1): boolean {
  const ordered = normalizePinnedOrder(tabs);
  const from = ordered.findIndex((t) => t.id === tabId);
  const range = moveRange(ordered, tabId);
  if (from < 0 || !range) return false;
  const target = from + delta;
  return target >= range.min && target <= range.max;
}

/**
 * Pin: the tab goes to the end of the pinned block. Unpin: to the start of the unpinned block (right after the
 * remaining pinned tabs), so it stays where the user last saw it.
 */
export function setTabPinned<T extends OrderableTab>(tabs: readonly T[], tabId: string, pinned: boolean): T[] {
  const ordered = normalizePinnedOrder(tabs);
  const tab = ordered.find((t) => t.id === tabId);
  if (!tab || tab.pinned === pinned) return ordered;
  const rest = ordered.filter((t) => t.id !== tabId);
  const updated = { ...tab, pinned };
  const boundary = pinnedCount(rest);
  return [...rest.slice(0, boundary), updated, ...rest.slice(boundary)];
}

/** Inserts `tab` right after `anchorId` (a duplicate, a background tab), kept inside the right block. */
export function insertTabAfter<T extends OrderableTab>(tabs: readonly T[], anchorId: string | null, tab: T): T[] {
  const ordered = normalizePinnedOrder(tabs);
  const anchor = anchorId == null ? -1 : ordered.findIndex((t) => t.id === anchorId);
  const pinned = pinnedCount(ordered);
  let index = anchor < 0 ? ordered.length : anchor + 1;
  index = tab.pinned ? Math.min(index, pinned) : Math.max(index, pinned);
  const next = [...ordered];
  next.splice(index, 0, tab);
  return next;
}

/** What a closed tab leaves behind, enough to bring it back at its old place. */
export type ClosedTabSlot<T> = { tab: T; index: number };

/**
 * Closes `closeIds` from the list. The new active tab is the closed active tab's left neighbour among the remaining
 * ones (today's single-close rule), else the first remaining tab; `null` when nothing remains.
 */
export function planCloseTabs<T extends OrderableTab>(
  tabs: readonly T[],
  activeTabId: string,
  closeIds: readonly string[],
): { remaining: T[]; closed: ClosedTabSlot<T>[]; activeTabId: string | null } {
  const ordered = normalizePinnedOrder(tabs);
  const closing = new Set(closeIds);
  const closed: ClosedTabSlot<T>[] = [];
  const remaining: T[] = [];
  ordered.forEach((tab, index) => {
    if (closing.has(tab.id)) {
      closed.push({ tab, index });
    } else {
      remaining.push(tab);
    }
  });
  if (remaining.length === 0) {
    return { remaining, closed, activeTabId: null };
  }
  if (!closing.has(activeTabId) && remaining.some((t) => t.id === activeTabId)) {
    return { remaining, closed, activeTabId };
  }
  const activeIndex = ordered.findIndex((t) => t.id === activeTabId);
  let chosen: T | undefined;
  for (let i = activeIndex - 1; i >= 0; i -= 1) {
    if (!closing.has(ordered[i]!.id)) {
      chosen = ordered[i];
      break;
    }
  }
  return { remaining, closed, activeTabId: (chosen ?? remaining[0]!).id };
}

/**
 * Puts closed tabs back at their old positions (ascending, so earlier slots are filled first and later indices stay
 * right), never above `maxTabs`. Tabs whose id is already open are skipped. Returns what was restored and what did
 * not fit.
 */
export function restoreClosedTabs<T extends OrderableTab>(
  tabs: readonly T[],
  slots: readonly ClosedTabSlot<T>[],
  maxTabs: number,
): { tabs: T[]; restored: T[]; dropped: T[] } {
  let next = normalizePinnedOrder(tabs);
  const restored: T[] = [];
  const dropped: T[] = [];
  const sorted = [...slots].sort((a, b) => a.index - b.index);
  for (const slot of sorted) {
    if (next.some((t) => t.id === slot.tab.id)) {
      continue;
    }
    if (next.length >= maxTabs) {
      dropped.push(slot.tab);
      continue;
    }
    const pinned = pinnedCount(next);
    let index = Math.min(Math.max(0, slot.index), next.length);
    index = slot.tab.pinned ? Math.min(index, pinned) : Math.max(index, pinned);
    next = [...next.slice(0, index), slot.tab, ...next.slice(index)];
    restored.push(slot.tab);
  }
  return { tabs: next, restored, dropped };
}

/**
 * The switcher's display order (#17). Pinned tabs always come first, in their manual order; the rest follow the
 * chosen order. Ties keep the manual order. `siteKey` maps a URL to what "Site" groups by (the registrable domain).
 */
export function sortTabsForDisplay<T extends OrderableTab>(
  tabs: readonly T[],
  order: TabSortOrder,
  siteKey: (url: string) => string,
): T[] {
  const ordered = normalizePinnedOrder(tabs);
  if (order === 'manual') return ordered;
  const pinned = ordered.filter((t) => t.pinned);
  const rest = ordered
    .filter((t) => !t.pinned)
    .map((tab, index) => ({ tab, index, site: order === 'site' ? siteKey(tab.url) : '' }));
  rest.sort((a, b) => {
    let diff = 0;
    if (order === 'site') {
      // Start-page and unknown hosts ('') sort last.
      if (a.site !== b.site) {
        if (!a.site) return 1;
        if (!b.site) return -1;
        diff = a.site < b.site ? -1 : 1;
      }
    } else if (order === 'lastUsed') {
      diff = b.tab.lastActiveAt - a.tab.lastActiveAt;
    } else if (order === 'opened') {
      diff = a.tab.createdAt - b.tab.createdAt;
    }
    return diff !== 0 ? diff : a.index - b.index;
  });
  return [...pinned, ...rest.map((entry) => entry.tab)];
}
