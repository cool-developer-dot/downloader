import { createStore } from '@/store/shared/create-store';

import { createDownloadsActions } from './actions';
import { initialDownloadsState } from './state';
import type { DownloadsStore } from './types';

export const useDownloadsStore = createStore<DownloadsStore>((set, get) => ({
  ...initialDownloadsState,
  ...createDownloadsActions(set, get),
}));

export * from './selectors';
export { uiFilterToApiStatus, normalizeDownloadItem } from './actions';
export type {
  DownloadItem,
  DownloadListSort,
  DownloadSortOption,
  DownloadStatus,
  DownloadUiFilter,
  DownloadsActions,
  DownloadsState,
  DownloadsStore,
} from './types';
export type { DownloadActivitySummary } from './selectors';
