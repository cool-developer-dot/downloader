import type { DownloadProgressEvent } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DownloadItem, DownloadStatus } from '@/api/types';
import type { TransferProgressSnapshot } from '@/downloads/engine/types';

import { applyV2Progress, type V2DownloadEntry } from './projection';

/** The downloads-store fields the v2 mirror reads and writes. */
export type EngineViewState = {
  itemsById: Record<string, DownloadItem>;
  orderedIds: string[];
  transferById: Record<string, TransferProgressSnapshot>;
  total: number;
  statusFilter: 'all' | 'running' | 'queued' | 'paused' | 'completed' | 'failed';
  query: string;
  sort: 'newest' | 'oldest';
  /** Every v2 download row, whatever the current filter; ids here are owned by the v2 engine, never by v1. */
  engineRowsById: Record<string, DownloadItem>;
  /** Rows that exist only as library items: shown in Player, never listed under Downloads. */
  libraryOnlyIds: Record<string, true>;
};

type ViewPatch = Pick<
  EngineViewState,
  'itemsById' | 'orderedIds' | 'transferById' | 'total' | 'engineRowsById' | 'libraryOnlyIds'
>;

const FILTER_STATUS: Record<EngineViewState['statusFilter'], DownloadStatus | null> = {
  all: null,
  running: 'DOWNLOADING',
  queued: 'QUEUED',
  paused: 'PAUSED',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

export function isEngineOwned(state: Pick<EngineViewState, 'engineRowsById'>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.engineRowsById, id);
}

export function matchesDownloadsView(
  item: DownloadItem,
  view: Pick<EngineViewState, 'statusFilter' | 'query'>,
): boolean {
  const status = FILTER_STATUS[view.statusFilter];
  if (status && item.status !== status) {
    return false;
  }
  const query = view.query.trim().toLowerCase();
  return !query || item.title.toLowerCase().includes(query);
}

function insertionIndex(
  orderedIds: string[],
  itemsById: Record<string, DownloadItem>,
  item: DownloadItem,
  sort: EngineViewState['sort'],
): number {
  const index = orderedIds.findIndex((id) => {
    const other = itemsById[id];
    if (!other) {
      return false;
    }
    return sort === 'oldest' ? other.createdAt > item.createdAt : other.createdAt < item.createdAt;
  });
  return index < 0 ? orderedIds.length : index;
}

/** Adds, moves or removes one owned row in the visible page so it follows the current filter. */
function placeInView(
  view: Pick<ViewPatch, 'itemsById' | 'orderedIds' | 'total'>,
  item: DownloadItem,
  state: Pick<EngineViewState, 'statusFilter' | 'query' | 'sort'>,
  libraryOnly = false,
): void {
  const present = view.orderedIds.includes(item.id);
  // Downloads lists downloads: a video whose download record is gone lives in Player only.
  if (libraryOnly || !matchesDownloadsView(item, state)) {
    if (present) {
      delete view.itemsById[item.id];
      view.orderedIds = view.orderedIds.filter((id) => id !== item.id);
      view.total = Math.max(0, view.total - 1);
    }
    return;
  }
  view.itemsById[item.id] = item;
  if (!present) {
    const at = insertionIndex(view.orderedIds, view.itemsById, item, state.sort);
    view.orderedIds = [...view.orderedIds.slice(0, at), item.id, ...view.orderedIds.slice(at)];
    view.total += 1;
  }
}

/** Applies projected v2 rows (state events, hydration). Organization metadata the user set is kept. */
export function reduceEngineEntries(state: EngineViewState, entries: V2DownloadEntry[]): ViewPatch {
  const next: ViewPatch = {
    itemsById: { ...state.itemsById },
    orderedIds: state.orderedIds,
    transferById: { ...state.transferById },
    total: state.total,
    engineRowsById: { ...state.engineRowsById },
    libraryOnlyIds: { ...state.libraryOnlyIds },
  };
  for (const entry of entries) {
    const id = entry.item.id;
    const previous = next.engineRowsById[id] ?? state.itemsById[id];
    const previousTransfer = next.transferById[id];
    let { item, transfer } = entry;
    item = { ...item, folderId: previous?.folderId ?? item.folderId };
    // A state event can carry a byte count older than the last progress event: never move backwards.
    if (
      previous?.status === 'DOWNLOADING' &&
      item.status === 'DOWNLOADING' &&
      previousTransfer?.executionState === transfer.executionState
    ) {
      const bytes = Math.max(previousTransfer.bytesWritten, transfer.bytesWritten);
      const progress = Math.max(previous.progress, item.progress);
      item = { ...item, progress };
      transfer = {
        ...transfer,
        bytesWritten: bytes,
        progress,
        bytesPerSecond: transfer.bytesPerSecond ?? previousTransfer.bytesPerSecond,
        etaSeconds: transfer.etaSeconds ?? previousTransfer.etaSeconds,
      };
    }
    next.engineRowsById[id] = item;
    next.transferById[id] = transfer;
    placeInView(next, item, state, entry.libraryOnly === true);
    if (entry.libraryOnly === true) {
      next.libraryOnlyIds = { ...next.libraryOnlyIds, [id]: true };
    } else if (next.libraryOnlyIds[id]) {
      const rest = { ...next.libraryOnlyIds };
      delete rest[id];
      next.libraryOnlyIds = rest;
    }
  }
  return next;
}

export function reduceEngineProgress(state: EngineViewState, event: DownloadProgressEvent): ViewPatch | null {
  const item = state.engineRowsById[event.id];
  const transfer = state.transferById[event.id];
  if (!item || !transfer) {
    return null;
  }
  const updated = applyV2Progress({ item, transfer }, event);
  if (!updated) {
    return null;
  }
  const inView = state.orderedIds.includes(event.id);
  return {
    itemsById: inView ? { ...state.itemsById, [event.id]: updated.item } : state.itemsById,
    orderedIds: state.orderedIds,
    transferById: { ...state.transferById, [event.id]: updated.transfer },
    total: state.total,
    engineRowsById: { ...state.engineRowsById, [event.id]: updated.item },
    libraryOnlyIds: state.libraryOnlyIds,
  };
}

export function reduceEngineRemoval(state: EngineViewState, ids: string[]): ViewPatch {
  const owned = new Set(ids.filter((id) => isEngineOwned(state, id)));
  const itemsById = { ...state.itemsById };
  const transferById = { ...state.transferById };
  const engineRowsById = { ...state.engineRowsById };
  let total = state.total;
  for (const id of owned) {
    if (state.orderedIds.includes(id)) {
      total = Math.max(0, total - 1);
    }
    delete itemsById[id];
    delete transferById[id];
    delete engineRowsById[id];
  }
  const libraryOnlyIds = { ...state.libraryOnlyIds };
  for (const id of owned) {
    delete libraryOnlyIds[id];
  }
  return {
    itemsById,
    orderedIds: state.orderedIds.filter((id) => !owned.has(id)),
    transferById,
    total,
    engineRowsById,
    libraryOnlyIds,
  };
}

/**
 * A v1 catalog page never shows a v2 download's id (the engine wins; the v1 files it used to point at were moved
 * into the v2 library). On the first page every owned row that matches the view is merged in.
 */
export function mergeEngineRowsIntoPage(
  state: Pick<EngineViewState, 'engineRowsById' | 'statusFilter' | 'query' | 'sort'> &
    Partial<Pick<EngineViewState, 'libraryOnlyIds'>>,
  page: { itemsById: Record<string, DownloadItem>; orderedIds: string[]; total: number },
  firstPage: boolean,
): { itemsById: Record<string, DownloadItem>; orderedIds: string[]; total: number } {
  const view = {
    itemsById: { ...page.itemsById },
    orderedIds: page.orderedIds.filter((id) => !isEngineOwned(state, id)),
    total: page.total,
  };
  for (const id of page.orderedIds) {
    if (isEngineOwned(state, id)) {
      delete view.itemsById[id];
      view.total = Math.max(0, view.total - 1);
    }
  }
  if (!firstPage) {
    return view;
  }
  const rows = Object.values(state.engineRowsById).sort((a, b) =>
    state.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt),
  );
  for (const item of rows) {
    placeInView(view, item, state, state.libraryOnlyIds?.[item.id] === true);
  }
  return view;
}
