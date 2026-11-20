import NetInfo from '@react-native-community/netinfo';
import * as ReactNative from 'react-native';

import { translate } from '@/localization';
import { formatFileSize } from '@/media-detection/utils/format';

import { getV2Engine } from './engine-port';
import { copySettled, pendingCopyIds } from './save-location';
import { createSaveLocationCopier, type CopierItem, type SaveLocationCopier } from './save-location-copier';
import {
  getSaveLocationSettings,
  useExternalCopiesStore,
  useFolderCopyStatusStore,
  useSaveLocationStore,
} from './save-location-store';
import { getTreeExportPort } from './tree-export-port';

/** A copy this large takes long enough that the user is told when it starts and ends. */
export const LARGE_COPY_BYTES = 100 * 1024 * 1024;
/** The catch-up pass waits for startup to settle. */
const CATCH_UP_DELAY_MS = 6_000;
/** Newest library items a catch-up pass looks at. */
const CATCH_UP_WINDOW = 50;

function toast(message: string): void {
  if (ReactNative.Platform.OS === 'android') {
    ReactNative.ToastAndroid.show(message, ReactNative.ToastAndroid.SHORT);
  }
  ReactNative.AccessibilityInfo.announceForAccessibility(message);
}

/** The folder grant is gone: turn the option off and say so, with the way back. */
export function handleSaveLocationAccessLost(): void {
  const wasOn = useSaveLocationStore.getState().enabled;
  useSaveLocationStore.getState().dispatch({ type: 'access-lost' });
  if (wasOn) {
    toast(translate('saveLocation.accessLost'));
  }
}

async function libraryItem(id: string): Promise<CopierItem | null> {
  const engine = getV2Engine();
  const item = engine ? await engine.getLibraryItem(id) : null;
  if (!item) {
    return null;
  }
  return {
    id: item.id,
    title: item.title,
    mimeType: item.mimeType,
    site: item.site,
    pageUrl: item.pageUrl,
    sizeBytes: item.sizeBytes,
  };
}

/**
 * Copies library items that completed while the option was on but got no copy (finished while no JavaScript ran).
 * Also notices a folder grant that was revoked meanwhile. Never throws.
 */
async function catchUp(copier: SaveLocationCopier): Promise<void> {
  const settings = getSaveLocationSettings();
  const engine = getV2Engine();
  const port = getTreeExportPort();
  if (!settings.enabled || !settings.treeUri || !engine || !port) {
    return;
  }
  try {
    if (!(await port.hasFolderAccess(settings.treeUri))) {
      if (getSaveLocationSettings().treeUri === settings.treeUri) {
        handleSaveLocationAccessLost();
      }
      return;
    }
    const page = await engine.listLibrary({ sort: 'newest', limit: CATCH_UP_WINDOW });
    const active = copier.activeId();
    const ids = pendingCopyIds(
      page.items,
      useExternalCopiesStore.getState().records,
      getSaveLocationSettings(),
      new Set(active ? [active] : []),
      Date.now(),
    );
    for (const id of ids) {
      copier.enqueue(id);
    }
  } catch {
    // Next foreground tries again.
  }
}

type Attached = {
  subscriptions: { remove(): void }[];
  copier: SaveLocationCopier;
  timer: ReturnType<typeof setTimeout> | null;
};
const ATTACHED_KEY = '__vidoraxSaveLocationCopies';

/**
 * Kept on `globalThis`: a Fast Refresh re-runs this module, so what an earlier copy attached is removed first — a
 * completion is never copied twice.
 */
function replaceAttached(next: Attached | null): void {
  const store = globalThis as unknown as Record<string, Attached | null | undefined>;
  const previous = store[ATTACHED_KEY];
  if (previous) {
    for (const subscription of previous.subscriptions) {
      try {
        subscription.remove();
      } catch {
        // already gone
      }
    }
    if (previous.timer) {
      clearTimeout(previous.timer);
    }
    previous.copier.dispose();
  }
  store[ATTACHED_KEY] = next;
}

/**
 * "Also save a copy to…" (#297): when a v2 download completes and the option is on, its finished file is copied to
 * the picked folder. Off by default — then nothing here does anything. Idempotent; builds without the native
 * functions do nothing.
 */
export function ensureSaveLocationCopies(): void {
  const engine = getV2Engine();
  const port = getTreeExportPort();
  if (!engine || !port) {
    return;
  }
  // Unknown until NetInfo answers: assumed not Wi-Fi, so a Wi-Fi-only copy waits for the first answer.
  let onWifi = false;
  void NetInfo.fetch()
    .then((state) => {
      onWifi = state.type === 'wifi' || state.type === 'ethernet';
    })
    .catch(() => undefined);
  const copier = createSaveLocationCopier({
    getSettings: getSaveLocationSettings,
    getItem: libraryItem,
    copy: (id, treeUri, subfolders) => port.copyToFolder(id, treeUri, subfolders),
    hasRecord: (id) => copySettled(useExternalCopiesStore.getState().records[id], Date.now()),
    canCopyNow: () => !getSaveLocationSettings().wifiOnly || onWifi,
    failedAttempts: (id) => {
      const record = useExternalCopiesStore.getState().records[id];
      return record?.status === 'failed' ? (record.attempts ?? 1) : 0;
    },
    record: (id, record) => useExternalCopiesStore.getState().setRecord(id, record),
    onAccessLost: handleSaveLocationAccessLost,
    onStarted: (item, folder) => {
      if (item.sizeBytes >= LARGE_COPY_BYTES) {
        toast(
          translate('saveLocation.copyingLarge', {
            size: formatFileSize(item.sizeBytes) ?? '',
            folder: folder ?? translate('saveLocation.chosenFolder'),
          }),
        );
      }
    },
    onCopied: (item, _copy, folder) => {
      if (item.sizeBytes >= LARGE_COPY_BYTES) {
        toast(translate('saveLocation.copied', { folder: folder ?? translate('saveLocation.chosenFolder') }));
      }
    },
    onFailed: () => toast(translate('saveLocation.copyFailed')),
    onActiveChange: (id) => useFolderCopyStatusStore.setState({ activeId: id }),
    now: Date.now,
  });
  const subscriptions = [
    engine.addListener('onDownloadStateChange', ({ record }) => {
      if (record.state === 'completed') {
        copier.enqueue(record.libraryItemId ?? record.id);
      }
    }),
    engine.addListener('onLibraryChange', ({ reason, ids }) => {
      // Deleting in VidoraX never deletes the copy; only the record of where it went is forgotten.
      if (reason === 'deleted' && ids.length > 0) {
        useExternalCopiesStore.getState().forget(ids);
      }
    }),
    ReactNative.AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void catchUp(copier);
      }
    }),
    // #513: copies waiting for Wi-Fi go as soon as it is back.
    {
      remove: NetInfo.addEventListener((state) => {
        const wifi = state.type === 'wifi' || state.type === 'ethernet';
        const back = wifi && !onWifi;
        onWifi = wifi;
        if (back && getSaveLocationSettings().wifiOnly) void catchUp(copier);
      }),
    },
  ];
  const attached: Attached = { subscriptions, copier, timer: null };
  replaceAttached(attached);
  attached.timer = setTimeout(() => {
    attached.timer = null;
    void catchUp(copier);
  }, CATCH_UP_DELAY_MS);
}

export function resetSaveLocationCopiesForTests(): void {
  replaceAttached(null);
}
