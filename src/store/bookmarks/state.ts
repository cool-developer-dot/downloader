import { pagination } from '@/constants';

import type { BookmarksState } from './types';

export const initialBookmarksState: BookmarksState = {
  items: [],
  total: 0,
  page: pagination.initialPage,
  pageSize: pagination.defaultPageSize,
  hasMore: false,
  query: '',
  sortBy: 'createdAt',
  sortDirection: 'desc',
  loading: false,
  loadingMore: false,
  refreshing: false,
  syncing: false,
  saving: false,
  error: null,
  ready: false,
  initialized: false,
  lastSync: null,
  urlIndex: {},
  pendingUrls: {},
};
