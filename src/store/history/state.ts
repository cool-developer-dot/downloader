import { pagination } from '@/constants';

import type { HistoryState } from './types';

export const initialHistoryState: HistoryState = {
  items: [],
  total: 0,
  page: pagination.initialPage,
  pageSize: pagination.defaultPageSize,
  hasMore: false,
  query: '',
  sortBy: 'visitedAt',
  sortDirection: 'desc',
  loading: false,
  loadingMore: false,
  refreshing: false,
  syncing: false,
  error: null,
  ready: false,
  initialized: false,
  lastSync: null,
};
