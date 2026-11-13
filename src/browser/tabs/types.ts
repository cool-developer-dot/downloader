import type { BrowserErrorState } from '@/browser/types';

export type DesktopModeSource = 'default' | 'user' | 'platform';

export type TabMountState = 'MOUNTED_ACTIVE' | 'MOUNTED_INACTIVE' | 'EVICTED';

/**
 * Full runtime tab model.
 * Only a subset is persisted — see PersistedTabMetadata.
 */
export type BrowserTab = {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  desktopMode: boolean;
  desktopModeSource: DesktopModeSource;
  loading: boolean;
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  error: BrowserErrorState | null;
  navigationEpoch: number;
  mountState: TabMountState;
  lastMountedAt: number | null;
  /** B1 #5: pinned tabs lead the list and survive Close other / Close all unless the user asks. */
  pinned: boolean;
};

/** Safe restoration metadata only — never cookies / auth / media / history stacks. */
export type PersistedTabMetadata = {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  desktopMode: boolean;
  desktopModeSource: DesktopModeSource;
  /** Schema 2 (B1). Older envelopes have neither; see tab-envelope.ts. */
  pinned?: boolean;
  /** Schema 2 (B1): index in the user's tab order. */
  position?: number;
  /** Schema 3 (B2): the tab's group (normal tabs only). */
  groupId?: string;
};

export type PersistedBrowserTabsEnvelope = {
  schemaVersion: number;
  activeTabId: string;
  tabs: PersistedTabMetadata[];
  updatedAt: number;
  /** Schema 3 (B2): the tab groups (normal tabs only; incognito groups are never saved). */
  groups?: { id: string; name: string; color: string; collapsed: boolean }[];
};

export type CreateTabResult =
  | { status: 'CREATED'; tab: BrowserTab; evictedTabIds: string[] }
  | { status: 'LIMIT_REACHED'; max: number }
  | { status: 'FAILED'; reason: string };

export type CloseTabResult =
  | {
      status: 'CLOSED';
      closedTabId: string;
      activeTabId: string;
      evictedTabIds: string[];
    }
  | { status: 'REPLACED_HOME'; tab: BrowserTab; evictedTabIds: string[] }
  | { status: 'NOT_FOUND' }
  | { status: 'FAILED'; reason: string };

export type SwitchTabResult =
  | {
      status: 'SWITCHED';
      activeTabId: string;
      mountedTabIds: string[];
      evictedTabId: string | null;
      evictedTabIds: string[];
    }
  | { status: 'NOOP'; activeTabId: string }
  | { status: 'NOT_FOUND' }
  | { status: 'FAILED'; reason: string };

export type TabEngineSnapshot = {
  tabs: BrowserTab[];
  activeTabId: string;
  mountedTabIds: string[];
};
