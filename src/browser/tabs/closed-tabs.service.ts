import { BROWSER_HOMEPAGE } from '@/browser/constants';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvRemove, mmkvSetObject } from '@/storage/mmkv';

import {
  pushClosedTabs,
  sanitizeClosedTabs,
  takeClosedBatch,
  takeLatestClosed,
  type ClosedTabEntry,
  type ClosedTabsEnvelope,
} from './closed-tabs';

/**
 * B1 #3 — the recently closed tabs, kept in memory and in MMKV (`browserClosedTabs`), so "Reopen closed tab" also
 * works after a restart. Entries recorded with `persist: false` (a tab `shouldPersistForTab` refuses, e.g. Faran's
 * private tabs) stay in memory only: Undo still works for them, but nothing about them is written.
 */

type Listener = () => void;

let stack: ClosedTabEntry[] | null = null;
const memoryOnlyIds = new Set<string>();
const listeners = new Set<Listener>();

function load(): ClosedTabEntry[] {
  if (stack == null) {
    try {
      stack = sanitizeClosedTabs(mmkvGetObject<unknown>(mmkvKeys.browserClosedTabs), BROWSER_HOMEPAGE);
    } catch {
      stack = [];
    }
  }
  return stack;
}

function save(next: ClosedTabEntry[]): void {
  stack = next;
  for (const id of [...memoryOnlyIds]) {
    if (!next.some((e) => e.id === id)) memoryOnlyIds.delete(id);
  }
  try {
    const entries = next.filter((e) => !memoryOnlyIds.has(e.id));
    if (entries.length === 0) {
      mmkvRemove(mmkvKeys.browserClosedTabs);
    } else {
      const envelope: ClosedTabsEnvelope = { version: 1, entries };
      mmkvSetObject(mmkvKeys.browserClosedTabs, envelope);
    }
  } catch {
    // Storage unavailable: the in-memory stack still serves this session.
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export const closedTabsService = {
  getAll(): readonly ClosedTabEntry[] {
    return load();
  },

  hasAny(): boolean {
    return load().length > 0;
  },

  /** Records one close of one or more tabs (one `batchId`). */
  record(entries: readonly (ClosedTabEntry & { persist: boolean })[]): void {
    if (entries.length === 0) return;
    for (const entry of entries) {
      if (!entry.persist) memoryOnlyIds.add(entry.id);
    }
    save(pushClosedTabs(load(), entries.map(({ persist: _persist, ...entry }) => entry)));
  },

  takeBatch(batchId: string): ClosedTabEntry[] {
    const { taken, stack: rest } = takeClosedBatch(load(), batchId);
    if (taken.length > 0) save(rest);
    return taken;
  },

  takeLatest(): ClosedTabEntry | null {
    const { taken, stack: rest } = takeLatestClosed(load());
    if (taken) save(rest);
    return taken;
  },

  /** Clear browsing data (B10) and tests. */
  clear(): void {
    memoryOnlyIds.clear();
    save([]);
  },

  /** Drops entries closed at or after `sinceMs` (B10's time ranges). */
  clearSince(sinceMs: number): void {
    save(load().filter((e) => e.closedAt < sinceMs));
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Version for useSyncExternalStore: the stack array identity changes on every save. */
  getSnapshot(): readonly ClosedTabEntry[] {
    return load();
  },
};
