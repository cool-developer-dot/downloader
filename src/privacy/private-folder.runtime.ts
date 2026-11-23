/**
 * P11 #686 Private Folder — the one service the Library, the Player and later the File Manager (#908) call. It wraps
 * H21's Private (native `library/PrivateVault.kt` through `src/private-vault/*`); the rules are in `private-folder.ts`.
 *
 * Callers show what `list` returns only behind App Lock (`PrivateScreen` asks for the PIN every time it opens).
 */

import { ensureGalleryPermission } from '@/downloads/v2/gallery-permission';
import { canMoveToPrivate, moveLibraryItemToPrivate } from '@/private-vault/move-to-private.runtime';
import type { MoveToPrivateResult } from '@/private-vault/move-to-private';
import { exportVaultItem } from '@/private-vault/vault-export';
import { findVaultItem, vaultIndexFrom, type VaultItem } from '@/private-vault/vault-index';
import { getVaultPort, pickExportFolder } from '@/private-vault/vault-port';

import {
  isMovedToPrivate,
  isPrivateFolderItemId,
  isPrivatePlaybackUri,
  moveOutOfPrivate,
  type MoveOutResult,
} from './private-folder';

/** A build with the native vault. */
export function isPrivateFolderAvailable(): boolean {
  return getVaultPort() !== null;
}

/** Whether this library id can move now (a library video the native library keeps, on a build with the vault). */
export function canMoveToPrivateFolder(mediaId: string | null | undefined): boolean {
  return typeof mediaId === 'string' && canMoveToPrivate(mediaId);
}

/** Move in: H21's move (encrypt, verify, delete the original, forget it everywhere). */
export function moveToPrivateFolder(mediaId: string): Promise<MoveToPrivateResult> {
  return moveLibraryItemToPrivate(mediaId);
}

/** The Private Folder's videos, newest moved first. Rejects when the vault can't be read. */
export async function listPrivateFolder(): Promise<VaultItem[]> {
  const port = getVaultPort();
  if (!port) {
    return [];
  }
  return vaultIndexFrom(await port.listVault());
}

/**
 * Move out: to the Gallery (Movies/VidoraX), then out of Private. `known` is the list the caller shows, read for the
 * item right before acting; without it the vault is listed again.
 */
export async function moveOutOfPrivateFolder(vaultId: string, known?: readonly VaultItem[]): Promise<MoveOutResult> {
  const port = getVaultPort();
  if (!port) {
    return { ok: false, reason: 'failed' };
  }
  return moveOutOfPrivate(vaultId, {
    findItem: async (id) => (known ? findVaultItem(known, id) : findVaultItem(await listPrivateFolder(), id)),
    exportToGallery: (id) =>
      exportVaultItem('gallery', id, {
        requestGalleryPermission: ensureGalleryPermission,
        pickFolder: pickExportFolder,
        exportToGallery: (itemId) => port.exportVaultItemToGallery(itemId),
        exportToFolder: (itemId, treeUri) => port.exportVaultItemToFolder(itemId, treeUri),
      }),
    deleteFromVault: (id) => port.deleteVaultItem(id),
  });
}

export { isMovedToPrivate, isPrivateFolderItemId, isPrivatePlaybackUri };
