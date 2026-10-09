import { AppState, Platform, ToastAndroid } from 'react-native';

import { translate } from '@/localization';
import { reconcileReviewCompletions } from '@/review/in-app-review';
import { useDownloadsStore } from '@/store/downloads';
import { useSettingsStore } from '@/store/settings';

import {
  hydrateV2ActiveDownloads,
  hydrateV2Downloads,
  subscribeV2Downloads,
  type V2BridgeSink,
} from './bridge';
import { getV2Engine } from './engine-port';
import { projectV2LibraryItem } from './projection';
import { createLibraryReconciler } from './library-reconcile';
import { pushV2DownloadSettings } from './settings';

let attached = false;
let detach: (() => void) | null = null;
let detachSettings: (() => void) | null = null;
let detachAppState: (() => void) | null = null;
let libraryHydration: Promise<void> | null = null;
let libraryHydrationTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The whole library reaches the downloads store only once startup has settled: pulling thousands of items across
 * the bridge while the first screens render made a large library cost seconds of launch time. The Player tab asks
 * for it at once when it opens first.
 */
const LIBRARY_HYDRATION_DELAY_MS = 2_500;

/** One reconciler for the app: the Player tab, the player and app foreground share its interval. */
const libraryReconciler = createLibraryReconciler({
  engine: getV2Engine,
  onRemoved: (ids) => useDownloadsStore.getState().removeEngineEntries(ids),
});

/**
 * Removes library items whose file was deleted or moved outside VidoraX (at most once per interval unless
 * `force`). Called when the Player tab gains focus, on pull-to-refresh and when the app returns to the foreground.
 */
export function reconcileV2Library(options?: { force?: boolean }): Promise<string[]> {
  return libraryReconciler.reconcileAll(options);
}

/** The same repair for specific items, e.g. the one the player just found missing. */
export function reconcileV2LibraryIds(ids: string[]): Promise<string[]> {
  return libraryReconciler.reconcileIds(ids);
}

/**
 * Counts genuine completions for the in-app review from the engine's own record — also downloads that finished while
 * no JavaScript ran — each once. Older native builds without the record simply count nothing.
 */
function reconcileCompletions(): void {
  const engine = getV2Engine();
  if (!engine?.listCompletedDownloads || !engine.acknowledgeCompletedDownloads) {
    return;
  }
  void reconcileReviewCompletions({
    listCompletedDownloads: () => engine.listCompletedDownloads!(),
    acknowledgeCompletedDownloads: (ids) => engine.acknowledgeCompletedDownloads!(ids),
  });
}

function storeSink(): V2BridgeSink {
  return {
    applyEntries: (entries) => useDownloadsStore.getState().applyEngineEntries(entries),
    applyProgress: (event) => useDownloadsStore.getState().applyEngineProgress(event),
    removeEntries: (ids) => useDownloadsStore.getState().removeEngineEntries(ids),
    rowOf: (id) => useDownloadsStore.getState().engineRowsById[id] ?? null,
    onCompleted: () => reconcileCompletions(),
    announceCompleted: () => {
      // A system toast: shown over whatever screen is in front, never takes focus or blocks a touch.
      if (Platform.OS === 'android') {
        ToastAndroid.show(translate('downloads.completedToast'), ToastAndroid.SHORT);
      }
    },
    announceDuplicate: () => {
      if (Platform.OS === 'android') {
        ToastAndroid.show(translate('downloads.alreadyDownloadedToast'), ToastAndroid.SHORT);
      }
    },
  };
}

/**
 * Mirrors the v2 DownloadEngine into the downloads store: its persisted records and library items are the source
 * of truth for Downloads and Library. Idempotent; a build without the native module simply has no v2 downloads.
 */
export function ensureV2DownloadBridge(): void {
  if (attached) {
    return;
  }
  const engine = getV2Engine();
  if (!engine) {
    return;
  }
  attached = true;
  // The engine keeps its own copy of the settings, so Wi-Fi-only applies to downloads that resume before the
  // app's JavaScript is running at all.
  const pushSettings = () => {
    const settings = useSettingsStore.getState();
    void pushV2DownloadSettings(engine, {
      wifiOnly: settings.wifiOnly,
      maxConcurrentDownloads: settings.maxConcurrentDownloads,
      saveToGallery: settings.saveToGallery,
    });
  };
  pushSettings();
  detachSettings = useSettingsStore.subscribe(pushSettings);
  const sink = storeSink();
  // Subscribe before hydrating so a completion during startup is never missed.
  detach = subscribeV2Downloads(engine, sink);
  // Files can disappear while VidoraX is in the background; coming back is when the user looks again.
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void reconcileV2Library();
      reconcileCompletions();
    }
  });
  detachAppState = () => appStateSubscription.remove();
  void hydrateV2ActiveDownloads(engine, sink).catch(() => {
    // Downloads screen refresh re-hydrates.
  });
  libraryHydrationTimer = setTimeout(() => {
    libraryHydrationTimer = null;
    void ensureV2LibraryHydrated();
  }, LIBRARY_HYDRATION_DELAY_MS);
  // Downloads that finished while the app was closed (a background job, a boot job) are counted now.
  reconcileCompletions();
}

/** Loads every library item into the downloads store once (the Player tab calls it on open). Never rejects. */
export function ensureV2LibraryHydrated(): Promise<void> {
  if (libraryHydration) {
    return libraryHydration;
  }
  const engine = getV2Engine();
  if (!engine) {
    return Promise.resolve();
  }
  if (libraryHydrationTimer) {
    clearTimeout(libraryHydrationTimer);
    libraryHydrationTimer = null;
  }
  libraryHydration = hydrateV2Downloads(engine, storeSink()).then(
    () => undefined,
    () => {
      // Try again on the next request.
      libraryHydration = null;
    },
  );
  return libraryHydration;
}

/**
 * Makes sure one library item is in the downloads store, reading just that item when the whole library has not been
 * loaded yet (a Player opened from a notification right after launch). Resolves false when there is no such item.
 */
export async function ensureV2LibraryItem(id: string): Promise<boolean> {
  if (useDownloadsStore.getState().engineRowsById[id]) {
    return true;
  }
  const engine = getV2Engine();
  if (!engine) {
    return false;
  }
  try {
    const item = await engine.getLibraryItem(id);
    if (!item) {
      return false;
    }
    if (!useDownloadsStore.getState().engineRowsById[id]) {
      useDownloadsStore.getState().applyEngineEntries([projectV2LibraryItem(item)]);
    }
    return true;
  } catch {
    return false;
  }
}

/** Re-reads every persisted v2 download and library item (Downloads pull-to-refresh, app foreground). */
export async function refreshV2Downloads(): Promise<void> {
  const engine = getV2Engine();
  if (!engine) {
    return;
  }
  await hydrateV2Downloads(engine, storeSink());
}

export function resetV2DownloadBridgeForTests(): void {
  detach?.();
  detach = null;
  detachSettings?.();
  detachSettings = null;
  detachAppState?.();
  detachAppState = null;
  if (libraryHydrationTimer) {
    clearTimeout(libraryHydrationTimer);
    libraryHydrationTimer = null;
  }
  libraryHydration = null;
  attached = false;
}
