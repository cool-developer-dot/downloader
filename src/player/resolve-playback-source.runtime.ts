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
import { useDownloadsStore } from '@/store/downloads';

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
    assessFile: assessLocalFile,
    assertManagedPath: assertManagedDownloadPath,
    verifyFile: (uri, expectedBytes, options) => {
      const file = new File(uri);
      return verifyCompletedFile(file, expectedBytes, options);
    },
    reconcileAvailability: (ids) => reconcileAvailability(ids),
    invalidateAvailability: invalidateLibraryAvailability,
    isCompletedStatus,
    isTempOrWorkspaceArtifact,
    normalizeMimeType,
    resolveDisplayName,
    getDisplayTitle: (mediaId) => {
      const item = useDownloadsStore.getState().itemsById[mediaId];
      const title = item?.title?.trim();
      return title || null;
    },
    getMimeType: (mediaId) => {
      const item = useDownloadsStore.getState().itemsById[mediaId];
      const mime = item?.mimeType?.trim();
      return mime || null;
    },
    resolveFileUri: (uri) => {
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
