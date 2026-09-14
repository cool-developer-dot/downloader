/**
 * Phase 7C — Delete from VidoraX (private canonical file + catalog only).
 *
 * Public MediaStore copies are never deleted.
 * File-first: physical delete success required before catalog removal.
 * Missing physical file → idempotent catalog cleanup.
 */

import * as Notifications from 'expo-notifications';

import { downloadEngine } from '@/downloads/engine/manager';
import {
  assertManagedDownloadPath,
  deleteDownloadFiles,
  getDownloadItemDirectory,
} from '@/downloads/engine/file-paths';
import { useDownloadsStore } from '@/store/downloads';
import { removeDownloadCatalogItem } from '@/storage/services/catalog-persist';

import { CompletedFileExportError } from '../export/errors';
import { clearExportReceipt } from '../export/receipt-store';
import { withCompletedFileOperation } from '../operation-lock';
import { resolveDeletePlan } from './plan';

export type DeleteCompletedFileResult =
  | { ok: true; kind: 'deleted' | 'reconciled_missing' }
  | { ok: false; error: CompletedFileExportError };

async function dismissTerminalNotifications(downloadId: string): Promise<void> {
  const ids = [
    `vidorax-dl-active-${downloadId}`,
    `vidorax-dl-completed-${downloadId}`,
    `vidorax-dl-failed-${downloadId}`,
  ];
  for (const identifier of ids) {
    try {
      await Notifications.dismissNotificationAsync(identifier);
    } catch {
      // non-fatal
    }
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    } catch {
      // non-fatal
    }
  }
  try {
    const { getDownloadNotificationService } = await import(
      '@/downloads/notifications/service'
    );
    await getDownloadNotificationService().dismissActive(downloadId);
  } catch {
    // non-fatal
  }
}

function dropFromDownloadsStore(id: string): void {
  useDownloadsStore.setState((state) => {
    if (!state.itemsById[id] && !state.transferById[id]) {
      return state;
    }
    const itemsById = { ...state.itemsById };
    delete itemsById[id];
    const mutatingIds = { ...state.mutatingIds };
    delete mutatingIds[id];
    const transferById = { ...state.transferById };
    delete transferById[id];
    return {
      itemsById,
      orderedIds: state.orderedIds.filter((itemId) => itemId !== id),
      total: Math.max(0, state.total - (state.itemsById[id] ? 1 : 0)),
      mutatingIds,
      transferById,
    };
  });
}

export async function deleteCompletedFileFromVidoraX(
  downloadId: string,
): Promise<DeleteCompletedFileResult> {
  const id = downloadId.trim();
  if (!id) {
    return {
      ok: false,
      error: new CompletedFileExportError('NOT_COMPLETED'),
    };
  }

  try {
    return await withCompletedFileOperation(id, 'deleting', async () => {
      const item = useDownloadsStore.getState().itemsById[id];
      const transfer = useDownloadsStore.getState().transferById[id];
      const status = item?.status ?? null;
      const physicalPresent =
        transfer?.localState === 'complete' && Boolean(transfer.localUri);

      const plan = resolveDeletePlan({
        downloadId: id,
        status,
        physicalFilePresent: physicalPresent,
      });

      if (plan.kind === 'reject') {
        throw new CompletedFileExportError(
          plan.reason === 'BUSY' ? 'DELETE_IN_PROGRESS' : 'NOT_COMPLETED',
        );
      }

      if (transfer?.localUri) {
        try {
          assertManagedDownloadPath(transfer.localUri, id);
        } catch {
          throw new CompletedFileExportError('INVALID_MANAGED_PATH');
        }
      }

      if (plan.physicalPresent) {
        await deleteDownloadFiles(id);
        const dir = getDownloadItemDirectory(id);
        if (dir.exists) {
          // Physical delete failed — keep catalog; user can retry.
          throw new CompletedFileExportError('DELETE_FILE_FAILED');
        }
      }

      // Engine cleanup (local record / workspaces). File dir already gone or absent.
      try {
        await downloadEngine.remove(id);
      } catch {
        // Local record cleanup is best-effort after successful file delete.
      }

      try {
        removeDownloadCatalogItem(id);
        dropFromDownloadsStore(id);
      } catch {
        // File gone but catalog stuck — recoverable on next delete (missing-file path).
        dropFromDownloadsStore(id);
        throw new CompletedFileExportError('DELETE_CATALOG_FAILED');
      }

      // Forget export receipt only (public MediaStore copy remains).
      clearExportReceipt(id);

      if (plan.dismissNotification) {
        await dismissTerminalNotifications(id);
      }

      return {
        ok: true as const,
        kind: plan.physicalPresent
          ? ('deleted' as const)
          : ('reconciled_missing' as const),
      };
    });
  } catch (error) {
    if (error instanceof CompletedFileExportError) {
      return { ok: false, error };
    }
    const message = error instanceof Error ? error.message : '';
    if (message === 'EXPORT_IN_PROGRESS') {
      return {
        ok: false,
        error: new CompletedFileExportError('EXPORT_IN_PROGRESS'),
      };
    }
    return {
      ok: false,
      error: new CompletedFileExportError('DELETE_FILE_FAILED'),
    };
  }
}
