/**
 * Phase 7C — save completed private file to device (copy/publish).
 *
 * downloadId → 7A descriptor → managed path → native MediaStore/SAF stream.
 * Never moves/deletes the private canonical file.
 * Export failure leaves Phase 1 COMPLETED untouched.
 */

import { Platform } from 'react-native';
import { File } from 'expo-file-system';

import { downloadEngine } from '@/downloads/engine/manager';
import { getV2Engine, isEngineOwned } from '@/downloads/v2';
import {
  assertManagedDownloadPath,
  verifyCompletedFile,
} from '@/downloads/engine/file-paths';
import { useDownloadsStore } from '@/store/downloads';

import {
  resolveCompletedActions,
  resolveLegacyCompletedDescriptor,
} from '../index';
import { withCompletedFileOperation } from '../operation-lock';
import { resolveExportDestination, resolveExportCapability } from './destination';
import {
  CompletedFileExportError,
  isBenignExportCancellation,
} from './errors';
import {
  nativeDeletePendingMediaStoreUri,
  nativeExportManagedFile,
  nativeMediaStoreUriExists,
  isAndroidMediaExportNativeAvailable,
} from './native-media-export';
import {
  buildMediaStoreMetadata,
  resolvePublicExportName,
} from './public-name';
import {
  beginExportTransaction,
  completeExportTransaction,
  failExportTransaction,
  qualifyExistingExportReceipt,
  reconcilePendingExport,
} from './receipt';
import {
  clearExportReceipt,
  getExportReceipt,
  listPendingExportReceipts,
  patchExportReceipt,
  setExportReceipt,
} from './receipt-store';

export type SaveToDeviceResult =
  | { ok: true; kind: 'saved' | 'already_saved'; displayName: string; contentUri: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: CompletedFileExportError };

function fileUriToAbsolutePath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

export async function saveCompletedFileToDevice(
  downloadId: string,
): Promise<SaveToDeviceResult> {
  const id = downloadId.trim();
  if (!id) {
    return {
      ok: false,
      error: new CompletedFileExportError('NOT_COMPLETED'),
    };
  }

  if (Platform.OS !== 'android') {
    return {
      ok: false,
      error: new CompletedFileExportError('UNSUPPORTED_EXPORT_DESTINATION'),
    };
  }

  if (isEngineOwned(useDownloadsStore.getState(), id)) {
    // The v2 module copies its own library file into the gallery and records the resulting content URI.
    const engine = getV2Engine();
    if (!engine) {
      return { ok: false, error: new CompletedFileExportError('UNSUPPORTED_EXPORT_DESTINATION') };
    }
    try {
      await engine.saveToGallery([id]);
      const item = await engine.getLibraryItem(id);
      return {
        ok: true,
        kind: 'saved',
        displayName: item?.fileName ?? useDownloadsStore.getState().engineRowsById[id]?.title ?? '',
        contentUri: item?.galleryUri ?? '',
      };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      return {
        ok: false,
        error: new CompletedFileExportError(
          code === 'ERR_STORAGE_PERMISSION' ? 'LEGACY_EXPORT_FAILED' : 'MEDIASTORE_INSERT_FAILED',
        ),
      };
    }
  }

  try {
    return await withCompletedFileOperation(id, 'exporting', async () => {
      const item = useDownloadsStore.getState().itemsById[id];
      if (!item || item.status !== 'COMPLETED') {
        throw new CompletedFileExportError('NOT_COMPLETED');
      }

      const refreshed = await downloadEngine.refreshCompletedLocalFile(id);
      if (!refreshed.usable || !refreshed.localUri) {
        throw new CompletedFileExportError('FILE_MISSING');
      }
      assertManagedDownloadPath(refreshed.localUri, id);
      const file = new File(refreshed.localUri);
      const verified = verifyCompletedFile(file, null, { downloadId: id });
      if (!verified.ok) {
        throw new CompletedFileExportError('FILE_MISSING');
      }

      if (!resolveExportCapability({ status: 'COMPLETED', physicalFilePresent: true })) {
        throw new CompletedFileExportError('NOT_COMPLETED');
      }

      if (!isAndroidMediaExportNativeAvailable()) {
        throw new CompletedFileExportError('NATIVE_UNAVAILABLE');
      }

      const descriptor =
        resolveLegacyCompletedDescriptor({
          downloadId: id,
          status: 'COMPLETED',
          fileName: item.fileName,
          canonicalPath: refreshed.localUri,
          displayTitle: item.title,
          platform: item.platform,
          sourceUrl: null,
          qualityLabel: item.quality,
          thumbnailUri: item.thumbnailUrl,
          completedAt: item.downloadedAt,
          fileSizeBytes: item.fileSize,
          physicalFilePresent: true,
          evidence: {
            verifiedMimeType: item.mimeType,
            containerHint: item.container,
          },
          preserveExistingBaseName: true,
          validationSucceeded: true,
        }) ?? null;

      const mimeType = descriptor?.mimeType ?? item.mimeType ?? null;
      const fileName = descriptor?.fileName ?? item.fileName;
      const displayTitle = descriptor?.displayTitle ?? item.title;
      const destination = resolveExportDestination({
        mimeType,
        fileName,
        container: descriptor?.container ?? item.container,
      });
      const publicName = resolvePublicExportName({
        fileName,
        displayTitle,
        mimeType,
      });
      const metadata = buildMediaStoreMetadata({
        displayName: publicName,
        mimeType: destination.mimeType,
        relativePath: destination.relativePath,
        sizeBytes: (() => {
          const raw = descriptor?.fileSize ?? item.fileSize;
          if (typeof raw === 'number' && Number.isFinite(raw)) {
            return raw;
          }
          if (typeof raw === 'string') {
            const n = Number(raw);
            return Number.isFinite(n) ? n : null;
          }
          return null;
        })(),
        completedAt: descriptor?.completedAt ?? item.downloadedAt,
      });

      // Duplicate policy: if receipt exists and public URI still present → already saved.
      const existing = getExportReceipt(id);
      const qualified = qualifyExistingExportReceipt(existing);
      if (qualified.kind === 'published' && existing.exportedContentUri) {
        const stillThere = await nativeMediaStoreUriExists(
          existing.exportedContentUri,
        );
        if (stillThere) {
          return {
            ok: true as const,
            kind: 'already_saved' as const,
            displayName: existing.exportedDisplayName ?? publicName,
            contentUri: existing.exportedContentUri,
          };
        }
        // Stale — clear published fields, allow fresh export.
        patchExportReceipt(id, {
          exportedContentUri: null,
          exportedDisplayName: null,
          exportedAt: null,
        });
      }

      // Soft pending marker for process-death reconciliation (non-secret).
      const startedAt = new Date().toISOString();
      patchExportReceipt(
        id,
        beginExportTransaction(`pending:${id}`, startedAt),
      );

      const absolutePath = fileUriToAbsolutePath(refreshed.localUri);

      let result;
      try {
        result = await nativeExportManagedFile({
          absolutePath,
          downloadId: id,
          displayName: metadata.displayName,
          mimeType: metadata.mimeType,
          collection: destination.collection,
          relativePath: metadata.relativePath,
        });
      } catch (error) {
        patchExportReceipt(id, failExportTransaction());
        if (error instanceof CompletedFileExportError) {
          if (isBenignExportCancellation(error.code)) {
            return { ok: false as const, cancelled: true as const };
          }
          throw error;
        }
        throw new CompletedFileExportError('COPY_IO_FAILED');
      }

      // Persist published receipt (pending cleared). For MediaStore, native already published.
      const receipt = completeExportTransaction({
        contentUri: result.contentUri,
        displayName: result.displayName || metadata.displayName,
        exportedAt: new Date().toISOString(),
      });
      setExportReceipt(id, receipt);

      // Private file remains; Phase 1 state untouched.
      return {
        ok: true as const,
        kind: 'saved' as const,
        displayName: receipt.exportedDisplayName ?? metadata.displayName,
        contentUri: receipt.exportedContentUri!,
      };
    });
  } catch (error) {
    if (error instanceof CompletedFileExportError) {
      return { ok: false, error };
    }
    const message = error instanceof Error ? error.message : '';
    if (message === 'DELETE_IN_PROGRESS' || message === 'EXPORT_IN_PROGRESS') {
      return {
        ok: false,
        error: new CompletedFileExportError(
          message === 'DELETE_IN_PROGRESS' ? 'DELETE_IN_PROGRESS' : 'EXPORT_IN_PROGRESS',
        ),
      };
    }
    return { ok: false, error: new CompletedFileExportError('COPY_IO_FAILED') };
  }
}

/**
 * Startup / bounded reconciliation of incomplete pending exports.
 * Never deletes a fully published public MediaStore item.
 */
export async function reconcilePendingExports(): Promise<void> {
  if (Platform.OS !== 'android' || !isAndroidMediaExportNativeAvailable()) {
    return;
  }
  const pending = listPendingExportReceipts();
  for (const { downloadId, receipt } of pending) {
    const pendingUri = receipt.pendingExportUri?.trim() ?? '';
    const isSynthetic = pendingUri.startsWith('pending:');
    const decision = reconcilePendingExport({
      pendingUri: receipt.pendingExportUri,
      publishedUri: receipt.exportedContentUri,
      pendingStillIncomplete: isSynthetic ? false : true,
    });
    if (
      decision.shouldDeletePendingRow &&
      receipt.pendingExportUri &&
      !isSynthetic
    ) {
      await nativeDeletePendingMediaStoreUri(receipt.pendingExportUri);
    }
    if (decision.clearPendingMarker) {
      patchExportReceipt(downloadId, failExportTransaction());
    }
  }
}

export function resolveExportActionsForId(downloadId: string): {
  canExport: boolean;
  alreadySaved: boolean;
} {
  const item = useDownloadsStore.getState().itemsById[downloadId];
  const transfer = useDownloadsStore.getState().transferById[downloadId];
  const present =
    item?.status === 'COMPLETED' && transfer?.localState === 'complete';
  const actions = resolveCompletedActions({
    status: item?.status,
    physicalFilePresent: present,
    allowExport: true,
    allowExternalHandoff: true,
  });
  const receipt = getExportReceipt(downloadId);
  const q = qualifyExistingExportReceipt(receipt);
  return {
    canExport: actions.canExport,
    alreadySaved: q.kind === 'published',
  };
}

/** Test/export surface — do not clear published URI on private delete (ownership). */
export function forgetExportReceiptAfterPrivateDelete(downloadId: string): void {
  clearExportReceipt(downloadId);
}
