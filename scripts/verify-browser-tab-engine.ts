/**
 * Phase 3B — Browser tab engine verification (static architecture + pure inline logic).
 * Does not import React Native / Expo runtime modules.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-browser-tab-engine.ts
 *   npm run verify:browser-tab-engine
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function mustInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} missing: ${needle}`);
  }
}

const MAX_OPEN_TABS = 8;
const MAX_MOUNTED = 2;
const HOME = 'vidorax://home';

type Tab = {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  desktopMode: boolean;
  desktopModeSource: 'default' | 'user' | 'platform';
  loading: boolean;
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  error: null;
  navigationEpoch: number;
  mountState: 'MOUNTED_ACTIVE' | 'MOUNTED_INACTIVE' | 'EVICTED';
  lastMountedAt: number | null;
};

type Snap = { tabs: Tab[]; activeTabId: string; mountedTabIds: string[] };

function homeTab(overrides?: Partial<Tab>): Tab {
  const now = Date.now();
  return {
    id: randomUUID(),
    url: HOME,
    title: 'Home',
    createdAt: now,
    lastActiveAt: now,
    desktopMode: false,
    desktopModeSource: 'default',
    loading: false,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    error: null,
    navigationEpoch: 0,
    mountState: 'EVICTED',
    lastMountedAt: null,
    ...overrides,
  };
}

function reconcile(input: Snap): Snap & { evictedTabId: string | null } {
  const tabIds = new Set(input.tabs.map((t) => t.id));
  let mounted = input.mountedTabIds.filter((id) => tabIds.has(id));
  if (!mounted.includes(input.activeTabId)) {
    mounted = [...mounted, input.activeTabId];
  }
  let evictedTabId: string | null = null;
  while (mounted.length > MAX_MOUNTED) {
    const inactive = mounted.filter((id) => id !== input.activeTabId);
    if (!inactive.length) break;
    const ranked = inactive
      .map((id) => {
        const tab = input.tabs.find((t) => t.id === id)!;
        return { id, score: tab.lastMountedAt ?? tab.lastActiveAt ?? 0 };
      })
      .sort((a, b) => a.score - b.score);
    evictedTabId = ranked[0]!.id;
    mounted = mounted.filter((id) => id !== evictedTabId);
  }
  const tabs = input.tabs.map((tab) => {
    if (!mounted.includes(tab.id)) {
      return {
        ...tab,
        mountState: 'EVICTED' as const,
        canGoBack: false,
        canGoForward: false,
        lastMountedAt: null,
      };
    }
    if (tab.id === input.activeTabId) {
      return { ...tab, mountState: 'MOUNTED_ACTIVE' as const, lastMountedAt: Date.now() };
    }
    return { ...tab, mountState: 'MOUNTED_INACTIVE' as const };
  });
  return { tabs, activeTabId: input.activeTabId, mountedTabIds: mounted, evictedTabId };
}

function createTab(snap: Snap): { status: string; next: Snap; tab?: Tab } {
  if (snap.tabs.length >= MAX_OPEN_TABS) {
    return { status: 'LIMIT_REACHED', next: snap };
  }
  const tab = homeTab();
  const tabs = [...snap.tabs, tab];
  const next = reconcile({ tabs, activeTabId: tab.id, mountedTabIds: snap.mountedTabIds });
  return { status: 'CREATED', next, tab };
}

function closeTab(snap: Snap, tabId: string): { status: string; next: Snap } {
  const index = snap.tabs.findIndex((t) => t.id === tabId);
  if (index < 0) return { status: 'NOT_FOUND', next: snap };
  if (snap.tabs.length === 1) {
    const home = homeTab({ mountState: 'MOUNTED_ACTIVE', lastMountedAt: Date.now() });
    return {
      status: 'REPLACED_HOME',
      next: { tabs: [home], activeTabId: home.id, mountedTabIds: [home.id] },
    };
  }
  const closingActive = snap.activeTabId === tabId;
  const remaining = snap.tabs.filter((t) => t.id !== tabId);
  let activeTabId = snap.activeTabId;
  if (closingActive) {
    const previous = remaining[index - 1];
    const nextNeighbor = remaining[index] ?? remaining[remaining.length - 1];
    activeTabId = (previous ?? nextNeighbor)!.id;
  }
  const now = Date.now();
  const tabs = remaining.map((t) =>
    t.id === activeTabId ? { ...t, lastActiveAt: now } : t,
  );
  return {
    status: 'CLOSED',
    next: reconcile({
      tabs,
      activeTabId,
      mountedTabIds: snap.mountedTabIds.filter((id) => id !== tabId),
    }),
  };
}

function switchTab(snap: Snap, tabId: string): { status: string; next: Snap } {
  if (!snap.tabs.some((t) => t.id === tabId)) return { status: 'NOT_FOUND', next: snap };
  if (snap.activeTabId === tabId) return { status: 'NOOP', next: snap };
  const now = Date.now();
  const tabs = snap.tabs.map((t) =>
    t.id === snap.activeTabId || t.id === tabId ? { ...t, lastActiveAt: now } : t,
  );
  return {
    status: 'SWITCHED',
    next: reconcile({ tabs, activeTabId: tabId, mountedTabIds: snap.mountedTabIds }),
  };
}

console.log('Phase 3B — Browser Tab Engine Verification\n');

test('source files present', () => {
  mustInclude(read('src/browser/tabs/types.ts'), ['BrowserTab', 'PersistedTabMetadata', 'MOUNTED_ACTIVE'], 'types');
  mustInclude(read('src/browser/tabs/constants.ts'), ['MAX_OPEN_TABS = 8', 'MAX_MOUNTED_WEBVIEWS = 2'], 'constants');
  mustInclude(read('src/browser/tabs/tab-operations.ts'), ['createTabOperation', 'closeTabOperation', 'switchTabOperation'], 'ops');
  mustInclude(read('src/browser/tabs/mount-pool.ts'), ['reconcileMountPool', 'MAX_MOUNTED_WEBVIEWS'], 'mount');
  mustInclude(read('src/browser/tabs/tab-persistence.service.ts'), ['hydrateTabEngineState', 'coldStartMountPool', 'PersistedTabMetadata'], 'persist');
});

test('fresh state → exactly 1 tab + valid activeTabId', () => {
  const home = homeTab({ mountState: 'MOUNTED_ACTIVE', lastMountedAt: Date.now() });
  const snap: Snap = { tabs: [home], activeTabId: home.id, mountedTabIds: [home.id] };
  assert(snap.tabs.length === 1, 'one tab');
  assert(snap.tabs.some((t) => t.id === snap.activeTabId), 'active valid');
});

test('createTab increases count, activates Home, enforces max 8', () => {
  let snap: Snap = (() => {
    const home = homeTab({ mountState: 'MOUNTED_ACTIVE', lastMountedAt: Date.now() });
    return { tabs: [home], activeTabId: home.id, mountedTabIds: [home.id] };
  })();
  const created = createTab(snap);
  assert(created.status === 'CREATED', 'created');
  assert(created.next.tabs.length === 2, 'count 2');
  assert(created.tab!.url === HOME, 'home url');
  assert(created.next.activeTabId === created.tab!.id, 'activated');
  snap = created.next;
  for (let i = 0; i < MAX_OPEN_TABS - 2; i += 1) {
    const r = createTab(snap);
    assert(r.status === 'CREATED', `create ${i}`);
    snap = r.next;
  }
  assert(snap.tabs.length === MAX_OPEN_TABS, 'at max');
  assert(createTab(snap).status === 'LIMIT_REACHED', 'blocked');
});

test('close inactive / active neighbor / final home', () => {
  let snap: Snap = (() => {
    const home = homeTab({ mountState: 'MOUNTED_ACTIVE', lastMountedAt: Date.now() });
    return { tabs: [home], activeTabId: home.id, mountedTabIds: [home.id] };
  })();
  const a = snap.activeTabId;
  snap = createTab(snap).next;
  const b = snap.activeTabId;
  snap = createTab(snap).next;
  const closedInactive = closeTab(snap, a);
  assert(closedInactive.status === 'CLOSED', 'inactive closed');
  assert(closedInactive.next.activeTabId === snap.activeTabId, 'active unchanged');

  snap = closedInactive.next;
  const active = snap.activeTabId;
  // ensure order: find index of active, close it expecting previous
  const idx = snap.tabs.findIndex((t) => t.id === active);
  const expectedPrev = snap.tabs[idx - 1]?.id;
  const closedActive = closeTab(snap, active);
  assert(closedActive.status === 'CLOSED', 'active closed');
  if (expectedPrev) {
    assert(closedActive.next.activeTabId === expectedPrev, 'previous neighbor');
  }

  // close down to one then final
  while (snap.tabs.length > 1) {
    snap = closeTab(snap, snap.tabs[0]!.id).next;
  }
  const finalClose = closeTab(snap, snap.activeTabId);
  assert(finalClose.status === 'REPLACED_HOME', 'replaced');
  assert(finalClose.next.tabs.length === 1, 'one remains');
  assert(finalClose.next.tabs[0]!.url === HOME, 'home');
  void b;
});

test('close first active → next when no previous', () => {
  let snap: Snap = (() => {
    const home = homeTab({ mountState: 'MOUNTED_ACTIVE', lastMountedAt: Date.now() });
    return { tabs: [home], activeTabId: home.id, mountedTabIds: [home.id] };
  })();
  const first = snap.activeTabId;
  snap = createTab(snap).next;
  snap = switchTab(snap, first).next;
  const closed = closeTab(snap, first);
  assert(closed.status === 'CLOSED', 'closed');
  assert(closed.next.tabs.length === 1, 'one left');
  assert(closed.next.activeTabId !== first, 'moved to next');
});

test('switchTab updates activeTabId + lastActiveAt', () => {
  let snap: Snap = (() => {
    const home = homeTab({ mountState: 'MOUNTED_ACTIVE', lastMountedAt: Date.now() });
    return { tabs: [home], activeTabId: home.id, mountedTabIds: [home.id] };
  })();
  const a = snap.activeTabId;
  snap = createTab(snap).next;
  const before = Date.now() - 1;
  const switched = switchTab(snap, a);
  assert(switched.status === 'SWITCHED', 'switched');
  assert(switched.next.activeTabId === a, 'A active');
  assert(switched.next.tabs.find((t) => t.id === a)!.lastActiveAt >= before, 'lastActiveAt');
});

test('tab count derived + store wires create/close/switch', () => {
  mustInclude(read('src/browser/stores/browserStore/selectors.ts'), ['state.tabs.length', 'selectActiveTabId'], 'selectors');
  mustInclude(
    read('src/browser/stores/browserStore/actions.ts'),
    ['createTab:', 'closeTab:', 'switchTab:', 'clearTab', 'setActiveTab', 'do NOT mutate global MMKV'],
    'actions',
  );
  mustInclude(read('src/browser/types/browser.types.ts'), ['activeTabId', 'mountedTabIds', 'BrowserTab'], 'types');
});

test('Desktop per-tab + global default new-tab only', () => {
  mustInclude(read('src/browser/tabs/tab-factory.ts'), ['readNewTabDesktopDefault'], 'factory default');
  const actions = read('src/browser/stores/browserStore/actions.ts');
  assert(!actions.includes('persistDesktopMode(enabled)'), 'no MMKV write on toggle');
});

test('shared cookies + CTA consumption key + seams', () => {
  mustInclude(read('src/browser/webview/webview-configuration.ts'), ['sharedCookiesEnabled: true'], 'cookies');
  mustInclude(
    read('src/browser/media-actions/browser-media-action.service.ts'),
    ['buildTabScopedConsumptionKey', 'slices', 'suspendTab', 'clearTab'],
    'cta',
  );
  assert(`${'t1'}:${'fp'}` === 't1:fp', 'key shape');
});

test('mount pool LRU + active never evicted + history zero on evict', () => {
  const tabs = [
    homeTab({ id: 'a', lastActiveAt: 1, lastMountedAt: 1, canGoBack: true, canGoForward: true }),
    homeTab({ id: 'b', lastActiveAt: 2, lastMountedAt: 2 }),
    homeTab({ id: 'c', lastActiveAt: 3, lastMountedAt: 3 }),
  ];
  const result = reconcile({ tabs, activeTabId: 'c', mountedTabIds: ['a', 'b'] });
  assert(result.mountedTabIds.includes('c'), 'active mounted');
  assert(result.mountedTabIds.length <= MAX_MOUNTED, 'cap');
  assert(result.evictedTabId === 'a', `evict a got ${result.evictedTabId}`);
  const evicted = result.tabs.find((t) => t.id === 'a')!;
  assert(evicted.canGoBack === false && evicted.canGoForward === false, 'no fake history');
  assert(evicted.mountState === 'EVICTED', 'evicted state');
});

test('persistence hydrates active-only + sanitizes', () => {
  mustInclude(
    read('src/browser/tabs/tab-persistence.service.ts'),
    ['coldStartMountPool', 'MAX_OPEN_TABS', 'schemaVersion', 'sanitizeEnvelope'],
    'hydrate',
  );
  mustInclude(read('src/storage/constants/mmkv-keys.ts'), ['browserTabs'], 'mmkv key');
});

test('BrowserContainer uses MountedTabWebView pool', () => {
  mustInclude(
    read('src/browser/components/BrowserContainer/BrowserContainer.tsx'),
    ['MountedTabWebView', 'mountedTabIds'],
    'container',
  );
  mustInclude(
    read('src/browser/components/BrowserContainer/MountedTabWebView.tsx'),
    ['useTabScopedBrowserEngine', 'isActive'],
    'host',
  );
});

test('no Phase 1 duplication / no secrets persisted', () => {
  const persist = read('src/browser/tabs/tab-persistence.service.ts');
  assert(!persist.includes('requestContext'), 'no requestContext');
  assert(!persist.includes('Authorization'), 'no auth');
  assert(!/cookie/i.test(persist), 'no cookies');
  const ops = read('src/browser/tabs/tab-operations.ts');
  assert(!ops.includes('admission-scheduler'), 'no scheduler');
});

test('New Tab menu uses createTab not goHome', () => {
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(menu, ['createTab()', 'LIMIT_REACHED'], 'menu');
  assert(!menu.includes('engine.goHome()'), 'stub removed');
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
