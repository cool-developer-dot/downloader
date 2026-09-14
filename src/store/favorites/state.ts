import type { FavoritesState } from './types';

export const FAVORITES_PAGE_SIZE = 20;

export const initialFavoritesState: FavoritesState = {
  itemsById: {},
  orderedIds: [],
  total: 0,
  page: 1,
  pageSize: FAVORITES_PAGE_SIZE,
  hasMore: false,
  query: '',
  sort: 'newest',
  loading: false,
  loadingMore: false,
  refreshing: false,
  saving: false,
  urlIndex: {},
  pendingUrls: {},
  mutationSeqByKey: {},
  inFlightDesiredByKey: {},
  mutatingIds: {},
  error: null,
  ready: false,
  initialized: false,
};
