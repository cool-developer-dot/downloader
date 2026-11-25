/**
 * Files F1: a number that changes whenever what the Files screens show may have changed — a download finished or was
 * removed, a folder was made, renamed or deleted, a file moved to another folder. The screens reload then, so a list
 * never shows a deleted folder or misses a new file. Part of the F12 stand-in: it watches the same stores
 * `files-source.ts` reads.
 */

import { useMemo } from 'react';

import {
  selectDownloadCatalogIdentityRevision,
  selectLibraryTransferRevision,
  useDownloadsStore,
} from '@/store/downloads';
import { useLibraryStore } from '@/store/library';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import { useFoldersStore } from '@/store/organization/folders';

const identities = new WeakMap<object, number>();
let nextIdentity = 1;

/** A stable number for an object's identity (a store slice is replaced on every change). */
function identityOf(value: object): number {
  let id = identities.get(value);
  if (id === undefined) {
    id = nextIdentity;
    nextIdentity += 1;
    identities.set(value, id);
  }
  return id;
}

export function useFilesRevision(): string {
  const catalog = useDownloadsStore(selectDownloadCatalogIdentityRevision);
  const transfers = useDownloadsStore(selectLibraryTransferRevision);
  const library = useLibraryStore((state) => state.sourceRevision);
  const folders = useFoldersStore((state) => state.itemsById);
  const assignments = useMediaFolderAssignmentsStore((state) => state.folderIdByMediaId);
  return useMemo(
    () => [catalog, transfers, library, identityOf(folders), identityOf(assignments)].join(':'),
    [assignments, catalog, folders, library, transfers],
  );
}
