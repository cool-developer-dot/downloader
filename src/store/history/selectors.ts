import type { HistoryState } from './types';

export const selectHistoryItems = (state: HistoryState) => state.items;
export const selectHistoryLoading = (state: HistoryState) => state.loading;
export const selectHistoryLoadingMore = (state: HistoryState) => state.loadingMore;
export const selectHistoryRefreshing = (state: HistoryState) => state.refreshing;
export const selectHistorySyncing = (state: HistoryState) => state.syncing;
export const selectHistoryError = (state: HistoryState) => state.error;
export const selectHistoryHasMore = (state: HistoryState) => state.hasMore;
export const selectHistoryQuery = (state: HistoryState) => state.query;
export const selectHistoryTotal = (state: HistoryState) => state.total;
export const selectHistoryReady = (state: HistoryState) => state.ready;
export const selectHistoryInitialized = (state: HistoryState) => state.initialized;
export const selectHistoryLastSync = (state: HistoryState) => state.lastSync;
