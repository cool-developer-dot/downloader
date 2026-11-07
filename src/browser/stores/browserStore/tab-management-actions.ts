import type { StoreApi } from 'zustand';

import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { closedTabsService } from '@/browser/tabs/closed-tabs.service';
import type { ClosedTabEntry } from '@/browser/tabs/closed-tabs';
import { MAX_MOUNTED_WEBVIEWS, MAX_OPEN_TABS } from '@/browser/tabs/constants';
import { applyMountStates, reconcileMountPool } from '@/browser/tabs/mount-pool';
import { createHomeTab, createTabFromPersisted } from '@/browser/tabs/tab-factory';
import { createTabId } from '@/browser/tabs/tab-id';
import { moveTabBy, moveTabTo, setTabPinned, type ClosedTabSlot } from '@/browser/tabs/tab-list-ops';
import { planBackgroundTab, planCloseMany, planDuplicate, planRestore } from '@/browser/tabs/tab-management-plans';
import { shouldPersistForTab } from '@/browser/tabs/tab-privacy';
import { tabSnapshots } from '@/browser/tabs/tab-snapshots';
import { tabUndo } from '@/browser/tabs/tab-undo';
import type { BrowserTab, CreateTabResult } from '@/browser/tabs/types';
import { isBrowserHomeUrl } from '@/browser/utils';

import { chromeFromTab, cleanupClosedTab, persistTabs, suspendUnmountedTabs } from './store-helpers';
import type { BrowserStore } from './types';

/**
 * B1 — tab management on top of the Phase 3B tab engine: duplicate, pin, reorder, close several, reopen a closed tab
 * and Undo. The list rules are pure (`tab-list-ops.ts`); this file applies them to the store, keeps the WebView mount
 * pool consistent (`reconcileMountPool`), records closes (`closedTabsService`) and offers Undo (`tabUndo`).
 */

export type CloseTabsOutcome = { batchId: string | null; count: number };

export type RestoreTabsOutcome = {
  status: 'RESTORED' | 'NONE' | 'LIMIT_REACHED';
  restored: number;
  /** Tabs that did not fit under the 10-tab limit; they stay in the closed-tab stack. */
  dropped: number;
};

/** B6 #51: the tab opened behind the one in front; `loadsNow` when a WebView slot was free. */
export type BackgroundTabOutcome =
  | { status: 'CREATED'; tabId: string; loadsNow: boolean }
  | { status: 'LIMIT_REACHED'; max: number };

export interface TabManagementActions {
  duplicateTab: (tabId: string) => CreateTabResult;
  /**
   * B6 #51: opens `url` in a new tab behind the one in front (which stays in front). `title` (the link's text) names
   * it in the tab switcher until its page reports its own title.
   */
  openTabInBackground: (url: string, options?: { title?: string }) => BackgroundTabOutcome;
  setTabPinned: (tabId: string, pinned: boolean) => void;
  moveTab: (tabId: string, toIndex: number) => void;
  moveTabBy: (tabId: string, delta: -1 | 1) => void;
  /** Closes every tab but `keepTabId` (and the pinned ones unless `includePinned`). One Undo group. */
  closeOtherTabs: (keepTabId: string, options?: { includePinned?: boolean }) => CloseTabsOutcome;
  /** Closes every tab (pinned ones only with `includePinned`) and leaves one fresh start-page tab in front. */
  closeAllTabs: (options?: { includePinned?: boolean }) => CloseTabsOutcome;
  /** Reopens the most recently closed tab at its old position, in front. */
  reopenClosedTab: () => RestoreTabsOutcome;
  /** Undo of one close (one tab or a group). */
  undoCloseTabs: (batchId: string) => RestoreTabsOutcome;
  /**
   * B3 #15: unloads the pages of these tabs (gives up their WebViews); each loads its address again when opened. The tab
   * in front is never put to sleep. Returns the tabs that went to sleep.
   */
  sleepTabs: (tabIds: readonly string[]) => string[];
}

type BatchMeta = {
  /** The fresh start-page tab the close left behind (last tab closed, Close all), removed again by Undo if unused. */
  replacementHomeTabId: string | null;
  /** The tab that was in front before the close. */
  activeTabId: string;
};

const MAX_BATCH_META = 12;
const batchMeta = new Map<string, BatchMeta>();

function rememberBatch(batchId: string, meta: BatchMeta): void {
  batchMeta.set(batchId, meta);
  while (batchMeta.size > MAX_BATCH_META) {
    batchMeta.delete(batchMeta.keys().next().value!);
  }
}

function pruneSnapshots(openTabs: readonly BrowserTab[]): void {
  try {
    tabSnapshots.prune([...openTabs.map((t) => t.id), ...closedTabsService.getAll().map((e) => e.id)]);
  } catch {
    // Previews are best effort.
  }
}

function tabFromClosedEntry(entry: ClosedTabEntry): BrowserTab {
  return createTabFromPersisted({
    id: entry.id,
    url: entry.url,
    title: entry.title,
    createdAt: entry.createdAt,
    lastActiveAt: Date.now(),
    desktopMode: entry.desktopMode,
    desktopModeSource: entry.desktopModeSource,
    pinned: entry.pinned,
  });
}

/**
 * Records closed tabs in the closed-tab stack (one batch) and offers Undo. Called by every close path, single closes
 * included (`closeTab` in actions.ts).
 */
export function recordClosedTabs(
  slots: readonly ClosedTabSlot<BrowserTab>[],
  meta: { replacementHomeTabId: string | null; activeTabId?: string; openTabs?: readonly BrowserTab[] },
): string | null {
  if (slots.length === 0) return null;
  const batchId = createTabId();
  const closedAt = Date.now();
  closedTabsService.record(
    slots.map(({ tab, index }) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      index,
      pinned: tab.pinned,
      desktopMode: tab.desktopMode,
      desktopModeSource: tab.desktopModeSource,
      createdAt: tab.createdAt,
      closedAt,
      batchId,
      persist: shouldPersistForTab(tab),
    })),
  );
  rememberBatch(batchId, {
    replacementHomeTabId: meta.replacementHomeTabId,
    activeTabId: meta.activeTabId ?? slots[0]!.tab.id,
  });
  tabUndo.offer(batchId, slots.length);
  if (meta.openTabs) pruneSnapshots(meta.openTabs);
  return batchId;
}

export function createTabManagementActions(
  set: StoreApi<BrowserStore>['setState'],
  get: StoreApi<BrowserStore>['getState'],
): TabManagementActions {
  /** Applies a new tab list + active tab, reconciling the WebView mount pool like create/switch/close do. */
  function commit(tabs: BrowserTab[], activeTabId: string): void {
    const state = get();
    const previousActive = state.tabs.find((t) => t.id === state.activeTabId);
    if (previousActive && previousActive.id !== activeTabId && tabs.some((t) => t.id === previousActive.id)) {
      void tabSnapshots.capture(previousActive);
    }
    const reconciled = reconcileMountPool({
      tabs,
      activeTabId,
      mountedTabIds: state.mountedTabIds.filter((id) => tabs.some((t) => t.id === id)),
    });
    suspendUnmountedTabs(reconciled.evictedTabIds);
    const active = reconciled.tabs.find((t) => t.id === activeTabId)!;
    set({
      tabs: reconciled.tabs,
      activeTabId,
      mountedTabIds: reconciled.mountedTabIds,
      ...chromeFromTab(active),
    });
    persistTabs(get());
    if (state.activeTabId !== activeTabId) {
      browserMediaActionService.setActiveTab(activeTabId);
    }
  }

  function closeMany(
    request: { kind: 'all' } | { kind: 'others'; keepTabId: string },
    includePinned: boolean,
  ): CloseTabsOutcome {
    const state = get();
    const plan = planCloseMany(state.tabs, state.activeTabId, request, includePinned, () =>
      createHomeTab({ lastActiveAt: Date.now() }),
    );
    if (!plan) return { batchId: null, count: 0 };
    for (const { tab } of plan.closed) {
      cleanupClosedTab(tab.id);
    }
    commit(plan.tabs, plan.activeTabId);
    const batchId = recordClosedTabs(plan.closed, {
      replacementHomeTabId: plan.replacementHomeTabId,
      activeTabId: state.activeTabId,
      openTabs: get().tabs,
    });
    return { batchId, count: plan.closed.length };
  }

  function restore(
    entries: readonly ClosedTabEntry[],
    preferredActiveId: string | null,
    replacementHomeTabId: string | null,
  ): RestoreTabsOutcome {
    const state = get();
    const plan = planRestore(
      state.tabs,
      state.activeTabId,
      entries.map((entry) => ({ tab: tabFromClosedEntry(entry), index: entry.index })),
      { maxTabs: MAX_OPEN_TABS, preferredActiveId, replacementHomeTabId, isHomeUrl: isBrowserHomeUrl },
    );
    const droppedIds = new Set(plan.dropped.map((t) => t.id));
    if (droppedIds.size > 0) {
      // What did not fit stays reopenable.
      closedTabsService.record(
        entries.filter((entry) => droppedIds.has(entry.id)).map((entry) => ({ ...entry, persist: true })),
      );
    }
    if (plan.status === 'LIMIT_REACHED') {
      return { status: 'LIMIT_REACHED', restored: 0, dropped: plan.dropped.length };
    }
    if (plan.removedReplacementId) {
      cleanupClosedTab(plan.removedReplacementId);
    }
    commit(plan.tabs, plan.activeTabId);
    pruneSnapshots(get().tabs);
    return { status: 'RESTORED', restored: plan.restored.length, dropped: plan.dropped.length };
  }

  return {
    duplicateTab: (tabId) => {
      const state = get();
      const plan = planDuplicate(state.tabs, tabId, MAX_OPEN_TABS, (source) => {
        const now = Date.now();
        return createHomeTab({
          url: source.url,
          title: source.title,
          desktopMode: source.desktopMode,
          desktopModeSource: source.desktopModeSource,
          createdAt: now,
          lastActiveAt: now,
        });
      });
      if (plan.status === 'NOT_FOUND') {
        return { status: 'FAILED', reason: 'not_found' };
      }
      if (plan.status === 'LIMIT_REACHED') {
        return { status: 'LIMIT_REACHED', max: MAX_OPEN_TABS };
      }
      commit(plan.tabs, plan.copy.id);
      const tab = get().tabs.find((t) => t.id === plan.copy.id)!;
      return { status: 'CREATED', tab, evictedTabIds: [] };
    },

    openTabInBackground: (url, options) => {
      const state = get();
      const plan = planBackgroundTab(
        state.tabs,
        state.activeTabId,
        { maxTabs: MAX_OPEN_TABS, mountedCount: state.mountedTabIds.length, maxMounted: MAX_MOUNTED_WEBVIEWS },
        () => createHomeTab({ url, title: options?.title?.trim().slice(0, 120) ?? '', lastActiveAt: Date.now() }),
      );
      if (plan.status === 'LIMIT_REACHED') {
        return { status: 'LIMIT_REACHED', max: MAX_OPEN_TABS };
      }
      // The tab in front keeps its place and chrome; the new one mounts now (parked) only when a slot is free.
      const reconciled = reconcileMountPool({
        tabs: plan.tabs,
        activeTabId: state.activeTabId,
        mountedTabIds: plan.mountNow ? [...state.mountedTabIds, plan.tab.id] : state.mountedTabIds,
      });
      suspendUnmountedTabs(reconciled.evictedTabIds);
      set({ tabs: reconciled.tabs, mountedTabIds: reconciled.mountedTabIds });
      persistTabs(get());
      return {
        status: 'CREATED',
        tabId: plan.tab.id,
        loadsNow: reconciled.mountedTabIds.includes(plan.tab.id),
      };
    },

    setTabPinned: (tabId, pinned) => {
      const state = get();
      commit(setTabPinned(state.tabs, tabId, pinned), state.activeTabId);
    },

    moveTab: (tabId, toIndex) => {
      const state = get();
      commit(moveTabTo(state.tabs, tabId, toIndex), state.activeTabId);
    },

    moveTabBy: (tabId, delta) => {
      const state = get();
      commit(moveTabBy(state.tabs, tabId, delta), state.activeTabId);
    },

    closeOtherTabs: (keepTabId, options) => closeMany({ kind: 'others', keepTabId }, options?.includePinned === true),

    closeAllTabs: (options) => closeMany({ kind: 'all' }, options?.includePinned === true),

    sleepTabs: (tabIds) => {
      const state = get();
      const sleeping = state.mountedTabIds.filter((id) => id !== state.activeTabId && tabIds.includes(id));
      if (sleeping.length === 0) return [];
      const mountedTabIds = state.mountedTabIds.filter((id) => !sleeping.includes(id));
      suspendUnmountedTabs(sleeping);
      set({ mountedTabIds, tabs: applyMountStates(state.tabs, state.activeTabId, mountedTabIds) });
      return sleeping;
    },

    reopenClosedTab: () => {
      if (!closedTabsService.hasAny()) {
        return { status: 'NONE', restored: 0, dropped: 0 };
      }
      if (get().tabs.length >= MAX_OPEN_TABS) {
        return { status: 'LIMIT_REACHED', restored: 0, dropped: 1 };
      }
      const entry = closedTabsService.takeLatest();
      if (!entry) {
        return { status: 'NONE', restored: 0, dropped: 0 };
      }
      tabUndo.dismiss(entry.batchId);
      return restore([entry], entry.id, null);
    },

    undoCloseTabs: (batchId) => {
      const meta = batchMeta.get(batchId) ?? null;
      const entries = closedTabsService.takeBatch(batchId);
      tabUndo.dismiss(batchId);
      if (entries.length === 0) {
        return { status: 'NONE', restored: 0, dropped: 0 };
      }
      batchMeta.delete(batchId);
      return restore(entries, meta?.activeTabId ?? null, meta?.replacementHomeTabId ?? null);
    },
  };
}
