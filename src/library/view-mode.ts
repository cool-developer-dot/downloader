import { mmkvGetString, mmkvSetString } from '@/storage/mmkv';
import { mmkvKeys } from '@/storage/constants';

import { DEFAULT_LIBRARY_VIEW_MODE } from './constants';
import type { LibraryViewMode } from './types';

export function isLibraryViewMode(value: unknown): value is LibraryViewMode {
  return value === 'list' || value === 'grid';
}

export function readPersistedLibraryViewMode(): LibraryViewMode {
  try {
    const raw = mmkvGetString(mmkvKeys.libraryViewMode);
    if (isLibraryViewMode(raw)) {
      return raw;
    }
  } catch {
    // Corrupted persistence must not crash Library.
  }
  return DEFAULT_LIBRARY_VIEW_MODE;
}

export function writePersistedLibraryViewMode(mode: LibraryViewMode): void {
  try {
    mmkvSetString(mmkvKeys.libraryViewMode, mode);
  } catch {
    // Non-fatal.
  }
}
