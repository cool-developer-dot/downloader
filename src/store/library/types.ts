import type { LibraryFilter, LibrarySort, LibraryViewMode, LocalAvailability } from '@/library/types';

export type { LibraryFilter, LibrarySort, LibraryViewMode, LocalAvailability };

export interface LibraryState {
  searchQuery: string;
  filter: LibraryFilter;
  sort: LibrarySort;
  quality: string | null;
  folderId: string | null;
  viewMode: LibraryViewMode;
  availabilityById: Record<string, LocalAvailability>;
  /** Bumped on download COMPLETED so mounted Library reloads local records. */
  sourceRevision: number;
  lastReconciledAt: number | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  initialized: boolean;
}

export interface LibraryActions {
  setSearchQuery: (query: string) => void;
  setFilter: (filter: LibraryFilter) => void;
  setSort: (sort: LibrarySort) => void;
  setQuality: (quality: string | null) => void;
  setFolderId: (folderId: string | null) => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setAvailability: (availabilityById: Record<string, LocalAvailability>) => void;
  patchAvailability: (id: string, availability: LocalAvailability) => void;
  bumpSourceRevision: () => void;
  setLoading: (loading: boolean) => void;
  setRefreshing: (refreshing: boolean) => void;
  setError: (error: string | null) => void;
  markReconciled: (at: number) => void;
  markInitialized: () => void;
  resetQuery: () => void;
  reset: () => void;
}

export type LibraryStore = LibraryState & LibraryActions;
