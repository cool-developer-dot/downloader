/**
 * Files F10 · #910 Folder lock: folders the user locked (folder ⋮ → Lock folder), kept in MMKV
 * (`vidorax.files.lockedFolders.v1`), and the ones opened with the PIN for this session (memory only).
 *
 * A locked folder — and every folder under it once F12 nests them — is left out of the type tiles, search and the
 * Player tab until it is unlocked for the session; opening it asks for the App Lock PIN or a fingerprint. It locks
 * again whenever the app locks. It is not encryption: the files stay where they are (Private is the encrypted place).
 */

import { useMemo } from 'react';

import { appLockEvent, type AppLockSnapshot } from '@/private-vault/vault-gate';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import { folderSubtreeIds, type FolderNodeLike } from './folder-tree';

/** More than any real folder list; a broken stored value can't grow without end. */
const MAX_LOCKED_FOLDERS = 1000;

/** Stored ids, checked: unique non-empty strings (anything else is dropped). */
export function normalizeLockedFolderIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id === 'string' && id.trim() && !seen.has(id) && out.length < MAX_LOCKED_FOLDERS) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** The locked folders that are not open for this session. */
export function lockedNowIds(locked: readonly string[], sessionUnlocked: ReadonlySet<string>): string[] {
  return locked.filter((id) => !sessionUnlocked.has(id));
}

/** Every folder whose files are hidden now: each locked-now folder and everything under it. */
export function hiddenFolderIds(lockedNow: readonly string[], folders: readonly FolderNodeLike[]): Set<string> {
  const hidden = new Set<string>();
  for (const id of lockedNow) {
    for (const inside of folderSubtreeIds(id, folders)) {
      hidden.add(inside);
    }
  }
  return hidden;
}

/** The files to show: everything but the files in a hidden folder. */
export function withoutLockedFiles<T extends { folderId: string | null }>(files: readonly T[], hidden: ReadonlySet<string>): T[] {
  return hidden.size === 0 ? [...files] : files.filter((file) => !file.folderId || !hidden.has(file.folderId));
}

/** Whether opening `folderId` asks for the PIN: it, or a folder above it, is locked and not open this session. */
export function needsUnlock(
  folderId: string,
  chain: readonly string[],
  locked: readonly string[],
  sessionUnlocked: ReadonlySet<string>,
): boolean {
  const lockedNow = new Set(lockedNowIds(locked, sessionUnlocked));
  return lockedNow.has(folderId) || chain.some((id) => lockedNow.has(id));
}

/** Whether an App Lock change locks the folders again: the app locked, or App Lock was turned off. */
export function relocksOn(previous: AppLockSnapshot, next: AppLockSnapshot): boolean {
  return appLockEvent(previous, next, false) !== null;
}

// ── The store ──────────────────────────────────────────────────────────────────────────────────────────────────

type LockedFoldersState = {
  locked: string[];
  /** Opened with the PIN since the app last locked (never stored). */
  sessionUnlocked: string[];
};

function readLocked(): string[] {
  try {
    return normalizeLockedFolderIds(mmkvGetObject(mmkvKeys.filesLockedFolders));
  } catch {
    return [];
  }
}

function writeLocked(ids: string[]): void {
  try {
    mmkvSetObject(mmkvKeys.filesLockedFolders, ids);
  } catch {
    // Kept for this run even when it can't be saved.
  }
}

export const useLockedFoldersStore = createStore<LockedFoldersState>()(() => ({ locked: readLocked(), sessionUnlocked: [] }));

export function lockFolder(folderId: string): void {
  const { locked, sessionUnlocked } = useLockedFoldersStore.getState();
  if (!folderId || locked.includes(folderId)) {
    return;
  }
  const next = normalizeLockedFolderIds([...locked, folderId]);
  writeLocked(next);
  useLockedFoldersStore.setState({ locked: next, sessionUnlocked: sessionUnlocked.filter((id) => id !== folderId) });
}

/** Takes the lock off for good (offered only while the folder is open, i.e. after the PIN). */
export function removeFolderLock(folderId: string): void {
  const { locked, sessionUnlocked } = useLockedFoldersStore.getState();
  const next = locked.filter((id) => id !== folderId);
  writeLocked(next);
  useLockedFoldersStore.setState({ locked: next, sessionUnlocked: sessionUnlocked.filter((id) => id !== folderId) });
}

/** The PIN was right: the folder stays open until the app locks again. */
export function unlockFolderForSession(folderId: string): void {
  const { sessionUnlocked } = useLockedFoldersStore.getState();
  if (!sessionUnlocked.includes(folderId)) {
    useLockedFoldersStore.setState({ sessionUnlocked: [...sessionUnlocked, folderId] });
  }
}

/** Every locked folder locks again (the app locked). */
export function relockAllFolders(): void {
  if (useLockedFoldersStore.getState().sessionUnlocked.length > 0) {
    useLockedFoldersStore.setState({ sessionUnlocked: [] });
  }
}

/** Forgets locks on folders that no longer exist (call with the full folder list). */
export function pruneLockedFolders(existingIds: readonly string[]): void {
  const exists = new Set(existingIds);
  const { locked, sessionUnlocked } = useLockedFoldersStore.getState();
  const next = locked.filter((id) => exists.has(id));
  if (next.length !== locked.length) {
    writeLocked(next);
    useLockedFoldersStore.setState({ locked: next, sessionUnlocked: sessionUnlocked.filter((id) => exists.has(id)) });
  }
}

export function isFolderLocked(folderId: string): boolean {
  return useLockedFoldersStore.getState().locked.includes(folderId);
}

/** The locked-now ids as a hook (screens and lists re-render when a folder is locked or opened). */
export function useLockedNowIds(): string[] {
  const locked = useLockedFoldersStore((state) => state.locked);
  const sessionUnlocked = useLockedFoldersStore((state) => state.sessionUnlocked);
  return useMemo(() => lockedNowIds(locked, new Set(sessionUnlocked)), [locked, sessionUnlocked]);
}
