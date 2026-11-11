/**
 * The copier behind "Also save a copy to…" (#297): one copy at a time, in the order downloads completed. Everything
 * it touches is injected, so the flow — re-checks, the revoked-permission path, the records — is tested without
 * Android. A copy never changes the library item: whatever happens here, the download is already complete.
 */

import type { FolderCopy } from '@modules/vidorax-media/src/VidoraMedia.types';

import {
  copySubfolders,
  type CopyTarget,
  type ExternalCopyRecord,
  type SaveLocationSettings,
} from './save-location';

export type CopierItem = CopyTarget & { id: string; title: string; sizeBytes: number };

export type SaveLocationCopierDeps = {
  getSettings: () => SaveLocationSettings;
  /** The library item as it is right now; null when it no longer exists. */
  getItem: (id: string) => Promise<CopierItem | null>;
  copy: (id: string, treeUri: string, subfolders: string[]) => Promise<FolderCopy>;
  hasRecord: (id: string) => boolean;
  record: (id: string, record: ExternalCopyRecord) => void;
  /** The folder can no longer be written: turn the option off and say so (once per loss). */
  onAccessLost: () => void;
  onStarted?: (item: CopierItem, folderLabel: string | null) => void;
  onCopied?: (item: CopierItem, copy: FolderCopy, folderLabel: string | null) => void;
  onFailed?: (item: CopierItem) => void;
  /** The item being copied right now (null when idle), for the progress shown on its details. */
  onActiveChange?: (id: string | null) => void;
  now: () => number;
};

export type SaveLocationCopier = {
  /** Queues a copy of a completed item; false when it is already queued, copied, or the option is off. */
  enqueue: (id: string) => boolean;
  /** Resolves when the queue is empty (tests). */
  idle: () => Promise<void>;
  activeId: () => string | null;
  dispose: () => void;
};

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
}

/** "Movies/Videos/Instagram": the picked folder's name and the subfolders the copy went into. */
export function copyFolderLabel(folderName: string | null, subfolders: readonly string[]): string | null {
  const parts = [folderName, ...subfolders].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join('/') : null;
}

export function createSaveLocationCopier(deps: SaveLocationCopierDeps): SaveLocationCopier {
  const queue: string[] = [];
  const queued = new Set<string>();
  let active: string | null = null;
  let disposed = false;
  let draining: Promise<void> | null = null;

  function usable(settings: SaveLocationSettings): settings is SaveLocationSettings & { treeUri: string } {
    return settings.enabled && typeof settings.treeUri === 'string' && settings.treeUri.length > 0;
  }

  function clearQueue(): void {
    queue.length = 0;
    queued.clear();
  }

  async function copyOne(id: string): Promise<void> {
    // Re-checked right before acting: the option may be off now, the item deleted, or a copy already made.
    if (!usable(deps.getSettings()) || deps.hasRecord(id)) {
      return;
    }
    let item: CopierItem | null = null;
    try {
      item = await deps.getItem(id);
    } catch {
      item = null;
    }
    const settings = deps.getSettings();
    if (!item || disposed || !usable(settings) || deps.hasRecord(id)) {
      return;
    }
    const subfolders = copySubfolders(settings, item);
    const folderLabel = copyFolderLabel(settings.folderName, subfolders);
    active = id;
    deps.onActiveChange?.(id);
    try {
      deps.onStarted?.(item, folderLabel);
      const copy = await deps.copy(id, settings.treeUri, subfolders);
      deps.record(id, {
        status: 'copied',
        folderUri: copy.folderUri,
        documentUri: copy.documentUri,
        name: copy.name,
        folderLabel,
        at: deps.now(),
      });
      deps.onCopied?.(item, copy, folderLabel);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ERR_FOLDER_ACCESS') {
        // Nothing else can be copied there: stop, turn the option off, say so once.
        clearQueue();
        deps.onAccessLost();
      } else if (code !== 'ERR_NOT_FOUND') {
        // A deleted item needs no record; any other failure is recorded so it is not retried in a loop.
        deps.record(id, { status: 'failed', reason: 'storage', at: deps.now() });
        deps.onFailed?.(item);
      }
    } finally {
      active = null;
      deps.onActiveChange?.(null);
    }
  }

  function drain(): Promise<void> {
    if (draining) {
      return draining;
    }
    draining = (async () => {
      try {
        while (!disposed && queue.length > 0) {
          const id = queue.shift()!;
          try {
            await copyOne(id);
          } finally {
            // Still "queued" until its copy is done, so a repeated completion event is not queued again.
            queued.delete(id);
          }
        }
      } finally {
        draining = null;
      }
    })();
    return draining;
  }

  return {
    enqueue: (id) => {
      if (disposed || !id || queued.has(id) || active === id || deps.hasRecord(id) || !usable(deps.getSettings())) {
        return false;
      }
      queue.push(id);
      queued.add(id);
      void drain();
      return true;
    },
    idle: () => draining ?? Promise.resolve(),
    activeId: () => active,
    dispose: () => {
      disposed = true;
      clearQueue();
    },
  };
}
