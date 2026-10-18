import { getV2Engine, isEngineOwned } from '@/downloads/v2';
import {
  deletePlaybackState,
  invalidatePlaybackUiQueries,
  PLAYBACK_LOCAL_NAMESPACE,
} from '@/playback';
import { useAppLockStore } from '@/security/app-lock';
import { queryClient } from '@/services/query-client';
import { useDownloadsStore } from '@/store/downloads';

import { hideHistoryPlan } from './hide-history';
import { moveToPrivate, type MoveSource, type MoveToPrivateResult } from './move-to-private';
import { getVaultPort } from './vault-port';

/** The library item as it is right now (for the confirm and for the re-check before acting). */
export async function privateMoveSource(id: string): Promise<MoveSource | null> {
  const engine = getV2Engine();
  const item = engine ? await engine.getLibraryItem(id) : null;
  return item ? { id: item.id, title: item.title, sizeBytes: item.sizeBytes, galleryUri: item.galleryUri } : null;
}

/** Only library items the v2 engine owns can move: the vault reads them from the library. */
export function canMoveToPrivate(id: string): boolean {
  return Boolean(id) && getVaultPort() !== null && isEngineOwned(useDownloadsStore.getState(), id);
}

/** Watch History, Continue Watching and resume read the stored position: it goes with the original. */
function forgetHistory(id: string): void {
  const plan = hideHistoryPlan(id, [PLAYBACK_LOCAL_NAMESPACE]);
  for (const key of plan.playback) {
    deletePlaybackState(key.namespace, key.mediaId);
  }
  if (plan.refreshPlaybackLists) {
    invalidatePlaybackUiQueries(queryClient);
  }
}

/** Move to Private with the app's real stores, the native vault and the existing delete path. */
export async function moveLibraryItemToPrivate(id: string): Promise<MoveToPrivateResult> {
  const port = getVaultPort();
  if (!port) {
    return { ok: false, reason: 'encrypt-failed' };
  }
  return moveToPrivate(id, {
    appLockEnabled: () => useAppLockStore.getState().isEnabled,
    getItem: privateMoveSource,
    isBusy: (itemId) => useDownloadsStore.getState().mutatingIds[itemId] === true,
    encrypt: (itemId) => port.moveToVault(itemId),
    deleteOriginal: async (itemId) => {
      const { deleteCompletedFileFromVidoraX } = await import('@/downloads/completed-file/delete/delete-service');
      return deleteCompletedFileFromVidoraX(itemId);
    },
    removeFromVault: (vaultId) => port.deleteVaultItem(vaultId),
    forgetHistory,
  });
}
