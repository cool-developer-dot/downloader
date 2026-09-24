import type { V2EnginePort } from './engine-port';
import { logV2Download } from './diagnostics';

/** A whole-library check at most this often: it stats every file, so focus/foreground bursts share one. */
export const LIBRARY_RECONCILE_TTL_MS = 15_000;

export type LibraryReconciler = {
  /**
   * Asks the engine to remove every library item whose file is gone (deleted or moved outside VidoraX) and resolves
   * with their ids. Runs at most once per [LIBRARY_RECONCILE_TTL_MS] unless `force`; concurrent calls share one run.
   */
  reconcileAll(options?: { force?: boolean }): Promise<string[]>;
  /** Checks exactly these items, always (the player or an action just found one of them missing). */
  reconcileIds(ids: string[]): Promise<string[]>;
};

/**
 * The JavaScript side of the library's missing-file repair. The native library is the source of truth: it deletes
 * the stale rows and announces them (`onLibraryChange` `deleted`), which already removes them from every screen;
 * [onRemoved] applies the same removal directly, so a row never outlives its file even if that event was missed.
 * Failures never surface: a check that cannot run leaves the library as it was.
 */
export function createLibraryReconciler(deps: {
  engine: () => V2EnginePort | null;
  onRemoved: (ids: string[]) => void;
  now?: () => number;
  ttlMs?: number;
}): LibraryReconciler {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? LIBRARY_RECONCILE_TTL_MS;
  let lastFullAt: number | null = null;
  let inFlight: Promise<string[]> | null = null;

  async function run(ids: string[] | null): Promise<string[]> {
    const engine = deps.engine();
    if (!engine?.reconcileLibrary) {
      return [];
    }
    try {
      const removed = await engine.reconcileLibrary(ids);
      if (removed.length > 0) {
        for (const id of removed) {
          logV2Download('library_file_missing', { downloadId: id });
        }
        deps.onRemoved(removed);
      }
      return removed;
    } catch (error) {
      logV2Download('library_reconcile_failed', { message: error instanceof Error ? error.message : null });
      return [];
    }
  }

  return {
    reconcileAll(options) {
      if (inFlight) {
        return inFlight;
      }
      const at = now();
      if (!options?.force && lastFullAt != null && at - lastFullAt < ttlMs) {
        return Promise.resolve([]);
      }
      lastFullAt = at;
      inFlight = run(null).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    reconcileIds(ids) {
      const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
      return wanted.length === 0 ? Promise.resolve([]) : run(wanted);
    },
  };
}
