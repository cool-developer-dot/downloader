/**
 * Production wiring for playback source resolution (native FS + library).
 * Imported by the player session — not by Node verify scripts.
 */

import { File } from 'expo-file-system';

import {
  invalidateLibraryAvailability,
  isCompletedStatus,
  isTempOrWorkspaceArtifact,
  normalizeMimeType,
  reconcileAvailability,
  resolveDisplayName,
} from '@/library';
import {
  assertManagedDownloadPath,
  verifyCompletedFile,
} from '@/downloads/engine/file-paths';
import { assessLocalFile } from '@/downloads/engine/local-file-state';
import { getLocalRecord } from '@/downloads/engine/persistence';
import {
  ensureV2LibraryItem,
  isV2LibraryFileUri,
  reconcileV2LibraryIds,
  v2LibraryPlaybackRecord,
  verifyV2LibraryFile,
} from '@/downloads/v2';
import { useDownloadsStore } from '@/store/downloads';

import { isDeviceMediaId, knownDeviceVideo } from './device-media';

import {
  configureResolvePlaybackSourceDeps,
  type ResolvePlaybackSourceDeps,
} from './resolve-playback-source';

let bound = false;

export function ensurePlaybackSourceRuntime(): void {
  if (bound) {
    return;
  }
  const deps: ResolvePlaybackSourceDeps = {
    getLocalRecord: async (mediaId) => {
      // A video that was already on the device plays straight from its MediaStore URI.
      if (isDeviceMediaId(mediaId)) {
        const video = knownDeviceVideo(mediaId);
        return video
          ? {
              downloadId: mediaId,
              fileName: video.title,
              localUri: video.uri,
              localState: 'complete' as const,
              remoteStatus: 'COMPLETED' as const,
              totalBytes: video.sizeBytes,
              expectedFileSize: String(video.sizeBytes),
            }
          : null;
      }
      // A completed v2 download plays from the library file its engine verified and finalized. The whole library
      // loads a moment after launch; a Player opened before that reads this one item first.
      await ensureV2LibraryItem(mediaId);
      const engineRecord = v2LibraryPlaybackRecord(mediaId);
      if (engineRecord) {
        return engineRecord;
      }
      const record = await getLocalRecord(mediaId);
      if (!record) {
        return null;
      }
      return {
        downloadId: record.downloadId,
        fileName: record.fileName,
        localUri: record.localUri,
        localState: record.localState,
        remoteStatus: record.remoteStatus,
        totalBytes: record.totalBytes,
        expectedFileSize: record.expectedFileSize,
      };
    },
    assessFile: (input) => {
      // A `content://` video belongs to the system, not to VidoraX: MediaStore listing it is the check.
      if (typeof input.localUri === 'string' && input.localUri.startsWith('content://')) {
        return {
          presence: 'complete' as const,
          localUri: input.localUri,
          size: input.expectedBytes ?? 0,
          hasRangePart: false,
        };
      }
      if (!isV2LibraryFileUri(input.localUri)) {
        return assessLocalFile(input);
      }
      const verified = verifyV2LibraryFile(input.localUri as string);
      return {
        presence: verified.ok ? 'complete' : verified.reason === 'missing' ? 'missing' : 'invalid',
        localUri: input.localUri ?? null,
        size: verified.ok ? verified.size : 0,
        hasRangePart: false,
      };
    },
    // v1's managed path is its own downloads folder; a v2 library file is guarded by its own root check.
    assertManagedPath: (uri, mediaId) => {
      if (isV2LibraryFileUri(uri) || (typeof uri === 'string' && uri.startsWith('content://'))) {
        return;
      }
      assertManagedDownloadPath(uri, mediaId);
    },
    verifyFile: (uri, expectedBytes, options) => {
      if (typeof uri === 'string' && uri.startsWith('content://')) {
        return { ok: true as const, size: expectedBytes ?? 0 };
      }
      if (isV2LibraryFileUri(uri)) {
        return verifyV2LibraryFile(uri);
      }
      const file = new File(uri);
      return verifyCompletedFile(file, expectedBytes, options);
    },
    // The file is gone: repair both libraries — the v1 availability cache and the engine's own row, so the item
    // disappears from Player instead of staying there looking playable.
    reconcileAvailability: (ids) => Promise.all([reconcileAvailability(ids), reconcileV2LibraryIds(ids)]),
    invalidateAvailability: invalidateLibraryAvailability,
    isCompletedStatus,
    isTempOrWorkspaceArtifact,
    normalizeMimeType,
    resolveDisplayName,
    getDisplayTitle: (mediaId) => {
      const device = isDeviceMediaId(mediaId) ? knownDeviceVideo(mediaId) : null;
      if (device) {
        return device.title;
      }
      const state = useDownloadsStore.getState();
      const item = state.itemsById[mediaId] ?? state.engineRowsById[mediaId];
      const title = item?.title?.trim();
      return title || null;
    },
    getMimeType: (mediaId) => {
      const device = isDeviceMediaId(mediaId) ? knownDeviceVideo(mediaId) : null;
      if (device?.mimeType) {
        return device.mimeType;
      }
      const state = useDownloadsStore.getState();
      const item = state.itemsById[mediaId] ?? state.engineRowsById[mediaId];
      const mime = item?.mimeType?.trim();
      return mime || null;
    },
    resolveFileUri: (uri) => {
      if (typeof uri === 'string' && uri.startsWith('content://')) {
        return uri;
      }
      try {
        return new File(uri).uri || uri;
      } catch {
        return uri;
      }
    },
  };
  configureResolvePlaybackSourceDeps(deps);
  bound = true;
}

/** Test helper. */
export function resetPlaybackSourceRuntimeBinding(): void {
  bound = false;
}
