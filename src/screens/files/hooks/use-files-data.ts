/**
 * Files F1: the data behind the Files screens, read only through the F12 contract (`@/files/api`, via
 * `files-source.ts`). Each hook loads when its screen comes into focus and again whenever `subscribeFiles` says the
 * files changed while it is in front (no polling); pull to refresh runs `rescanLibrary()` first. A late answer never
 * overwrites a newer one.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  folderPath,
  folderStats,
  listFolder,
  rescanLibrary,
  storageSpace,
  subscribeFiles,
  typeCounts,
  type FileEntry,
  type FolderEntry,
} from '@/files/ui/files-source';
import type { FolderContents, FolderStats, TypeCounts } from '@/files/ui/files-index';
import { nearestExistingFolder } from '@/files/ui/folder-tree';

export type LoadStatus = 'loading' | 'ready' | 'error';

export type StorageSpace = Awaited<ReturnType<typeof storageSpace>>;

/** Runs `load` on focus and whenever the files change while the screen is in front; `refresh` rescans first. */
function useReloading<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const tokenRef = useRef(0);
  const liveRef = useRef(true);

  const run = useCallback(async () => {
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
  }, [load]);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  // On focus, and again on every change `subscribeFiles` reports while the screen is in front.
  useFocusEffect(
    useCallback(() => {
      void run();
      return subscribeFiles(() => {
        void run();
      });
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
  return folders.length > 0 ? folderStats(folders.map((folder) => folder.id)) : {};
}

export type FilesHome = {
  listing: FolderContents | null;
  statsById: Record<string, FolderStats>;
  counts: TypeCounts | null;
  space: StorageSpace | null;
};

const EMPTY_HOME: FilesHome = { listing: null, statsById: {}, counts: null, space: null };

/** The Files tab: the top-level folders with their stats, the type counts and the free space. */
export function useFilesHome() {
  const load = useCallback(async (): Promise<FilesHome> => {
    const [listing, counts, space] = await Promise.all([listFolder(null), typeCounts(), storageSpace()]);
    return { listing, counts, space, statsById: await statsFor(listing.folders) };
  }, []);
  return useReloading(load, EMPTY_HOME);
}

/** Every file VidoraX keeps, in every folder (walked through `listFolder`, so subfolders count once F12 nests them). */
export async function listAllFiles(): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  const seen = new Set<string>();
  const queue: (string | null)[] = [null];
  while (queue.length > 0) {
    const folderId = queue.shift()!;
    const listing = await listFolder(folderId);
    files.push(...listing.files);
    for (const folder of listing.folders) {
      if (!seen.has(folder.id)) {
        seen.add(folder.id);
        queue.push(folder.id);
      }
    }
  }
  return files;
}

const NO_FILES: FileEntry[] = [];

/** All files (the type lists keep the ones of their type). */
export function useAllFiles() {
  return useReloading(listAllFiles, NO_FILES);
}

export type FolderView = {
  /** The folder itself (the last of its path); null while loading or when it is gone. */
  folder: FolderEntry | null;
  listing: FolderContents | null;
  /** The folder's path from the top level down to it (empty when it is gone). */
  path: FolderEntry[];
  statsById: Record<string, FolderStats>;
  /** Set when the folder no longer exists: the nearest existing folder of its last known path (null: the Files tab). */
  gone: { fallbackId: string | null } | null;
};

const EMPTY_FOLDER: FolderView = { folder: null, listing: null, path: [], statsById: {}, gone: null };

/**
 * One folder: its rows, its path (breadcrumbs, "Up to", Back) and its subfolders' stats. When the folder is deleted
 * while open, `gone` names where the screen goes instead.
 */
export function useFolderView(folderId: string) {
  const lastChainRef = useRef<string[]>([]);
  const load = useCallback(async (): Promise<FolderView> => {
    const path = await folderPath(folderId);
    const folder = path[path.length - 1];
    if (!folder || folder.id !== folderId) {
      const known = lastChainRef.current;
      const chain = known[known.length - 1] === folderId ? known : [folderId];
      const ancestors = chain.slice(0, -1);
      const paths = await Promise.all(ancestors.map((id) => folderPath(id)));
      const existing = new Set(paths.filter((p) => p.length > 0).map((p) => p[p.length - 1]!.id));
      return { ...EMPTY_FOLDER, gone: { fallbackId: nearestExistingFolder(ancestors, (id) => existing.has(id)) } };
    }
    const listing = await listFolder(folderId);
    lastChainRef.current = path.map((entry) => entry.id);
    return { folder, listing, path, statsById: await statsFor(listing.folders), gone: null };
  }, [folderId]);
  return useReloading(load, EMPTY_FOLDER);
}
