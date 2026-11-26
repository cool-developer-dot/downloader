/**
 * Files F1: the data behind the Files screens, read only through `files-source.ts` (the F12 door). Each hook loads
 * when its screen comes into focus and again whenever the files may have changed (`useFilesRevision`); pull to refresh
 * runs `rescanLibrary()` first. A late answer never overwrites a newer one.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  folderPath,
  folderStats,
  listFolder,
  rescanLibrary,
  storageSpace,
  typeCounts,
  type FileEntry,
  type FolderEntry,
  type FolderListing,
  type FolderStats,
  type StorageSpace,
  type TypeCounts,
} from '@/files/ui/files-source';
import { nearestExistingFolder } from '@/files/ui/folder-tree';
import { typeCountsOf } from '@/files/ui/files-index';
import { hiddenFolderIds, useLockedNowIds, withoutLockedFiles } from '@/files/ui/locked-folders';
import { useFilesRevision } from '@/files/ui/use-files-revision';

import { videoTileCount } from '../utils/type-tiles';

export type LoadStatus = 'loading' | 'ready' | 'error';

/** Runs `load` on focus and on every files change; `refresh` rescans first. */
function useReloading<T>(load: () => Promise<T>, initial: T) {
  const revision = useFilesRevision();
  const [data, setData] = useState<T>(initial);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const tokenRef = useRef(0);
  const liveRef = useRef(true);
  /** The files revision the last load started at (a change while in front loads again). */
  const loadedRevisionRef = useRef<string | null>(null);

  const run = useCallback(async () => {
    loadedRevisionRef.current = revision;
    const token = ++tokenRef.current;
    try {
      const next = await load();
      if (liveRef.current && token === tokenRef.current) {
        setData(next);
        setStatus('ready');
      }
    } catch {
      if (liveRef.current && token === tokenRef.current) {
        setStatus('error');
      }
    }
  }, [load, revision]);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  // On focus, and again whenever the files change while the screen is in front.
  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await rescanLibrary();
    } catch {
      // The reload below still shows what is known.
    }
    await run();
    if (liveRef.current) {
      setRefreshing(false);
    }
  }, [run]);

  return { data, status, refreshing, refresh, reload: run };
}

async function statsFor(folders: readonly FolderEntry[]): Promise<Record<string, FolderStats>> {
  const entries = await Promise.all(folders.map(async (folder) => [folder.id, await folderStats(folder.id)] as const));
  return Object.fromEntries(entries);
}

export type FilesHome = {
  listing: FolderListing | null;
  statsById: Record<string, FolderStats>;
  counts: TypeCounts | null;
  /** #753: the Videos tile's count, by the Player tab's own rule (`videoTileCount`). */
  videoCount: number;
  space: StorageSpace | null;
};

const EMPTY_HOME: FilesHome = { listing: null, statsById: {}, counts: null, videoCount: 0, space: null };

/**
 * The Files tab: the top-level folders with their stats, the type counts and the free space. F10: a locked folder's
 * files are left out of the counts until it is opened with the PIN.
 */
export function useFilesHome() {
  const lockedNow = useLockedNowIds();
  const load = useCallback(async (): Promise<FilesHome> => {
    const [listing, space, all] = await Promise.all([listFolder(null), storageSpace(), listAllFilesAndFolders()]);
    const visible = withoutLockedFiles(all.files, hiddenFolderIds(lockedNow, all.folders));
    let counts: TypeCounts;
    if (lockedNow.length === 0) {
      counts = await typeCounts();
    } else {
      counts = typeCountsOf(visible);
    }
    return { listing, counts, space, videoCount: videoTileCount(visible), statsById: await statsFor(listing.folders) };
  }, [lockedNow]);
  return useReloading(load, EMPTY_HOME);
}

/** Every file and folder VidoraX keeps (walked through `listFolder`, so subfolders count once F12 nests them). */
export async function listAllFilesAndFolders(): Promise<{ files: FileEntry[]; folders: FolderEntry[] }> {
  const files: FileEntry[] = [];
  const folders: FolderEntry[] = [];
  const seen = new Set<string>();
  const queue: (string | null)[] = [null];
  while (queue.length > 0) {
    const folderId = queue.shift()!;
    const listing = await listFolder(folderId);
    files.push(...listing.files);
    for (const folder of listing.folders) {
      if (!seen.has(folder.id)) {
        seen.add(folder.id);
        folders.push(folder);
        queue.push(folder.id);
      }
    }
  }
  return { files, folders };
}

/** Every file VidoraX keeps, in every folder. */
export async function listAllFiles(): Promise<FileEntry[]> {
  return (await listAllFilesAndFolders()).files;
}

/** Every file a list may show now: a locked folder's files stay out until it is opened with the PIN (F10). */
export async function listVisibleFiles(lockedNow: readonly string[]): Promise<FileEntry[]> {
  const all = await listAllFilesAndFolders();
  return lockedNow.length === 0 ? all.files : withoutLockedFiles(all.files, hiddenFolderIds(lockedNow, all.folders));
}

const NO_FILES: FileEntry[] = [];

/** All the files a type list may show (the type lists filter them with `fileTypeOf`). */
export function useAllFiles() {
  const lockedNow = useLockedNowIds();
  const load = useCallback(() => listVisibleFiles(lockedNow), [lockedNow]);
  return useReloading(load, NO_FILES);
}

export type FolderView = {
  listing: FolderListing | null;
  /** The folder's path from the top level down to it (empty when it is gone). */
  path: FolderEntry[];
  statsById: Record<string, FolderStats>;
  /** Set when the folder no longer exists: the nearest existing folder of its last known path (null: the Files tab). */
  gone: { fallbackId: string | null } | null;
};

const EMPTY_FOLDER: FolderView = { listing: null, path: [], statsById: {}, gone: null };

/**
 * One folder: its rows, its path (breadcrumbs, "Up to", Back) and its subfolders' stats. When the folder is deleted
 * while open, `gone` names where the screen goes instead.
 */
export function useFolderView(folderId: string) {
  const lastChainRef = useRef<string[]>([]);
  const load = useCallback(async (): Promise<FolderView> => {
    const [listing, path] = await Promise.all([listFolder(folderId), folderPath(folderId)]);
    if (!listing.folder || path.length === 0) {
      const known = lastChainRef.current;
      const chain = known[known.length - 1] === folderId ? known : [folderId];
      const ancestors = chain.slice(0, -1);
      const paths = await Promise.all(ancestors.map((id) => folderPath(id)));
      const existing = new Set(paths.filter((p) => p.length > 0).map((p) => p[p.length - 1]!.id));
      return { ...EMPTY_FOLDER, gone: { fallbackId: nearestExistingFolder(ancestors, (id) => existing.has(id)) } };
    }
    lastChainRef.current = path.map((folder) => folder.id);
    return { listing, path, statsById: await statsFor(listing.folders), gone: null };
  }, [folderId]);
  return useReloading(load, EMPTY_FOLDER);
}
