/**
 * Files F2 · File manager settings (design 27): how the Files lists look and behave, app-wide, kept in MMKV
 * (`vidorax.files.viewSettings.v1`). #761 List / #762 Grid, #763 Thumbnail size, #765 Sort, #766 Ascending /
 * descending, #767 Folders first, #770 Show extensions, #800 Confirm before delete. "Show hidden files" is stored now
 * and used once F7's Hide lands.
 *
 * A stored value that is missing, of the wrong type or from an older shape is normalized to a valid one; unknown
 * keys are dropped.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

export const FILES_VIEW_MODES = ['list', 'grid'] as const;
export type FilesViewMode = (typeof FILES_VIEW_MODES)[number];

export const FILES_THUMBNAIL_SIZES = ['small', 'medium', 'large'] as const;
export type FilesThumbnailSize = (typeof FILES_THUMBNAIL_SIZES)[number];

export const FILES_SORT_KEYS = ['name', 'date', 'size', 'type'] as const;
export type FilesSortKey = (typeof FILES_SORT_KEYS)[number];

export const FILES_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type FilesSortDirection = (typeof FILES_SORT_DIRECTIONS)[number];

export type FilesViewSettings = {
  viewMode: FilesViewMode;
  showThumbnails: boolean;
  thumbnailSize: FilesThumbnailSize;
  showHidden: boolean;
  sortKey: FilesSortKey;
  sortDirection: FilesSortDirection;
  foldersFirst: boolean;
  showExtensions: boolean;
  confirmDelete: boolean;
};

/** The plan's defaults: list, thumbnails on, Medium, hidden files off, Name ascending, folders first, no extensions, confirm. */
export const DEFAULT_FILES_VIEW_SETTINGS: Readonly<FilesViewSettings> = {
  viewMode: 'list',
  showThumbnails: true,
  thumbnailSize: 'medium',
  showHidden: false,
  sortKey: 'name',
  sortDirection: 'asc',
  foldersFirst: true,
  showExtensions: false,
  confirmDelete: true,
};

/** A list row's thumbnail width (dp) for each size. */
export const LIST_THUMBNAIL_DP: Readonly<Record<FilesThumbnailSize, number>> = { small: 40, medium: 56, large: 72 };

/** The grid's columns for each size (bigger thumbnails, fewer columns). */
export const GRID_COLUMNS: Readonly<Record<FilesThumbnailSize, number>> = { small: 4, medium: 3, large: 2 };

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return fallback;
}

/** Older or looser shapes of the thumbnail size: the dp value (40 / 56 / 72) or "s" / "m" / "l". */
function thumbnailSizeOf(value: unknown): FilesThumbnailSize | null {
  const named = oneOf(FILES_THUMBNAIL_SIZES, value);
  if (named) return named;
  if (value === 40 || value === 's') return 'small';
  if (value === 56 || value === 'm') return 'medium';
  if (value === 72 || value === 'l') return 'large';
  return null;
}

/** "ascending" / "descending" (an older spelling) and the Library's combined `name_desc` style. */
function directionOf(value: unknown): FilesSortDirection | null {
  const direction = oneOf(FILES_SORT_DIRECTIONS, value);
  if (direction) return direction;
  if (value === 'ascending') return 'asc';
  if (value === 'descending') return 'desc';
  return null;
}

export function normalizeFilesViewSettings(value: unknown): FilesViewSettings {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const defaults = DEFAULT_FILES_VIEW_SETTINGS;
  let sortKey = oneOf(FILES_SORT_KEYS, saved.sortKey);
  let sortDirection = directionOf(saved.sortDirection);
  // An older combined value, e.g. { sort: 'size_desc' }.
  if (!sortKey && typeof saved.sort === 'string') {
    const [key, direction] = saved.sort.split('_');
    sortKey = oneOf(FILES_SORT_KEYS, key);
    sortDirection = sortDirection ?? directionOf(direction);
  }
  return {
    viewMode: oneOf(FILES_VIEW_MODES, saved.viewMode) ?? defaults.viewMode,
    showThumbnails: bool(saved.showThumbnails, defaults.showThumbnails),
    thumbnailSize: thumbnailSizeOf(saved.thumbnailSize) ?? defaults.thumbnailSize,
    showHidden: bool(saved.showHidden, defaults.showHidden),
    sortKey: sortKey ?? defaults.sortKey,
    sortDirection: sortDirection ?? defaults.sortDirection,
    foldersFirst: bool(saved.foldersFirst, defaults.foldersFirst),
    showExtensions: bool(saved.showExtensions, defaults.showExtensions),
    confirmDelete: bool(saved.confirmDelete, defaults.confirmDelete),
  };
}

function read(): FilesViewSettings {
  try {
    return normalizeFilesViewSettings(mmkvGetObject(mmkvKeys.filesViewSettings));
  } catch {
    return { ...DEFAULT_FILES_VIEW_SETTINGS };
  }
}

const useFilesViewSettingsStore = createStore<FilesViewSettings>()(() => read());

export function useFilesViewSettings(): FilesViewSettings {
  return useFilesViewSettingsStore((state) => state);
}

export function getFilesViewSettings(): FilesViewSettings {
  return useFilesViewSettingsStore.getState();
}

/** Changes some settings at once (every Files list re-renders), and keeps them across restarts. */
export function setFilesViewSettings(patch: Partial<FilesViewSettings>): FilesViewSettings {
  const next = normalizeFilesViewSettings({ ...useFilesViewSettingsStore.getState(), ...patch });
  try {
    mmkvSetObject(mmkvKeys.filesViewSettings, next);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useFilesViewSettingsStore.setState(next, true);
  return next;
}

/** #800: whether a delete in Files, the Player tab or Downloads asks "Delete from VidoraX?" first (default on). */
export function isConfirmBeforeDeleteOn(): boolean {
  return useFilesViewSettingsStore.getState().confirmDelete;
}

/** Reloads from storage (a restored backup, tests). */
export function reloadFilesViewSettings(): FilesViewSettings {
  const next = read();
  useFilesViewSettingsStore.setState(next, true);
  return next;
}
