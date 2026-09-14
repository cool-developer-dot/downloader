import { createStore } from '@/store/shared/create-store';

import { createBookmarksActions } from './actions';
import { initialBookmarksState } from './state';
import type { BookmarksStore } from './types';

export const useBookmarksStore = createStore<BookmarksStore>((set, get) => ({
  ...initialBookmarksState,
  ...createBookmarksActions(set, get),
}));

export * from './selectors';
export type { BookmarksActions, BookmarksState, BookmarksStore } from './types';
