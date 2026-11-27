/**
 * F15: "SD card" and "Folders I added" (designs 26 and 27). Folders come only from Android's folder picker (no
 * permission; Play allows it). Read-only: browse, play, share, import into VidoraX. Nothing is renamed or deleted in
 * them — changing other apps' files is the device-wide file manager VidoraX does not build.
 */
import { persist } from 'zustand/middleware';

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import type { DeviceVideo, FolderDocument } from '@modules/vidorax-media/src/VidoraMedia.types';

import { getSaveLocationSettings } from '@/downloads/v2/save-location-store';
import { getTreeExportPort, pickTreeFolder } from '@/downloads/v2/tree-export-port';
import { rememberDeviceVideos, deviceMediaId } from '@/player/device-media';
import { mmkvKeys } from '@/storage/constants';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import { fileTypeOf, type FileType } from '../engine/file-types';
import {
  labelOfTree,
  normalizeAddedFolders,
  pickedFileId,
  viewAddedFolders,
  type AddedFolder,
  type AddedFolderView,
} from './folder-access-model';

export type { AddedFolderView } from './folder-access-model';
export type PickedDocument = FolderDocument & { fileType: FileType | null };

type FolderAccessPort = {
  listGrantedFolders(): string[];
  listFolderDocuments(treeUri: string, parentDocumentId: string | null): Promise<FolderDocument[]>;
  importFromFolder(treeUri: string): Promise<{ found: number; imported: number; duplicates: number; failed: number }>;
};

function port(): FolderAccessPort | null {
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<FolderAccessPort>;
  return typeof media.listGrantedFolders === 'function' && typeof media.listFolderDocuments === 'function'
    ? (media as FolderAccessPort)
    : null;
}

/** Whether this build can show added folders (the native calls exist). */
export function folderAccessAvailable(): boolean {
  return port() != null;
}

type AddedFoldersState = { folders: AddedFolder[] };

export const useAddedFoldersStore = createStore<AddedFoldersState>()(
  persist((): AddedFoldersState => ({ folders: [] }), {
    name: mmkvKeys.filesAddedFolders,
    storage: createPersistStorage<AddedFoldersState>(),
    merge: (persisted, current) => ({
      ...current,
      folders: normalizeAddedFolders((persisted as Partial<AddedFoldersState> | null)?.folders),
    }),
  }),
);

/** The added folders with `removable` (SD card chip) and `accessible` (grant still held). */
export function listAddedFolders(): AddedFolderView[] {
  let granted: string[] | null = null;
  try {
    granted = port()?.listGrantedFolders() ?? null;
  } catch {
    granted = null;
  }
  return viewAddedFolders(useAddedFoldersStore.getState().folders, granted);
}

/** Opens Android's folder picker and adds the folder. Resolves with it, or null when the user backed out. */
export async function addFolder(): Promise<AddedFolder | null> {
  const treeUri = await pickTreeFolder();
  if (!treeUri) {
    return null;
  }
  const exportPort = getTreeExportPort();
  const label = (await exportPort?.getFolderName(treeUri).catch(() => null)) || labelOfTree(treeUri);
  const folder: AddedFolder = { treeUri, label, addedAt: Date.now() };
  useAddedFoldersStore.setState((state) => ({
    folders: normalizeAddedFolders([...state.folders.filter((f) => f.treeUri !== treeUri), folder]),
  }));
  return folder;
}

/**
 * Takes a folder off the list. Its grant is released too, unless Save Location still copies downloads into it (that
 * feature holds the same grant).
 */
export async function removeFolder(treeUri: string): Promise<void> {
  useAddedFoldersStore.setState((state) => ({ folders: state.folders.filter((f) => f.treeUri !== treeUri) }));
  const saveTree = getSaveLocationSettings().treeUri?.replace(/\/+$/, '') ?? null;
  if (saveTree !== treeUri.replace(/\/+$/, '')) {
    await getTreeExportPort()?.releaseFolderAccess(treeUri).catch(() => undefined);
  }
}

/** One folder's children (`parentDocumentId` null = the added folder itself): folders first, then files by name. */
export async function listPicked(treeUri: string, parentDocumentId: string | null): Promise<PickedDocument[]> {
  const access = port();
  if (!access) {
    return [];
  }
  const docs = await access.listFolderDocuments(treeUri, parentDocumentId);
  return docs.map((doc) => ({ ...doc, fileType: doc.isDirectory ? null : fileTypeOf(doc.mimeType, doc.name) }));
}

/**
 * The Player's media id for a picked video or audio file. It plays in place from its content URI (the same path as
 * "Videos on this device"); nothing is copied.
 */
export function playableIdOf(doc: PickedDocument): string | null {
  if (doc.isDirectory || (doc.fileType !== 'video' && doc.fileType !== 'audio')) {
    return null;
  }
  const video: DeviceVideo = {
    id: pickedFileId(doc.uri),
    uri: doc.uri,
    title: doc.name,
    durationMs: null,
    sizeBytes: doc.sizeBytes ?? 0,
    width: null,
    height: null,
    addedAt: doc.modifiedAt ?? 0,
    mimeType: doc.mimeType,
  };
  rememberDeviceVideos([video]);
  return deviceMediaId(video);
}

/** Copies the folder's videos into VidoraX (the existing folder import; already saved ones are skipped). */
export async function importFolder(treeUri: string): Promise<{ imported: number; duplicates: number; failed: number } | null> {
  const access = port();
  if (!access || typeof access.importFromFolder !== 'function') {
    return null;
  }
  const summary = await access.importFromFolder(treeUri);
  return { imported: summary.imported, duplicates: summary.duplicates, failed: summary.failed };
}
