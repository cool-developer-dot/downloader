/**
 * Move to Private (#459). The order is what keeps a video safe:
 *
 * 1. The video is encrypted into the vault and the encrypted copy verified (native). If that fails, nothing else
 *    happens: the original stays exactly as it was.
 * 2. Only then is the original removed from VidoraX through the app's existing delete path.
 * 3. Then its stored playback position is forgotten, so it shows in no history.
 *
 * Should the delete fail, the item is never left in both places nor lost: when the original is known to still be
 * there, the vault copy is taken back out; when it is known to be gone, the move counts as done; when that cannot be
 * told, the vault copy is kept (a copy too many is better than none). Everything is injected, so this is tested.
 */

import { normalizeVaultItem, type VaultItem } from './vault-index';

export type MoveSource = { id: string; title: string; sizeBytes: number; galleryUri: string | null };

export type MoveToPrivateDeps = {
  appLockEnabled: () => boolean;
  /** The library item as it is right now; null when it no longer exists. */
  getItem: (id: string) => Promise<MoveSource | null>;
  /** True while another action (an export, a delete, a rename) holds the item. */
  isBusy: (id: string) => boolean;
  /** Native: encrypt into the vault and verify; resolves with the vault item. Never touches the original. */
  encrypt: (id: string) => Promise<unknown>;
  /** The app's existing delete path for a completed item. */
  deleteOriginal: (id: string) => Promise<{ ok: boolean }>;
  removeFromVault: (vaultId: string) => Promise<void>;
  forgetHistory: (id: string) => void;
};

export type MoveToPrivateResult =
  | { ok: true; item: VaultItem }
  | {
      ok: false;
      reason: 'app-lock-off' | 'busy' | 'not-found' | 'encrypt-failed' | 'original-not-removed';
      /** True when a copy stayed in the vault although the original may still be in VidoraX. */
      keptInVault?: boolean;
    };

const moving = new Set<string>();

/** True while `id` is being moved (a second tap waits for the first). */
export function isMovingToPrivate(id: string): boolean {
  return moving.has(id);
}

export async function moveToPrivate(id: string, deps: MoveToPrivateDeps): Promise<MoveToPrivateResult> {
  if (!deps.appLockEnabled()) {
    return { ok: false, reason: 'app-lock-off' };
  }
  if (!id || moving.has(id) || deps.isBusy(id)) {
    return { ok: false, reason: 'busy' };
  }
  moving.add(id);
  try {
    // Re-checked right before acting: the item may have been deleted since the menu was opened.
    const source = await deps.getItem(id).catch(() => null);
    if (!source) {
      return { ok: false, reason: 'not-found' };
    }
    let item: VaultItem | null;
    try {
      item = normalizeVaultItem(await deps.encrypt(id));
    } catch {
      return { ok: false, reason: 'encrypt-failed' };
    }
    if (!item) {
      return { ok: false, reason: 'encrypt-failed' };
    }
    if (!deps.appLockEnabled()) {
      // App Lock was turned off meanwhile: nothing private may exist without it.
      await deps.removeFromVault(item.id).catch(() => undefined);
      return { ok: false, reason: 'app-lock-off' };
    }
    let removed = false;
    try {
      removed = (await deps.deleteOriginal(id)).ok;
    } catch {
      removed = false;
    }
    if (!removed) {
      let stillThere: boolean | null;
      try {
        stillThere = (await deps.getItem(id)) !== null;
      } catch {
        stillThere = null;
      }
      if (stillThere === true) {
        await deps.removeFromVault(item.id).catch(() => undefined);
        return { ok: false, reason: 'original-not-removed' };
      }
      if (stillThere === null) {
        return { ok: false, reason: 'original-not-removed', keptInVault: true };
      }
    }
    try {
      deps.forgetHistory(id);
    } catch {
      // The video is in the vault either way.
    }
    return { ok: true, item };
  } finally {
    moving.delete(id);
  }
}
