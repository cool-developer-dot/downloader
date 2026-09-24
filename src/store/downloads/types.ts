import type {
  DownloadItem,
  DownloadListSort,
  DownloadStatus,
} from '@/api';
import type { TransferProgressSnapshot } from '@/downloads';

export type { DownloadItem, DownloadListSort, DownloadStatus };

/** UI filter labels mapped onto local download statuses (see status mapping helpers). */
export type DownloadUiFilter =
  | 'all'
  | 'running'
  | 'queued'
  | 'paused'
  | 'completed'
  | 'failed';

export type DownloadSortOption = 'newest' | 'oldest';

export interface DownloadsState {
  itemsById: Record<string, DownloadItem>;
  orderedIds: string[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: string;
  statusFilter: DownloadUiFilter;
  sort: DownloadSortOption;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  mutatingIds: Record<string, boolean>;
  /** Local transfer overlays keyed by download id (speed/ETA/uri). */
  transferById: Record<string, TransferProgressSnapshot>;
  error: string | null;
  ready: boolean;
  initialized: boolean;
  /**
   * Mirror of the v2 native DownloadEngine's downloads and library items (never persisted here). Ids in it are
   * owned by v2: v1 catalog rows, v1 engine events and v1 reconciliation never write them.
   */
  engineRowsById: Record<string, DownloadItem>;
  /** Engine rows that exist only as library items: Player shows them, Downloads does not. */
  libraryOnlyIds: Record<string, true>;
}

export interface DownloadsActions {
  setQuery: (query: string) => void;
  setStatusFilter: (filter: DownloadUiFilter) => void;
  setSort: (sort: DownloadSortOption) => void;
  applyPage: (
    items: DownloadItem[],
    meta: {
      total: number;
      page: number;
      pageSize: number;
      hasMore: boolean;
    },
    append?: boolean,
  ) => void;
  upsertItem: (item: DownloadItem) => void;
  patchItem: (id: string, updates: Partial<DownloadItem>) => void;
  setTransferSnapshot: (snapshot: TransferProgressSnapshot) => void;
  clearTransferSnapshot: (id: string) => void;
  load: (page?: number) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  search: (query: string) => Promise<void>;
  fetchOne: (id: string) => Promise<DownloadItem | null>;
  create: (input: {
    title: string;
    sourceUrl: string;
    platform: string;
    thumbnailUrl: string;
    fileName: string;
    fileSize: string | number;
    quality?: string | null;
    resolution?: string | null;
    bitrate?: number | null;
    /** Rich analysis-time metadata — durable subset is mapped for POST. */
    selectedQuality?: unknown;
    /** In-memory browser session context — never persisted. */
    requestContext?: import('@/downloads/types/request-context').MediaRequestContext | null;
    /** Stable social identity for Phase 4C refresh — ephemeral only. */
    socialSourceIdentity?: import('@/downloads/engine/social-source-refresh.provider').SocialSourceRefreshIdentity | null;
  }) => Promise<DownloadItem | null>;
  pause: (id: string) => Promise<DownloadItem | null>;
  resume: (id: string) => Promise<DownloadItem | null>;
  cancel: (id: string) => Promise<DownloadItem | null>;
  retry: (id: string) => Promise<DownloadItem | null>;
  remove: (id: string) => Promise<boolean>;
  reset: () => void;
  /** v2 bridge only: projected records from the native engine (state events, hydration, accepted enqueue). */
  applyEngineEntries: (entries: import('@/downloads/v2/projection').V2DownloadEntry[]) => void;
  applyEngineProgress: (
    event: import('@modules/vidorax-media/src/VidoraMedia.types').DownloadProgressEvent,
  ) => void;
  removeEngineEntries: (ids: string[]) => void;
}

export type DownloadsStore = DownloadsState & DownloadsActions;
