/**
 * P11 #686 Private Folder — the general rules, outside the Player, so the Library, the Player and later the File
 * Manager (Secure Vault #908) use the same ones. Pure; the app's side is `private-folder.runtime.ts`.
 *
 * It reuses Downloader H21's Private (`src/private-vault/*`, native `library/PrivateVault.kt`); it is not a second
 * vault and has no lock of its own:
 * - **In:** `moveToPrivate` (encrypt into the vault and verify, then delete the original through the app's delete,
 *   then forget it everywhere — `private-traces.ts`).
 * - **Out:** a copy to the Gallery first (the existing export), and only once that worked, the private copy is
 *   deleted. There is no native "back into the library" call, so a video moved out is a Gallery video (Movies/VidoraX):
 *   VidoraX lists it with the videos on this phone. Its play count and bookmarks don't come back (they were forgotten).
 * - **Is private:** the vault never keeps the library id a video had (H21's design), so "private" can be told only of
 *   a vault item's id, a vault playback file, or a library id moved in this run (`private-media-guard.ts`).
 * - **Open:** only through App Lock (`PrivateScreen` → `PrivatePinGate`, PIN or fingerprint), as before.
 */

import type { VaultExportResult } from '@/private-vault/vault-export';
import { isVaultId, vaultItemActions, type VaultItem, type VaultItemAction } from '@/private-vault/vault-index';
import { isVaultPlaybackUri } from '@/private-vault/vault-playback';

export { isMovedToPrivate } from './private-media-guard';

/** What a caller knows about a video it offers "Move to Private" for. */
export type PrivateMoveCandidate = {
  mediaId: string | null;
  /** A finished video in VidoraX's own library, kept by the native library (the vault reads it from there). */
  isLibraryVideo: boolean;
  /** `device:` ids: a video already on the phone (VidoraX can't delete it without Android's own request). */
  isDeviceVideo: boolean;
  /** A file another app opened (not in the library). */
  isExternalFile: boolean;
  isStream: boolean;
  /** A build with the native vault. */
  vaultAvailable: boolean;
};

/** Pure: whether "Move to Private" is offered — library videos only, on a build with the vault. */
export function canMoveMediaToPrivate(target: PrivateMoveCandidate): boolean {
  return (
    target.vaultAvailable &&
    target.mediaId != null &&
    target.mediaId.trim().length > 0 &&
    target.isLibraryVideo &&
    !target.isDeviceVideo &&
    !target.isExternalFile &&
    !target.isStream
  );
}

/** A vault item's id (the vault's own random id, never a library id). */
export function isPrivateFolderItemId(value: unknown): value is string {
  return isVaultId(value);
}

/** The decrypted temporary file of a private video being played (the only private file a player is ever given). */
export function isPrivatePlaybackUri(uri: string | null | undefined): boolean {
  return typeof uri === 'string' && isVaultPlaybackUri(uri);
}

export type PrivateFolderAction = VaultItemAction | 'move-out';

/** What can be done with an item in the Private Folder: H21's actions, plus Move out for an item that opens. */
export function privateFolderItemActions(item: Pick<VaultItem, 'unreadable'>): PrivateFolderAction[] {
  const actions: PrivateFolderAction[] = vaultItemActions(item);
  if (item.unreadable) {
    return actions;
  }
  // After Play and the two exports, before Delete.
  const deleteAt = actions.indexOf('delete');
  return deleteAt < 0 ? [...actions, 'move-out'] : [...actions.slice(0, deleteAt), 'move-out', ...actions.slice(deleteAt)];
}

export type MoveOutDeps = {
  /** The item as the vault lists it right now; null when it is gone. */
  findItem: (vaultId: string) => Promise<VaultItem | null>;
  /** The existing export to the Gallery (`exportVaultItem('gallery', …)`: its permission prompt included). */
  exportToGallery: (vaultId: string) => Promise<VaultExportResult>;
  /** Deletes the private copy (all of its files). */
  deleteFromVault: (vaultId: string) => Promise<void>;
};

export type MoveOutResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'not-found'
        /** Its key was lost: it can't be decrypted, only deleted. */
        | 'unreadable'
        /** Already being moved out. */
        | 'busy'
        | 'cancelled'
        | 'permission'
        | 'corrupt'
        | 'failed'
        /** The Gallery copy was made, but the private copy couldn't be deleted: it is in both places. */
        | 'still-in-private';
    };

const movingOut = new Set<string>();

export function isMovingOutOfPrivate(vaultId: string): boolean {
  return movingOut.has(vaultId);
}

/**
 * Move out of Private: the Gallery copy first; the private copy is deleted only after the copy was saved. Anything
 * that stops it before that leaves the private copy exactly as it was. Never rejects.
 */
export async function moveOutOfPrivate(vaultId: string, deps: MoveOutDeps): Promise<MoveOutResult> {
  if (!isVaultId(vaultId)) {
    return { ok: false, reason: 'not-found' };
  }
  if (movingOut.has(vaultId)) {
    return { ok: false, reason: 'busy' };
  }
  movingOut.add(vaultId);
  try {
    // Read right before acting: it may have been deleted meanwhile.
    const item = await deps.findItem(vaultId).catch(() => null);
    if (!item) {
      return { ok: false, reason: 'not-found' };
    }
    if (item.unreadable) {
      return { ok: false, reason: 'unreadable' };
    }
    let exported: VaultExportResult;
    try {
      exported = await deps.exportToGallery(vaultId);
    } catch {
      exported = { ok: false, reason: 'failed' };
    }
    if (!exported.ok) {
      return { ok: false, reason: exported.reason === 'folder-access' ? 'failed' : exported.reason };
    }
    try {
      await deps.deleteFromVault(vaultId);
    } catch {
      return { ok: false, reason: 'still-in-private' };
    }
    return { ok: true };
  } finally {
    movingOut.delete(vaultId);
  }
}
