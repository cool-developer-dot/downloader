import { pagination } from '@/constants';

import type { RecentSearchesState } from './types';

export const initialRecentSearchesState: RecentSearchesState = {
  items: [],
  total: 0,
  page: pagination.initialPage,
  pageSize: pagination.defaultPageSize,
  hasMore: false,
  query: '',
  sortBy: 'searchedAt',
  sortDirection: 'desc',
  loading: false,
  refreshing: false,
  error: null,
  ready: false,
};
