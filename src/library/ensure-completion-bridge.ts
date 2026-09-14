/**
 * Download COMPLETED / REMOVED → Library reconciliation bridge.
 * Phase 1A: local catalog + engine records; remote metadata not required.
 */

import { downloadEngine } from '@/downloads/engine';
import { deletePlaybackState } from '@/playback/persistence';
import { PLAYBACK_LOCAL_NAMESPACE } from '@/playback/constants';
import { invalidatePlaybackUiQueries } from '@/playback/query-keys';
import { getCachedFavoriteMediaIds } from '@/storage/services/catalog-persist';
import { useDownloadsStore } from '@/store/downloads';
import { useFavoritesStore } from '@/store/favorites';
import { useLibraryStore } from '@/store/library';

import { libraryLog } from './diagnostics';
import {
  configureLibraryRepository,
  invalidateLibraryAvailability,
  reconcileAvailability,
} from './repository';

let bound = false;
const inFlight = new Set<string>();
const removeInFlight = new Set<string>();

function ensureLibraryRepositoryDeps(): void {
  configureLibraryRepository({
    getDownloadItems: () => Object.values(useDownloadsStore.getState().itemsById),
    getTransfers: () => useDownloadsStore.getState().transferById,
    getFavoriteSourceKeys: () =>
      new Set(Object.keys(useFavoritesStore.getState().urlIndex)),
    getFavoriteMediaIds: () => getCachedFavoriteMediaIds(),
  });
}

/**
 * Targeted, idempotent completion hook.
 * Safe to call repeatedly for the same downloadId.
 */
export async function notifyLibraryDownloadCompleted(
  downloadId: string,
): Promise<void> {
  const id = downloadId.trim();
  if (!id || inFlight.has(id)) {
    return;
  }
  inFlight.add(id);

  try {
    ensureLibraryRepositoryDeps();
    invalidateLibraryAvailability(id);

    const availabilityById = await reconcileAvailability([id]);
    const availability = availabilityById[id];
    const store = useLibraryStore.getState();

    if (availability) {
      store.patchAvailability(id, availability);
    } else {
      // Local complete transfer is enough for offline Library visibility;
      // FS reconcile may race before the final path is readable.
      const transfer = useDownloadsStore.getState().transferById[id];
      if (transfer?.localState === 'complete') {
        store.patchAvailability(id, 'available');
      }
    }

    store.bumpSourceRevision();
    store.markReconciled(Date.now());

    libraryLog('library.completion_sync', {
      downloadId: id,
      availability: availability ?? 'unknown',
    });
  } catch {
    libraryLog(
      'library.completion_sync',
      { downloadId: id, reason: 'failed' },
      'warn',
    );
    // Still bump so a mounted Library reloads local records.
    try {
      useLibraryStore.getState().bumpSourceRevision();
    } catch {
      // ignore
    }
  } finally {
    inFlight.delete(id);
  }
}

/**
 * Targeted, idempotent removal hook.
 * Clears Library availability / source revision and local playback for mediaId.
 * Safe when the media is already gone.
 */
export async function notifyLibraryDownloadRemoved(
  downloadId: string,
): Promise<void> {
  const id = downloadId.trim();
  if (!id || removeInFlight.has(id)) {
    return;
  }
  removeInFlight.add(id);

  try {
    ensureLibraryRepositoryDeps();
    invalidateLibraryAvailability(id);

    const store = useLibraryStore.getState();
    store.patchAvailability(id, 'missing');
    store.bumpSourceRevision();
    store.markReconciled(Date.now());

    try {
      const { queryClient } = await import('@/services/query-client');
      invalidatePlaybackUiQueries(queryClient);
    } catch {
      // ignore
    }

    try {
      deletePlaybackState(PLAYBACK_LOCAL_NAMESPACE, id);
    } catch {
      // Local playback cleanup is best-effort.
    }

    libraryLog('library.removal_sync', { downloadId: id });
  } catch {
    libraryLog(
      'library.removal_sync',
      { downloadId: id, reason: 'failed' },
      'warn',
    );
    try {
      useLibraryStore.getState().bumpSourceRevision();
    } catch {
      // ignore
    }
  } finally {
    removeInFlight.delete(id);
  }
}

/**
 * One-time engine subscription. Call from app bootstrap alongside other bridges.
 */
export function ensureLibraryCompletionBridge(): void {
  if (bound) {
    return;
  }
  bound = true;
  ensureLibraryRepositoryDeps();

  downloadEngine.subscribe((event) => {
    if (event.type === 'completed') {
      void notifyLibraryDownloadCompleted(event.downloadId);
      return;
    }
    if (event.type === 'removed') {
      void notifyLibraryDownloadRemoved(event.downloadId);
    }
  });
}
