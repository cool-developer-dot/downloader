import type { DownloadsState } from './types';

export const DOWNLOADS_PAGE_SIZE = 20;

export const initialDownloadsState: DownloadsState = {
  itemsById: {},
  orderedIds: [],
  total: 0,
  page: 1,
  pageSize: DOWNLOADS_PAGE_SIZE,
  hasMore: false,
  query: '',
  statusFilter: 'all',
  sort: 'newest',
  loading: false,
  loadingMore: false,
  refreshing: false,
  mutatingIds: {},
  transferById: {},
  error: null,
  ready: false,
  initialized: false,
};
