import { createStore } from '@/store/shared/create-store';

import { createLibraryActions } from './actions';
import { initialLibraryState } from './state';
import type { LibraryStore } from './types';

export const useLibraryStore = createStore<LibraryStore>((set) => ({
  ...initialLibraryState,
  ...createLibraryActions(set),
}));

export * from './selectors';
export type {
  LibraryActions,
  LibraryFilter,
  LibrarySort,
  LibraryState,
  LibraryStore,
  LibraryViewMode,
  LocalAvailability,
} from './types';
