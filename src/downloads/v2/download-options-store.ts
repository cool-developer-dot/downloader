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
  rememberFolder,
  setDownloadOptionsSource,
  type DownloadOptionsDraft,
  type PendingFolders,
} from './download-options';
import { getV2Engine } from './engine-port';

const PENDING_KEY = 'vidorax.pendingFolders.v1';

export const useDownloadOptionsDraft = createStore<{ draft: DownloadOptionsDraft | null }>(() => ({ draft: null }));

export function updateDownloadOptionsDraft(patch: Partial<DownloadOptionsDraft> & { identity: string }): void {
  useDownloadOptionsDraft.setState((state) => {
    const base: DownloadOptionsDraft =
      state.draft && state.draft.identity === patch.identity
        ? state.draft
        : { identity: patch.identity, title: '', titleEdited: false, folderId: null, saveToGallery: 'default' };
    return { draft: { ...base, ...patch } };
  });
}

export function clearDownloadOptionsDraft(): void {
  useDownloadOptionsDraft.setState({ draft: null });
}

function readPending(): PendingFolders {
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

  registerQualitySelectionDownloadListener((created) => {
    const draft = useDownloadOptionsDraft.getState().draft;
    // A video already saved has no download to wait for; an existing download still gets the folder.
    if (!draft || draft.folderId == null || !created?.downloadId || created.duplicate === 'ALREADY_DOWNLOADED') {
      return;
    }
    writePending(rememberFolder(readPending(), created.downloadId, draft.folderId));
  });
  registerQualitySelectionClosedListener(() => clearDownloadOptionsDraft());

  const engine = getV2Engine();
  engine?.addListener('onDownloadStateChange', ({ record }) => {
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
}
