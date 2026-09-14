import { BROWSER_HOMEPAGE } from '@/browser/constants';
import { MAX_OPEN_TABS } from './constants';
import { createHomeTab } from './tab-factory';
import { reconcileMountPool } from './mount-pool';
import type {
  BrowserTab,
  CloseTabResult,
  CreateTabResult,
  SwitchTabResult,
  TabEngineSnapshot,
} from './types';

function findIndex(tabs: BrowserTab[], tabId: string): number {
  return tabs.findIndex((t) => t.id === tabId);
}

export function selectActiveTab(snapshot: TabEngineSnapshot): BrowserTab | null {
  return snapshot.tabs.find((t) => t.id === snapshot.activeTabId) ?? null;
}

export function createTabOperation(
  snapshot: TabEngineSnapshot,
  options?: { url?: string; title?: string },
): { result: CreateTabResult; next: TabEngineSnapshot } {
  if (snapshot.tabs.length >= MAX_OPEN_TABS) {
    return {
      result: { status: 'LIMIT_REACHED', max: MAX_OPEN_TABS },
      next: snapshot,
    };
  }

  try {
    const now = Date.now();
    const tab = createHomeTab({
      url: options?.url ?? BROWSER_HOMEPAGE,
      title: options?.title ?? (options?.url ? '' : undefined),
      lastActiveAt: now,
    });

    const tabs = [...snapshot.tabs, tab];
    const activeTabId = tab.id;
    const reconciled = reconcileMountPool({
      tabs,
      activeTabId,
      mountedTabIds: snapshot.mountedTabIds,
    });

    const next: TabEngineSnapshot = {
      tabs: reconciled.tabs,
      activeTabId,
      mountedTabIds: reconciled.mountedTabIds,
    };

    return { result: { status: 'CREATED', tab: selectActiveTab(next)! }, next };
  } catch (error) {
    return {
      result: {
        status: 'FAILED',
        reason: error instanceof Error ? error.message : 'create_failed',
      },
      next: snapshot,
    };
  }
}

export function closeTabOperation(
  snapshot: TabEngineSnapshot,
  tabId: string,
): { result: CloseTabResult; next: TabEngineSnapshot } {
  const index = findIndex(snapshot.tabs, tabId);
  if (index < 0) {
    return { result: { status: 'NOT_FOUND' }, next: snapshot };
  }

  // Last tab → replace with fresh Home
  if (snapshot.tabs.length === 1) {
    const home = createHomeTab({
      mountState: 'MOUNTED_ACTIVE',
      lastMountedAt: Date.now(),
    });
    const next: TabEngineSnapshot = {
      tabs: [home],
      activeTabId: home.id,
      mountedTabIds: [home.id],
    };
    return { result: { status: 'REPLACED_HOME', tab: home }, next };
  }

  const closingActive = snapshot.activeTabId === tabId;
  const remaining = snapshot.tabs.filter((t) => t.id !== tabId);
  let activeTabId = snapshot.activeTabId;

  if (closingActive) {
    const previous = remaining[index - 1];
    const nextNeighbor = remaining[index] ?? remaining[remaining.length - 1];
    const chosen = previous ?? nextNeighbor!;
    activeTabId = chosen.id;
  }

  const now = Date.now();
  const tabs = remaining.map((t) =>
    t.id === activeTabId ? { ...t, lastActiveAt: now } : t,
  );

  const reconciled = reconcileMountPool({
    tabs,
    activeTabId,
    mountedTabIds: snapshot.mountedTabIds.filter((id) => id !== tabId),
  });

  const next: TabEngineSnapshot = {
    tabs: reconciled.tabs,
    activeTabId,
    mountedTabIds: reconciled.mountedTabIds,
  };

  return {
    result: { status: 'CLOSED', closedTabId: tabId, activeTabId },
    next,
  };
}

export function switchTabOperation(
  snapshot: TabEngineSnapshot,
  tabId: string,
): { result: SwitchTabResult; next: TabEngineSnapshot } {
  if (!snapshot.tabs.some((t) => t.id === tabId)) {
    return { result: { status: 'NOT_FOUND' }, next: snapshot };
  }

  if (snapshot.activeTabId === tabId) {
    return {
      result: { status: 'NOOP', activeTabId: tabId },
      next: snapshot,
    };
  }

  const now = Date.now();
  const tabs = snapshot.tabs.map((t) => {
    if (t.id === snapshot.activeTabId) {
      return { ...t, lastActiveAt: now };
    }
    if (t.id === tabId) {
      return { ...t, lastActiveAt: now };
    }
    return t;
  });

  const reconciled = reconcileMountPool({
    tabs,
    activeTabId: tabId,
    mountedTabIds: snapshot.mountedTabIds,
  });

  const next: TabEngineSnapshot = {
    tabs: reconciled.tabs,
    activeTabId: tabId,
    mountedTabIds: reconciled.mountedTabIds,
  };

  return {
    result: {
      status: 'SWITCHED',
      activeTabId: tabId,
      mountedTabIds: next.mountedTabIds,
      evictedTabId: reconciled.evictedTabId,
    },
    next,
  };
}

export function updateTabOperation(
  snapshot: TabEngineSnapshot,
  tabId: string,
  patch: Partial<
    Pick<
      BrowserTab,
      | 'url'
      | 'title'
      | 'desktopMode'
      | 'desktopModeSource'
      | 'loading'
      | 'progress'
      | 'canGoBack'
      | 'canGoForward'
      | 'error'
      | 'navigationEpoch'
      | 'lastActiveAt'
    >
  >,
): TabEngineSnapshot {
  const tabs = snapshot.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t));
  return { ...snapshot, tabs };
}
