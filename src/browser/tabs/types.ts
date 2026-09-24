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
};

export type PersistedBrowserTabsEnvelope = {
  schemaVersion: number;
  activeTabId: string;
  tabs: PersistedTabMetadata[];
  updatedAt: number;
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
