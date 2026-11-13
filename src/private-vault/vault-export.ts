/**
 * Export from Private (#459): to the Gallery, or to a folder the user picks. The system screen an export may open —
 * the folder picker, or the storage permission prompt on Android 9 and older — runs inside `withExternalUi`, so the
 * section neither relocks nor deletes its playback file while that screen is in front. The export itself starts
 * only after the screen closes and is never cancelled by a lock: once started, it completes natively and reports.
 */

import { withExternalUi } from './external-ui';

export type VaultExportKind = 'gallery' | 'folder';

export type VaultExportDeps = {
  /** 'denied' stops the export; any other answer lets it run. */
  requestGalleryPermission: () => Promise<string>;
  /** The picked folder's tree URI, or null when the user backed out. */
  pickFolder: () => Promise<string | null>;
  exportToGallery: (vaultId: string) => Promise<unknown>;
  exportToFolder: (vaultId: string, treeUri: string) => Promise<unknown>;
};

export type VaultExportResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'permission' | 'corrupt' | 'folder-access' | 'failed' };

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
}

export async function exportVaultItem(
  kind: VaultExportKind,
  vaultId: string,
  deps: VaultExportDeps,
): Promise<VaultExportResult> {
  try {
    if (kind === 'gallery') {
      if ((await withExternalUi(deps.requestGalleryPermission)) === 'denied') {
        return { ok: false, reason: 'permission' };
      }
      await deps.exportToGallery(vaultId);
    } else {
      const folder = await withExternalUi(deps.pickFolder);
      if (!folder) {
        return { ok: false, reason: 'cancelled' };
      }
      await deps.exportToFolder(vaultId, folder);
    }
    return { ok: true };
  } catch (error) {
    const code = errorCode(error);
    return {
      ok: false,
      reason:
        code === 'ERR_VAULT_CORRUPT'
          ? 'corrupt'
          : code === 'ERR_STORAGE_PERMISSION'
            ? 'permission'
            : code === 'ERR_FOLDER_ACCESS'
              ? 'folder-access'
              : 'failed',
    };
  }
}
