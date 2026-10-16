import { persist } from 'zustand/middleware';

import type { DownloadStatus } from '@/api/types';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

/**
 * H12, Replace (#386): the new copy's download id → the old library item it replaces. The old item is deleted through
 * the app's own delete path only once the new download COMPLETED (the engine verified it); a new download that failed,
 * was cancelled or removed leaves the old item alone. Kept in MMKV (`vidorax.duplicateReplacements.v1`), so a copy
 * that finishes while the app is closed still replaces the old one the next time the app runs.
 */
type Pending = { oldId: string; since: number; attempts: number };

type ReplacementsState = { pending: Record<string, Pending> };

export const useReplacementsStore = createStore<ReplacementsState>()(
  persist(() => ({ pending: {} as Record<string, Pending> }), {
    name: 'vidorax.duplicateReplacements.v1',
    storage: createPersistStorage<ReplacementsState>(),
    merge: (persisted, current) => ({ ...current, pending: normalizePending((persisted as ReplacementsState | null)?.pending) }),
  }),
);

/** A new copy not seen for this long (its record pruned, nothing in the library) is forgotten. */
export const FORGET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Deleting the old item is tried this often before it is left alone. */
export const MAX_DELETE_ATTEMPTS = 3;

function normalizePending(raw: unknown): Record<string, Pending> {
  const out: Record<string, Pending> = {};
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  for (const [newId, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<Pending> | null;
    if (entry && typeof entry.oldId === 'string' && entry.oldId && entry.oldId !== newId) {
      out[newId] = {
        oldId: entry.oldId,
        since: typeof entry.since === 'number' ? entry.since : Date.now(),
        attempts: typeof entry.attempts === 'number' ? entry.attempts : 0,
      };
    }
  }
  return out;
}

export function trackReplacement(newId: string, oldId: string, now: number = Date.now()): void {
  if (!newId || !oldId || newId === oldId) {
    return;
  }
  useReplacementsStore.setState((state) => ({ pending: { ...state.pending, [newId]: { oldId, since: now, attempts: 0 } } }));
}

export type ReplacementDeps = {
  /** The new download's status as the Downloads list knows it; null when it is not (or no longer) listed. */
  statusOf: (id: string) => DownloadStatus | null;
  /** Whether the library has an item for the new download (it completed while its record was pruned). */
  libraryHas: (id: string) => Promise<boolean>;
  /** Whether the old item still exists. */
  oldExists: (id: string) => boolean;
  /** The app's delete path for a saved video; true when it is gone. */
  deleteOld: (id: string) => Promise<boolean>;
  now: () => number;
};

type Verdict = 'keep' | 'drop' | 'delete';

async function verdictFor(newId: string, entry: Pending, deps: ReplacementDeps): Promise<Verdict> {
  const status = deps.statusOf(newId);
  if (status === 'COMPLETED') {
    return 'delete';
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return 'drop';
  }
  if (status) {
    return 'keep';
  }
  if (await deps.libraryHas(newId)) {
    return 'delete';
  }
  return deps.now() - entry.since > FORGET_AFTER_MS ? 'drop' : 'keep';
}

/** One pass over the pending replacements. */
export async function settleReplacements(deps: ReplacementDeps): Promise<void> {
  const pending = useReplacementsStore.getState().pending;
  for (const [newId, entry] of Object.entries(pending)) {
    const verdict = await verdictFor(newId, entry, deps);
    if (verdict === 'keep') {
      continue;
    }
    if (verdict === 'delete' && deps.oldExists(entry.oldId)) {
      const deleted = await deps.deleteOld(entry.oldId).catch(() => false);
      if (!deleted && entry.attempts + 1 < MAX_DELETE_ATTEMPTS) {
        useReplacementsStore.setState((state) => {
          const current = state.pending[newId];
          return current ? { pending: { ...state.pending, [newId]: { ...current, attempts: current.attempts + 1 } } } : state;
        });
        continue;
      }
    }
    useReplacementsStore.setState((state) => {
      if (!state.pending[newId]) {
        return state;
      }
      const next = { ...state.pending };
      delete next[newId];
      return { pending: next };
    });
  }
}
