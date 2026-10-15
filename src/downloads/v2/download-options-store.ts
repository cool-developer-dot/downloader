/**
 * The quality sheet's Options at runtime (H8): the draft for the offer on screen (in memory, dropped when the sheet
 * closes), and folders chosen for downloads that have not completed yet (MMKV, so a restart keeps them). A chosen
 * folder is applied with the existing folder-assignment code when the v2 engine reports the download completed.
 */

import { getMmkvInstance } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import {
  registerQualitySelectionClosedListener,
  registerQualitySelectionDownloadListener,
} from '@/screens/downloads/quality/download-created-bus';

import {
  folderOnStateChange,
  nextDraft,
  rememberFolder,
  setDownloadOptionsSource,
  type DownloadOptionsDraft,
  type PendingFolders,
} from './download-options';
import { getV2Engine } from './engine-port';

const PENDING_KEY = 'vidorax.pendingFolders.v1';

export const useDownloadOptionsDraft = createStore<{ draft: DownloadOptionsDraft | null }>(() => ({ draft: null }));

export function updateDownloadOptionsDraft(patch: Partial<DownloadOptionsDraft> & { identity: string }): void {
  useDownloadOptionsDraft.setState((state) => ({ draft: nextDraft(state.draft, patch) }));
}

/**
 * The sheet's selected quality changed: the options follow it (same sheet session — the draft is dropped when the
 * sheet closes), so what the user set is applied to the quality actually confirmed.
 */
export function followSelectedQuality(identity: string): void {
  const { draft } = useDownloadOptionsDraft.getState();
  if (draft && draft.identity !== identity) {
    useDownloadOptionsDraft.setState({ draft: { ...draft, identity } });
  }
}

export function clearDownloadOptionsDraft(): void {
  useDownloadOptionsDraft.setState({ draft: null });
}

/** Read from MMKV once, then kept in memory (state events must not each parse the stored map). */
let pendingCache: PendingFolders | null = null;

function readPending(): PendingFolders {
  if (pendingCache) {
    return pendingCache;
  }
  pendingCache = readStoredPending();
  return pendingCache;
}

function readStoredPending(): PendingFolders {
  try {
    const raw = getMmkvInstance()?.getString(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const out: PendingFolders = {};
    for (const [id, folder] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof folder === 'string') {
        out[id] = folder;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writePending(pending: PendingFolders): void {
  pendingCache = pending;
  try {
    getMmkvInstance()?.set(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Not remembered: the item stays Unfiled and can be moved by hand.
  }
}

let attached = false;

/** Idempotent: wires the sheet's options into the handoff and the folder choice into completion. */
export function ensureDownloadOptions(): void {
  if (attached) {
    return;
  }
  attached = true;
  setDownloadOptionsSource(() => useDownloadOptionsDraft.getState().draft);

  const offCreated = registerQualitySelectionDownloadListener((created) => {
    const draft = useDownloadOptionsDraft.getState().draft;
    // A video already saved has no download to wait for; an existing download still gets the folder.
    if (!draft || draft.folderId == null || !created?.downloadId || created.duplicate === 'ALREADY_DOWNLOADED') {
      return;
    }
    writePending(rememberFolder(readPending(), created.downloadId, draft.folderId));
  });
  const offClosed = registerQualitySelectionClosedListener(() => clearDownloadOptionsDraft());

  const engine = getV2Engine();
  const states = engine?.addListener('onDownloadStateChange', ({ record }) => {
    try {
      const pending = readPending();
      if (!(record.id in pending)) {
        return;
      }
      const step = folderOnStateChange(pending, record);
      writePending(step.pending);
      if (step.assign) {
        void useMediaFolderAssignmentsStore
          .getState()
          .moveMediaToFolder({ mediaId: record.libraryItemId ?? record.id, desiredFolderId: step.assign, fallbackFolderId: null })
          .catch(() => undefined);
      }
    } catch {
      // A folder choice must never disturb downloads.
    }
  });
  replaceListeners([offCreated, offClosed, () => states?.remove()]);
}

const LISTENERS_KEY = '__vidoraxDownloadOptionsListeners';

/** A Fast Refresh re-runs this module (and its `attached` flag): an earlier copy's listeners are removed first. */
function replaceListeners(next: (() => void)[]): void {
  const store = globalThis as unknown as Record<string, (() => void)[] | undefined>;
  for (const off of store[LISTENERS_KEY] ?? []) {
    try {
      off();
    } catch {
      // already gone
    }
  }
  store[LISTENERS_KEY] = next;
}
