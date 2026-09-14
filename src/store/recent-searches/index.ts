import { createStore } from '@/store/shared/create-store';

import { createRecentSearchesActions } from './actions';
import { initialRecentSearchesState } from './state';
import type { RecentSearchesStore } from './types';

export const useRecentSearchesStore = createStore<RecentSearchesStore>((set, get) => ({
  ...initialRecentSearchesState,
  ...createRecentSearchesActions(set, get),
}));

export * from './selectors';
export type {
  RecentSearchesActions,
  RecentSearchesState,
  RecentSearchesStore,
} from './types';
