import type { StoreApi } from 'zustand';

import {
  isApiError,
  type DownloadItem,
  type DownloadStatus,
  type DownloadWorkerState,
} from '@/api';
import { downloadEngine, DownloadEngineError } from '@/downloads/engine';
import { syncStatusImmediate } from '@/downloads/engine/synchronizer';
import { reconcileDownloadState } from '@/downloads/reconciliation';
import { parseDownloadWorkerState } from '@/downloads/worker-state';
import {
  catalogEntryToDownloadItem,
  downloadCatalogRepository,
} from '@/storage/repositories';
import {
  persistDownloadCatalogItem,
  removeDownloadCatalogItem,
} from '@/storage/services/catalog-persist';
import { createId, nowIso } from '@/storage/utils';

import { initialDownloadsState } from './state';
import type {
  DownloadUiFilter,
  DownloadsActions,
  DownloadsStore,
} from './types';

const DOWNLOAD_STATUSES: readonly DownloadStatus[] = [
  'QUEUED',
  'DOWNLOADING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

/** Prevent double-submit create for the same source while in flight. */
const createInFlightKeys = new Set<string>();

function createDedupeKey(input: {
  sourceUrl: string;
  fileName: string;
  fileSize: string | number;
}): string {
  return `${input.sourceUrl.trim()}|${input.fileName.trim()}|${String(input.fileSize)}`;
}

function resolveCreateStreamType(
  selectedQuality: unknown,
): 'HLS' | 'PROGRESSIVE' | 'AUDIO' | 'DASH' | null {
  if (!selectedQuality || typeof selectedQuality !== 'object') {
    return null;
  }
  const streamType = (selectedQuality as { streamType?: unknown }).streamType;
  if (
    streamType === 'HLS' ||
    streamType === 'PROGRESSIVE' ||
    streamType === 'AUDIO' ||
    streamType === 'DASH'
  ) {
    return streamType;
  }
  return null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

/** True when catalog fields that drive UI/persist are unchanged. */
function isSameDownloadCatalogItem(
  a: DownloadItem,
  b: DownloadItem,
): boolean {
  return (
    a.status === b.status &&
    a.workerState === b.workerState &&
    a.progress === b.progress &&
    a.fileSize === b.fileSize &&
    a.fileName === b.fileName &&
    a.title === b.title &&
    a.errorCode === b.errorCode &&
    a.errorMessage === b.errorMessage &&
    a.downloadedAt === b.downloadedAt &&
    a.quality === b.quality &&
    a.resolution === b.resolution &&
    a.bitrate === b.bitrate &&
    a.mimeType === b.mimeType &&
    a.container === b.container &&
    a.thumbnailUrl === b.thumbnailUrl &&
    a.sourceUrl === b.sourceUrl &&
    a.folderId === b.folderId
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Defensive parse — one bad record must not crash the screen. */
export function normalizeDownloadItem(raw: unknown): DownloadItem | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = typeof raw.id === 'string' ? raw.id : null;
  const status =
    typeof raw.status === 'string' &&
    (DOWNLOAD_STATUSES as readonly string[]).includes(raw.status)
      ? (raw.status as DownloadStatus)
      : null;

  if (!id || !status) {
    return null;
  }

  const progressRaw = raw.progress;
  const progress =
    typeof progressRaw === 'number' && Number.isFinite(progressRaw)
      ? Math.max(0, Math.min(100, Math.trunc(progressRaw)))
      : 0;

  const retryRaw = raw.retryCount;
  const retryCount =
    typeof retryRaw === 'number' && Number.isFinite(retryRaw)
      ? Math.max(0, Math.trunc(retryRaw))
      : 0;

  const bitrateRaw = raw.bitrate;
  const bitrate =
    typeof bitrateRaw === 'number' &&
    Number.isFinite(bitrateRaw) &&
    bitrateRaw > 0
      ? Math.trunc(bitrateRaw)
      : null;

  const workerState: DownloadWorkerState | null = parseDownloadWorkerState(
    raw.workerState,
  );

  return {
    id,
    userId: typeof raw.userId === 'string' ? raw.userId : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : '',
    platform: typeof raw.platform === 'string' ? raw.platform : '',
    thumbnailUrl: typeof raw.thumbnailUrl === 'string' ? raw.thumbnailUrl : '',
    fileName: typeof raw.fileName === 'string' ? raw.fileName : '',
    folderId:
      typeof raw.folderId === 'string' && raw.folderId.trim()
        ? raw.folderId
        : null,
    fileSize:
      typeof raw.fileSize === 'string'
        ? raw.fileSize
        : typeof raw.fileSize === 'number'
          ? String(Math.trunc(raw.fileSize))
          : '0',
    status,
    progress,
    quality:
      typeof raw.quality === 'string' && raw.quality.trim()
        ? raw.quality.trim()
        : null,
    resolution:
      typeof raw.resolution === 'string' && raw.resolution.trim()
        ? raw.resolution.trim()
        : null,
    bitrate,
    mimeType:
      typeof raw.mimeType === 'string' && raw.mimeType.trim()
        ? raw.mimeType.trim().toLowerCase()
        : raw.mimeType === null
          ? null
          : null,
    container:
      typeof raw.container === 'string' && raw.container.trim()
        ? raw.container.trim().toLowerCase()
        : raw.container === null
          ? null
          : null,
    retryCount,
    workerState,
    errorCode:
      typeof raw.errorCode === 'string'
        ? raw.errorCode
        : raw.errorCode === null
          ? null
          : null,
    errorMessage:
      typeof raw.errorMessage === 'string'
        ? raw.errorMessage
        : raw.errorMessage === null
          ? null
          : null,
    downloadedAt:
      typeof raw.downloadedAt === 'string'
        ? raw.downloadedAt
        : raw.downloadedAt == null
          ? null
          : null,
    createdAt:
      typeof raw.createdAt === 'string'
        ? raw.createdAt
        : new Date(0).toISOString(),
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : new Date(0).toISOString(),
  };
}

export function uiFilterToApiStatus(
  filter: DownloadUiFilter,
): DownloadStatus | undefined {
  switch (filter) {
    case 'running':
      return 'DOWNLOADING';
    case 'queued':
      return 'QUEUED';
    case 'paused':
      return 'PAUSED';
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    case 'all':
    default:
      return undefined;
  }
}

function buildIndex(
  items: DownloadItem[],
): { itemsById: Record<string, DownloadItem>; orderedIds: string[] } {
  const itemsById: Record<string, DownloadItem> = {};
  const orderedIds: string[] = [];

  for (const item of items) {
    if (itemsById[item.id]) {
      continue;
    }
    itemsById[item.id] = item;
    orderedIds.push(item.id);
  }

  return { itemsById, orderedIds };
}

function mergeAppend(
  existingIds: string[],
  existingById: Record<string, DownloadItem>,
  nextItems: DownloadItem[],
): { itemsById: Record<string, DownloadItem>; orderedIds: string[] } {
  const itemsById = { ...existingById };
  const orderedIds = [...existingIds];
  const seen = new Set(existingIds);

  for (const item of nextItems) {
    itemsById[item.id] = item;
    if (!seen.has(item.id)) {
      orderedIds.push(item.id);
      seen.add(item.id);
    }
  }

  return { itemsById, orderedIds };
}

function mergeRemoteIntoLocal(
  remote: DownloadItem,
  state: Pick<DownloadsStore, 'itemsById' | 'transferById'>,
): { item: DownloadItem; needsBackendReconcile: boolean } {
  const evidence = downloadEngine.getJobEvidence(remote.id);
  const decision = reconcileDownloadState(remote, {
    local: state.itemsById[remote.id],
    transfer: state.transferById[remote.id],
    engine: evidence,
  });
  return {
    item: decision.item,
    needsBackendReconcile: decision.needsBackendReconcile,
  };
}

function scheduleCorrectiveSync(item: DownloadItem): void {
  void syncStatusImmediate(item.id, item.status, {
    progress: item.progress,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
  }).catch(() => {
    // Synchronizer owns bounded retry / coalesce.
  });
}

export function createDownloadsActions(
  set: StoreApi<DownloadsStore>['setState'],
  get: StoreApi<DownloadsStore>['getState'],
): DownloadsActions {
  let loadRequestId = 0;
  let loadMoreInFlight = false;

  const setMutating = (id: string, mutating: boolean) => {
    set((state) => {
      const mutatingIds = { ...state.mutatingIds };
      if (mutating) {
        mutatingIds[id] = true;
      } else {
        delete mutatingIds[id];
      }
      return { mutatingIds };
    });
  };

  const removeFromStore = (id: string) => {
    set((state) => {
      const itemsById = { ...state.itemsById };
      delete itemsById[id];
      const mutatingIds = { ...state.mutatingIds };
      delete mutatingIds[id];
      const transferById = { ...state.transferById };
      delete transferById[id];

      return {
        itemsById,
        orderedIds: state.orderedIds.filter((itemId) => itemId !== id),
        total: Math.max(0, state.total - 1),
        mutatingIds,
        transferById,
      };
    });
  };

  return {
    setQuery: (query) => {
      set({ query });
    },
    setStatusFilter: (statusFilter) => {
      const current = get().statusFilter;
      if (current === statusFilter) {
        return;
      }

      set({
        statusFilter,
        page: 1,
        orderedIds: [],
        itemsById: {},
        ready: false,
        hasMore: false,
        total: 0,
        error: null,
      });
    },
    setSort: (sort) => {
      const current = get().sort;
      if (current === sort) {
        return;
      }

      set({
        sort,
        page: 1,
        orderedIds: [],
        itemsById: {},
        ready: false,
        hasMore: false,
        total: 0,
        error: null,
      });
    },
    applyPage: (items, meta, append = false) => {
      const normalized = items
        .map(normalizeDownloadItem)
        .filter((item): item is DownloadItem => item !== null);

      const corrective: DownloadItem[] = [];

      set((state) => {
        const index = append
          ? mergeAppend(state.orderedIds, state.itemsById, normalized)
          : buildIndex(normalized);

        const itemsById = { ...index.itemsById };
        const orderedIds = [...index.orderedIds];

        for (const id of Object.keys(itemsById)) {
          const catalogRow = itemsById[id];
          if (!catalogRow) {
            continue;
          }
          const merged = mergeRemoteIntoLocal(catalogRow, state);
          itemsById[id] = merged.item;
          if (merged.needsBackendReconcile) {
            corrective.push(merged.item);
          }
        }

        // Preserve in-flight local-only rows not on this catalog page.
        if (!append) {
          for (const id of state.orderedIds) {
            if (itemsById[id]) {
              continue;
            }
            const local = state.itemsById[id];
            if (!local) {
              continue;
            }
            const evidence = downloadEngine.getJobEvidence(id);
            if (
              evidence.hasActiveWorker ||
              evidence.isQueued ||
              local.status === 'DOWNLOADING' ||
              local.status === 'PAUSED' ||
              local.status === 'QUEUED'
            ) {
              itemsById[id] = local;
              orderedIds.unshift(id);
            }
          }
        }

        return {
          itemsById,
          orderedIds,
          total: meta.total,
          page: meta.page,
          pageSize: meta.pageSize,
          hasMore: meta.hasMore,
          ready: true,
          initialized: true,
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: null,
        };
      });

      for (const item of corrective) {
        scheduleCorrectiveSync(item);
      }
    },
    upsertItem: (item) => {
      const normalized = normalizeDownloadItem(item);
      if (!normalized) {
        return;
      }

      let corrective: DownloadItem | null = null;
      let persisted: DownloadItem | null = null;

      set((state) => {
        let merged = normalized;
        if (state.itemsById[normalized.id]) {
          const decision = mergeRemoteIntoLocal(normalized, state);
          merged = decision.item;
          if (decision.needsBackendReconcile) {
            corrective = decision.item;
          }
        }

        persisted = merged;

        const itemsById = {
          ...state.itemsById,
          [merged.id]: merged,
        };
        const orderedIds = state.orderedIds.includes(merged.id)
          ? state.orderedIds
          : [merged.id, ...state.orderedIds];

        return {
          itemsById,
          orderedIds,
          total: state.orderedIds.includes(merged.id)
            ? state.total
            : state.total + 1,
          ready: true,
          initialized: true,
          error: null,
        };
      });

      if (persisted) {
        persistDownloadCatalogItem(persisted);
      }

      if (corrective) {
        scheduleCorrectiveSync(corrective);
      }
    },
    patchItem: (id, updates) => {
      let persistedItem: DownloadItem | null = null;

      set((state) => {
        const existing = state.itemsById[id];
        if (!existing) {
          return state;
        }

        const terminal =
          existing.status === 'COMPLETED' ||
          existing.status === 'CANCELLED';

        if (
          terminal &&
          updates.status !== undefined &&
          updates.status !== existing.status
        ) {
          return state;
        }
        if (
          existing.status === 'FAILED' &&
          updates.status !== undefined &&
          updates.status !== 'FAILED' &&
          updates.status !== 'QUEUED'
        ) {
          return state;
        }

        const merged = { ...existing, ...updates };
        if (
          updates.progress !== undefined &&
          (existing.status === 'DOWNLOADING' || existing.status === 'QUEUED')
        ) {
          merged.progress = Math.max(existing.progress, updates.progress);
        }

        const next = normalizeDownloadItem(merged);
        if (!next) {
          return state;
        }

        if (isSameDownloadCatalogItem(existing, next)) {
          return state;
        }

        persistedItem = next;

        return {
          itemsById: {
            ...state.itemsById,
            [id]: next,
          },
        };
      });

      const persisted = persistedItem as DownloadItem | null;
      if (persisted) {
        // Durable metadata only — never SQLite-write mid-transfer progress ticks.
        // Live progress/bytes belong on transferById for UI.
        const itemStatus = persisted.status;
        const hasStatusUpdate = updates.status !== undefined;
        const durable =
          hasStatusUpdate ||
          updates.fileName !== undefined ||
          updates.title !== undefined ||
          updates.folderId !== undefined ||
          updates.errorCode !== undefined ||
          updates.errorMessage !== undefined ||
          updates.downloadedAt !== undefined ||
          updates.quality !== undefined ||
          updates.resolution !== undefined ||
          updates.bitrate !== undefined ||
          updates.mimeType !== undefined ||
          updates.container !== undefined ||
          updates.workerState !== undefined ||
          updates.thumbnailUrl !== undefined ||
          updates.sourceUrl !== undefined ||
          (updates.fileSize !== undefined &&
            (hasStatusUpdate ||
              updates.progress === 100 ||
              itemStatus === 'COMPLETED' ||
              itemStatus === 'PAUSED' ||
              itemStatus === 'FAILED')) ||
          (updates.progress !== undefined &&
            (updates.progress === 100 ||
              updates.status === 'COMPLETED' ||
              updates.status === 'PAUSED' ||
              updates.status === 'FAILED' ||
              updates.status === 'CANCELLED'));

        if (durable) {
          persistDownloadCatalogItem(persisted);
        }
      }
    },
    setTransferSnapshot: (snapshot) => {
      set((state) => {
        const previous = state.transferById[snapshot.downloadId];
        const next =
          previous &&
          previous.localState === 'transferring' &&
          snapshot.localState === 'transferring'
            ? {
                ...snapshot,
                progress: Math.max(previous.progress, snapshot.progress),
                bytesWritten: Math.max(
                  previous.bytesWritten,
                  snapshot.bytesWritten,
                ),
              }
            : snapshot;

        if (
          previous &&
          previous.localState === next.localState &&
          previous.localUri === next.localUri &&
          previous.progress === next.progress &&
          previous.bytesWritten === next.bytesWritten &&
          previous.totalBytes === next.totalBytes &&
          previous.errorCode === next.errorCode &&
          previous.executionState === next.executionState
        ) {
          return state;
        }

        return {
          transferById: {
            ...state.transferById,
            [snapshot.downloadId]: next,
          },
        };
      });
    },
    clearTransferSnapshot: (id) => {
      set((state) => {
        if (!state.transferById[id]) {
          return state;
        }
        const transferById = { ...state.transferById };
        delete transferById[id];
        return { transferById };
      });
    },
    load: async (page = 1) => {
      const state = get();
      const requestId = ++loadRequestId;
      const isFirstPage = page === 1;
      const hasKnownState = state.initialized || state.orderedIds.length > 0;

      set({
        loading: isFirstPage && !hasKnownState,
        refreshing: isFirstPage && hasKnownState,
        loadingMore: !isFirstPage,
        error: null,
      });

      try {
        const response = await downloadCatalogRepository.list({
          page,
          limit: state.pageSize,
          search: state.query.trim() || undefined,
          status: uiFilterToApiStatus(state.statusFilter),
          sort: state.sort,
        });

        if (requestId !== loadRequestId) {
          return;
        }

        const items = response.items.map(catalogEntryToDownloadItem);

        get().applyPage(
          items,
          {
            total: response.total,
            page: response.page,
            pageSize: response.pageSize,
            hasMore: response.hasMore,
          },
          !isFirstPage,
        );
      } catch (error) {
        if (requestId !== loadRequestId) {
          return;
        }

        set({
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: getErrorMessage(error, 'Failed to load downloads'),
          initialized: true,
        });
      }
    },
    refresh: async () => {
      await get().load(1);
    },
    loadMore: async () => {
      const state = get();

      if (!state.hasMore || state.loading || state.loadingMore || state.refreshing) {
        return;
      }

      if (loadMoreInFlight) {
        return;
      }

      loadMoreInFlight = true;

      try {
        await get().load(state.page + 1);
      } finally {
        loadMoreInFlight = false;
      }
    },
    search: async (query) => {
      set({ query, page: 1 });
      await get().load(1);
    },
    create: async (input) => {
      const dedupeKey = createDedupeKey(input);
      if (createInFlightKeys.has(dedupeKey)) {
        return null;
      }
      createInFlightKeys.add(dedupeKey);
      set({ error: null });

      try {
        const now = nowIso();
        const id = await createId();
        const created = normalizeDownloadItem({
          id,
          userId: '',
          title: input.title.trim() || input.sourceUrl,
          sourceUrl: input.sourceUrl.trim(),
          platform: input.platform.trim() || 'OTHER',
          thumbnailUrl: input.thumbnailUrl.trim(),
          fileName: input.fileName.trim() || 'download.bin',
          folderId: null,
          fileSize:
            typeof input.fileSize === 'number'
              ? String(Math.trunc(input.fileSize))
              : String(input.fileSize ?? '0'),
          status: 'QUEUED',
          progress: 0,
          quality: input.quality ?? null,
          resolution: input.resolution ?? null,
          bitrate:
            typeof input.bitrate === 'number' && input.bitrate > 0
              ? input.bitrate
              : null,
          retryCount: 0,
          workerState: 'WAITING',
          errorCode: null,
          errorMessage: null,
          downloadedAt: null,
          createdAt: now,
          updatedAt: now,
        });

        if (!created) {
          set({ error: 'Download data was incomplete' });
          return null;
        }

        // Local catalog is source of truth — must succeed before enqueue.
        await downloadCatalogRepository.upsert(
          {
            id: created.id,
            title: created.title,
            sourceUrl: created.sourceUrl,
            platform: created.platform,
            thumbnailUrl: created.thumbnailUrl,
            fileName: created.fileName,
            folderId: null,
            fileSize: created.fileSize,
            status: created.status,
            progress: 0,
            quality: created.quality,
            resolution: created.resolution,
            bitrate: created.bitrate,
            retryCount: 0,
            workerState: created.workerState,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
            favorite: false,
          },
        );

        get().upsertItem(created);

        try {
          await downloadEngine.enqueue({
            id: created.id,
            sourceUrl: created.sourceUrl,
            fileName: created.fileName,
            fileSize: created.fileSize,
            title: created.title,
            streamType: resolveCreateStreamType(input.selectedQuality),
            requestContext: input.requestContext ?? null,
            socialSourceIdentity: input.socialSourceIdentity ?? null,
          });
        } catch (error) {
          set({
            error: getErrorMessage(
              error,
              'Download was created but transfer could not start',
            ),
          });
        }

        // Backend create is intentionally not required (would allocate a different id).
        return get().itemsById[created.id] ?? created;
      } catch (error) {
        set({
          error: getErrorMessage(error, 'Failed to create download'),
        });
        return null;
      } finally {
        createInFlightKeys.delete(dedupeKey);
      }
    },
    fetchOne: async (id) => {
      const cached = get().itemsById[id];
      if (cached) {
        void (async () => {
          try {
            const entry = await downloadCatalogRepository.getById(id);
            if (entry) {
              get().upsertItem(catalogEntryToDownloadItem(entry));
            }
          } catch {
            // Keep cached item on background refresh failure.
          }
        })();
        return cached;
      }

      set({ error: null });

      try {
        const entry = await downloadCatalogRepository.getById(id);
        if (!entry) {
          set({ error: null });
          return null;
        }
        const item = catalogEntryToDownloadItem(entry);
        get().upsertItem(item);
        return get().itemsById[item.id] ?? item;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to load download') });
        throw error;
      }
    },
    pause: async (id) => {
      setMutating(id, true);
      set({ error: null });
      try {
        await downloadEngine.pause(id);
        const exec = downloadEngine.getExecutionSnapshot(id)?.state ?? null;
        const current = get().itemsById[id];
        // Backup patch only when engine reached PAUSED (never on lock no-op).
        if (exec === 'PAUSED' && current && current.status !== 'PAUSED') {
          get().patchItem(id, { status: 'PAUSED', workerState: 'PAUSED' });
        }
        return get().itemsById[id] ?? null;
      } catch (error) {
        const message =
          error instanceof DownloadEngineError
            ? error.message
            : getErrorMessage(error, 'Failed to pause download');
        set({ error: message });
        return null;
      } finally {
        setMutating(id, false);
      }
    },
    resume: async (id) => {
      setMutating(id, true);
      set({ error: null });
      try {
        await downloadEngine.resume(id);
        return get().itemsById[id] ?? null;
      } catch (error) {
        const message =
          error instanceof DownloadEngineError
            ? error.message
            : getErrorMessage(error, 'Unable to resume this download.');
        set({ error: message });
        return null;
      } finally {
        setMutating(id, false);
      }
    },
    cancel: async (id) => {
      setMutating(id, true);
      set({ error: null });
      try {
        await downloadEngine.cancel(id);
        const current = get().itemsById[id];
        if (current && current.status !== 'CANCELLED') {
          get().patchItem(id, { status: 'CANCELLED' });
        }
        return get().itemsById[id] ?? null;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to cancel download') });
        return null;
      } finally {
        setMutating(id, false);
      }
    },
    retry: async (id) => {
      setMutating(id, true);
      set({ error: null });
      try {
        await downloadEngine.retry(id);
        const current = get().itemsById[id];
        // Retry acceptance must clear stale FAILED fields even if the job
        // already promoted out of pending into an active worker slot.
        if (
          current &&
          (current.status === 'FAILED' ||
            current.status === 'QUEUED' ||
            current.status === 'DOWNLOADING')
        ) {
          const snap = downloadEngine.getQueueSnapshot();
          const activeOrPending =
            snap.pending.some((item) => item.downloadId === id) ||
            snap.active.some((item) => item.downloadId === id);
          if (activeOrPending || current.status !== 'FAILED') {
            get().patchItem(id, {
              ...(current.status === 'FAILED' ? { status: 'QUEUED' } : {}),
              errorMessage: null,
              errorCode: null,
            });
          }
        }
        return get().itemsById[id] ?? null;
      } catch (error) {
        const message =
          error instanceof DownloadEngineError
            ? error.message
            : getErrorMessage(error, 'Unable to retry this download.');
        set({ error: message });
        return null;
      } finally {
        setMutating(id, false);
      }
    },
    remove: async (id) => {
      setMutating(id, true);
      set({ error: null });

      try {
        try {
          await downloadEngine.remove(id);
        } catch {
          // Local cleanup is best-effort.
        }

        removeDownloadCatalogItem(id);

        removeFromStore(id);
        return true;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to remove download') });
        return false;
      } finally {
        if (get().itemsById[id]) {
          setMutating(id, false);
        }
      }
    },
    reset: () => {
      loadRequestId += 1;
      loadMoreInFlight = false;
      createInFlightKeys.clear();
      set(initialDownloadsState);
    },
  };
}
