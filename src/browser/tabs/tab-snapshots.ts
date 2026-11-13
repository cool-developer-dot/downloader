import { Directory, File, Paths } from 'expo-file-system';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { isBrowserHomeUrl } from '@/browser/utils';
import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import {
  DEFAULT_PROFILE_ID,
  getActiveProfileId,
  subscribeActiveProfile,
} from '@/storage/profile/active-profile';

import { shouldPersistForTab } from './tab-privacy';

/**
 * B1 #14 Tab preview. A small JPEG of each tab's page (`<cache>/tab-previews/<tabId>.jpg`, written by VidoraWeb
 * `snapshotWebView`), taken when the user leaves a tab and when the tab switcher opens. A snapshot is kept while its
 * tab is open or can still be reopened from the closed-tab stack, and deleted with it (`prune`). Start-page tabs and
 * tabs `shouldPersistForTab` refuses get none.
 *
 * B20: a browser profile other than the default names its files `pf-<profileId>-<tabId>.jpg`, so each profile only
 * sees, prunes and clears its own previews.
 */

export const TAB_SNAPSHOT_MAX_WIDTH = 540;
/** Below this load progress a page is usually still blank. */
export const TAB_SNAPSHOT_MIN_PROGRESS = 0.6;
const DIRECTORY = 'tab-previews';

export type TabSnapshot = {
  uri: string;
  /** width / height of the captured page area; null when only the file is known (after a restart). */
  aspect: number | null;
  takenAt: number;
};

type Listener = () => void;

const snapshots = new Map<string, TabSnapshot>();
const listeners = new Set<Listener>();
const inFlight = new Set<string>();
let version = 0;
let scanned = false;

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function snapshotDirectory(): Directory {
  return new Directory(Paths.cache, DIRECTORY);
}

/** The file name (without `.jpg`) of a tab's preview in a profile; at most 64 characters (VidoraWeb's key rule). */
function fileKey(tabId: string, profileId: string = getActiveProfileId()): string {
  return profileId === DEFAULT_PROFILE_ID ? tabId : `pf-${profileId}-${tabId}`;
}

/** The tab a preview file belongs to in this profile, or null for another profile's file. */
function tabIdOfFile(fileName: string, profileId: string): string | null {
  if (!fileName.endsWith('.jpg')) return null;
  const base = fileName.slice(0, -'.jpg'.length);
  if (profileId === DEFAULT_PROFILE_ID) return base.startsWith('pf-') ? null : base;
  const prefix = `pf-${profileId}-`;
  return base.startsWith(prefix) ? base.slice(prefix.length) : null;
}

/** After a restart the files are still there: learn them once, lazily. */
function scanOnce(): void {
  if (scanned) return;
  scanned = true;
  try {
    const dir = snapshotDirectory();
    if (!dir.exists) return;
    const profileId = getActiveProfileId();
    for (const entry of dir.list()) {
      const id = entry instanceof File ? tabIdOfFile(entry.name, profileId) : null;
      if (entry instanceof File && id) {
        if (!snapshots.has(id)) {
          snapshots.set(id, { uri: entry.uri, aspect: null, takenAt: entry.modificationTime ?? 0 });
        }
      }
    }
  } catch {
    // Cache unreadable: previews simply start empty.
  }
}

function deleteFile(tabId: string): void {
  try {
    const file = new File(Paths.cache, DIRECTORY, `${fileKey(tabId)}.jpg`);
    if (file.exists) file.delete();
  } catch {
    // Best effort; the cache is the system's to clear anyway.
  }
}

export const tabSnapshots = {
  get(tabId: string): TabSnapshot | null {
    scanOnce();
    return snapshots.get(tabId) ?? null;
  },

  getVersion(): number {
    return version;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Captures the tab's WebView if it has one mounted and shows a page. A tab left early in loading keeps its previous
   * preview (the WebView would still be blank). Never throws; resolves when done.
   */
  async capture(tab: { id: string; url: string; loading?: boolean; progress?: number }): Promise<void> {
    if (isBrowserHomeUrl(tab.url) || !shouldPersistForTab(tab) || inFlight.has(tab.id)) return;
    if (tab.loading && (tab.progress ?? 0) < TAB_SNAPSHOT_MIN_PROGRESS) return;
    const viewTag = getTabWebViewTag(tab.id);
    if (viewTag == null || !isVidoraWebAvailable()) return;
    const web = getVidoraWeb();
    if (typeof web.snapshotWebView !== 'function') return;
    inFlight.add(tab.id);
    try {
      const profileId = getActiveProfileId();
      const shot = await web.snapshotWebView(viewTag, TAB_SNAPSHOT_MAX_WIDTH, fileKey(tab.id, profileId));
      // The user switched profiles while it was taken: the file belongs to the old profile, which scans it later.
      if (profileId !== getActiveProfileId()) return;
      if (shot && shot.width > 0 && shot.height > 0) {
        scanOnce();
        snapshots.set(tab.id, { uri: shot.uri, aspect: shot.width / shot.height, takenAt: Date.now() });
        emit();
      }
    } catch {
      // A missing preview is never an error.
    } finally {
      inFlight.delete(tab.id);
    }
  },

  /** Deletes every snapshot whose tab is neither open nor in the closed-tab stack. */
  prune(keepTabIds: Iterable<string>): void {
    scanOnce();
    const keep = new Set(keepTabIds);
    let changed = false;
    for (const id of [...snapshots.keys()]) {
      if (!keep.has(id)) {
        snapshots.delete(id);
        deleteFile(id);
        changed = true;
      }
    }
    if (changed) emit();
  },

  /** Drops one tab's snapshot (a private tab, a page left for the start page). */
  remove(tabId: string): void {
    if (snapshots.delete(tabId)) emit();
    deleteFile(tabId);
  },

  /** Clear browsing data (B10): every snapshot of this profile, open tabs included. */
  clearAll(): void {
    scanOnce();
    for (const id of [...snapshots.keys()]) deleteFile(id);
    snapshots.clear();
    emit();
  },

  /** B20: every preview of a profile being deleted (or of guest mode when it ends). */
  deleteProfile(profileId: string): void {
    try {
      const dir = snapshotDirectory();
      if (!dir.exists) return;
      for (const entry of dir.list()) {
        if (entry instanceof File && tabIdOfFile(entry.name, profileId)) entry.delete();
      }
    } catch {
      // Best effort; the cache is the system's to clear anyway.
    }
  },
};

// B20: another profile's previews are learnt fresh.
subscribeActiveProfile(() => {
  snapshots.clear();
  scanned = false;
  emit();
});
