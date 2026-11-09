import NetInfo from '@react-native-community/netinfo';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { isValidBrowserPageUrl } from '@/browser/utils';
import { isIncognitoInFront } from '@/browser/incognito/incognito-state';
import { translate } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';
import { bookmarkOrganizerRepository, OrganizerError } from '@/storage/repositories';
import { useBookmarksStore } from '@/store/bookmarks';
import { useSettingsStore } from '@/store/settings';
import { exportTextFile, importTextFile } from '@/utils/text-file-export';

import { checkLinks, type LinkCheckResult } from './link-check';
import { bookmarkFileHtml, parseBookmarkFile } from './netscape-import';
import { importPathKey } from '@/storage/repositories/bookmark-organizer.queries';

/**
 * B9 — the actions around bookmarks that aren't a single query: notices, the change signal the screens reload on,
 * Bookmark all tabs (#83), the reading list (#89), import / export (#84 / #85), the link check (#91), home-screen
 * shortcuts (#87) and the Edit sheet requests (#78).
 */

export function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

type Listener = () => void;

/** Bumped after every change, so open screens (and the bookmarks bar) reload. */
let version = 0;
const listeners = new Set<Listener>();

export const bookmarkChanges = {
  getVersion: () => version,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** After a change: open screens reload, and the existing bookmarks store (the browser's star) refreshes. */
  changed(): void {
    version += 1;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
    void useBookmarksStore.getState().refresh().catch(() => undefined);
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof OrganizerError) {
    if (error.code === 'INVALID_URL') return translate('browserBookmarks.invalidUrl');
    if (error.code === 'DUPLICATE_URL') return translate('browserBookmarks.duplicateUrl');
    if (error.code === 'INVALID_NAME') return translate('browserBookmarks.invalidName');
  }
  return translate('browserBookmarks.saveFailed');
}

/** Runs a change and reports it; returns false when it failed (the message was shown). */
export async function change<T>(task: () => Promise<T>, success?: string): Promise<T | null> {
  try {
    const result = await task();
    bookmarkChanges.changed();
    if (success) notify(success);
    return result;
  } catch (error) {
    notify(errorMessage(error));
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** #83: every open web page (start pages skipped) into a new folder named with the date. */
export async function bookmarkAllTabs(now: Date = new Date()): Promise<void> {
  const pages = useBrowserStore
    .getState()
    .tabs.filter((tab) => isValidBrowserPageUrl(tab.url))
    .map((tab) => ({ url: tab.url, title: tab.title || tab.url }));
  if (pages.length === 0) {
    notify(translate('browserBookmarks.bookmarkAllNone'));
    return;
  }
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const name = translate('browserBookmarks.bookmarkAllFolder', { date });
  const result = await change(() => bookmarkOrganizerRepository.bookmarkAll(name, pages));
  if (!result) return;
  notify(
    result.skipped > 0
      ? translate('browserBookmarks.bookmarkAllSkipped', { added: result.added, name, skipped: result.skipped })
      : translate('browserBookmarks.bookmarkAllDone', { added: result.added, name }),
  );
}

/** #89 from the menu or a link's long-press. */
export async function addPageToReadingList(url: string, title: string): Promise<void> {
  if (!isValidBrowserPageUrl(url)) return;
  // B11: nothing from an incognito tab is kept, the reading list included.
  if (isIncognitoInFront()) {
    notify(translate('browserIncognito.notSaved'));
    return;
  }
  const outcome = await change(() => bookmarkOrganizerRepository.addToReadingList(url, title));
  if (outcome === 'added') notify(translate('browserBookmarks.readingAdded'));
  else if (outcome === 'exists') notify(translate('browserBookmarks.readingExists'));
}

/** #85: the whole tree as a bookmark file in a folder the user picks (no permission). */
export async function exportBookmarks(now: Date = new Date()): Promise<void> {
  try {
    const html = bookmarkFileHtml(await bookmarkOrganizerRepository.exportTree(), now);
    const outcome = await exportTextFile({
      fileName: `vidorax-bookmarks-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.html`,
      mimeType: 'text/html',
      content: html,
      shareTitle: translate('browserBookmarks.exportShareTitle'),
    });
    if (outcome === 'saved' || outcome === 'shared') notify(translate('browserBookmarks.exportDone'));
    else if (outcome === 'failed') notify(translate('browserBookmarks.exportFailed'));
  } catch {
    notify(translate('browserBookmarks.exportFailed'));
  }
}

/** Big Chrome exports carry base64 icons: 5,000 bookmarks can be 10–20 MB. */
const IMPORT_MAX_BYTES = 40 * 1024 * 1024;

/** #84: a bookmark file the user picks, read as text and merged in (same address skipped). */
export async function importBookmarks(onProgress?: (done: number, total: number) => void): Promise<void> {
  const picked = await importTextFile(['text/html', 'text/plain', 'application/xhtml+xml', '*/*'], IMPORT_MAX_BYTES);
  if (picked.status === 'cancelled') return;
  if (picked.status !== 'picked') {
    notify(translate('browserBookmarks.importFailed'));
    return;
  }
  const parsed = parseBookmarkFile(picked.text);
  if (parsed.notBookmarkFile) {
    notify(translate('browserBookmarks.importNotFile'));
    return;
  }
  const barPaths = new Set(parsed.folders.filter((f) => f.isBookmarksBar).map((f) => importPathKey(f.path)));
  try {
    const totals = await bookmarkOrganizerRepository.importItems(
      parsed.bookmarks,
      barPaths,
      translate('browserBookmarks.bookmarksBar'),
      onProgress,
    );
    bookmarkChanges.changed();
    notify(
      translate('browserBookmarks.importDone', {
        added: totals.added,
        skipped: totals.skipped,
        invalid: totals.invalid + parsed.invalid,
      }),
    );
  } catch {
    bookmarkChanges.changed();
    notify(translate('browserBookmarks.importFailed'));
  }
}

/** #91: false when "Only on Wi-Fi" is on and the phone isn't on Wi-Fi (or Ethernet). */
export async function linkCheckAllowedNow(): Promise<boolean> {
  if (useSettingsStore.getState().linkCheckWifiOnly === false) return true;
  try {
    const state = await NetInfo.fetch();
    return state.type === 'wifi' || state.type === 'ethernet';
  } catch {
    return false;
  }
}

/** #91: checks every bookmark (see link-check.ts); never deletes or changes anything by itself. */
export async function runLinkCheck(
  signal: AbortSignal,
  onResult: (result: LinkCheckResult, done: number, total: number) => void,
): Promise<LinkCheckResult[]> {
  const items = await bookmarkOrganizerRepository.listAllLinks();
  return checkLinks(items, (url, init) => fetch(url, init), { signal, onResult });
}

/** #87: the launcher's own dialog adds the shortcut; a clear message when it can't. */
export async function addToHomeScreen(url: string, title: string): Promise<void> {
  const web = isVidoraWebAvailable() ? getVidoraWeb() : null;
  if (!web?.pinBookmarkShortcut || web.canPinShortcuts?.() === false) {
    notify(translate('browserBookmarks.homeUnsupported'));
    return;
  }
  try {
    const outcome = await web.pinBookmarkShortcut(url, title);
    notify(
      outcome === 'pinned'
        ? translate('browserBookmarks.homePinned')
        : outcome === 'unsupported'
          ? translate('browserBookmarks.homeUnsupported')
          : translate('browserBookmarks.homeFailed'),
    );
  } catch {
    notify(translate('browserBookmarks.homeFailed'));
  }
}

/** #87: once App Lock is open (or off), the shortcut's site in a new tab, on the Browser tab. */
function openWhenUnlocked(url: string): void {
  const open = () => {
    const result = useBrowserStore.getState().createTab({ url });
    if (result.status === 'LIMIT_REACHED') announceTabsLimitReached();
    try {
      navigation.navigate(routePaths.browser);
    } catch {
      // The browser is the start screen anyway.
    }
  };
  const ready = () => {
    const lock = useAppLockStore.getState();
    return lock.isBootstrapped && lock.status !== 'LOCKED';
  };
  if (ready()) {
    open();
    return;
  }
  const unsubscribe = useAppLockStore.subscribe(() => {
    if (!ready()) return;
    unsubscribe();
    open();
  });
}

let shortcutsAttached = false;

/** Idempotent; app start: the shortcut the app was started with, and those tapped while it runs. */
export function ensureBookmarkShortcutHandling(): void {
  if (shortcutsAttached || !isVidoraWebAvailable()) return;
  shortcutsAttached = true;
  const web = getVidoraWeb();
  try {
    const url = web.consumeShortcutUrl?.();
    if (url) openWhenUnlocked(url);
  } catch {
    // Older native build.
  }
  try {
    web.addListener('onShortcutOpen', ({ url }) => {
      if (isValidBrowserPageUrl(url)) openWhenUnlocked(url);
    });
  } catch {
    // Older native build.
  }
}

/** #78: which bookmark the Edit sheet shows (null = closed). */
let editing: string | null = null;
const editListeners = new Set<Listener>();

export const bookmarkEditRequests = {
  get: () => editing,
  open(id: string): void {
    editing = id;
    for (const listener of editListeners) listener();
  },
  close(): void {
    editing = null;
    for (const listener of editListeners) listener();
  },
  subscribe(listener: Listener): () => void {
    editListeners.add(listener);
    return () => {
      editListeners.delete(listener);
    };
  },
};
