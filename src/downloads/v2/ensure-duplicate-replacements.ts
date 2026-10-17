import { carryItemOrganize } from '@/library/item-organize-store';
import { useDownloadsStore } from '@/store/downloads';

import { settleReplacements, useReplacementsStore, type ReplacementDeps } from './duplicate-replacements';
import { getV2Engine } from './engine-port';

/** H12, Replace (#386): what `settleReplacements` needs, from the running app. */
function appDeps(): ReplacementDeps {
  return {
    statusOf: (id) => useDownloadsStore.getState().engineRowsById[id]?.status ?? null,
    libraryHas: async (id) => {
      try {
        return Boolean(await getV2Engine()?.getLibraryItem(id));
      } catch {
        return false;
      }
    },
    oldExists: (id) => {
      const state = useDownloadsStore.getState();
      return Boolean(state.engineRowsById[id] ?? state.itemsById[id]);
    },
    deleteOld: async (id, newId) => {
      // The new copy keeps the old one's tags and note.
      carryItemOrganize(id, newId);
      const { deleteCompletedFileFromVidoraX } = await import('@/downloads/completed-file/delete/delete-service');
      const result = await deleteCompletedFileFromVidoraX(id);
      return result.ok;
    },
    now: Date.now,
  };
}

let settling: Promise<void> | null = null;
let again = false;

/** Runs a pass now, or once more after the one under way (never two at a time). */
function requestSettle(): void {
  if (settling) {
    again = true;
    return;
  }
  settling = settleReplacements(appDeps())
    .catch(() => undefined)
    .finally(() => {
      settling = null;
      if (again) {
        again = false;
        requestSettle();
      }
    });
}

function pendingSignature(): string {
  const { pending } = useReplacementsStore.getState();
  const rows = useDownloadsStore.getState().engineRowsById;
  return Object.keys(pending)
    .map((id) => `${id}:${rows[id]?.status ?? '-'}`)
    .join('|');
}

const LISTENER_KEY = '__vidoraxDuplicateReplacements';

/**
 * Watches the pending new copies: when one completes, fails or is cancelled, the old item is deleted or kept. Only
 * reacts when a pending download's status changes (never on progress ticks). Kept on `globalThis`, so a Fast Refresh
 * replaces the listener instead of adding a second one.
 */
export function ensureDuplicateReplacements(): void {
  const slot = globalThis as unknown as Record<string, (() => void) | undefined>;
  slot[LISTENER_KEY]?.();
  let last = '';
  const check = () => {
    if (Object.keys(useReplacementsStore.getState().pending).length === 0) {
      last = '';
      return;
    }
    const signature = pendingSignature();
    if (signature !== last) {
      last = signature;
      requestSettle();
    }
  };
  const offDownloads = useDownloadsStore.subscribe(check);
  const offPending = useReplacementsStore.subscribe(check);
  const detach = () => {
    offDownloads();
    offPending();
    if (slot[LISTENER_KEY] === detach) {
      slot[LISTENER_KEY] = undefined;
    }
  };
  slot[LISTENER_KEY] = detach;
  check();
}
