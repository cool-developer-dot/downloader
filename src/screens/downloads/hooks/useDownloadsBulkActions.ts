import { useCallback, useMemo, useRef, useState } from 'react';

import { getV2Engine } from '@/downloads/v2';
import {
  cancelAllEngineDownloads,
  pauseAllEngineDownloads,
  resumeAllEngineDownloads,
  summarizeBulkActions,
  type BulkRow,
} from '@/downloads/v2/bulk-actions';
import { useDownloadsStore } from '@/store/downloads';

import { resolveTransferRuntime } from '../utils/download-format';

export type BulkAction = 'pauseAll' | 'resumeAll' | 'cancelAll';
export type BulkError = 'pauseFailed' | 'resumeFailed' | 'cancelFailed';

/**
 * Pause All / Resume All / Cancel All for the Downloads tab. Reads only the v2 rows the native engine owns (never
 * v1 rows, never library-only rows); the engine's state events update the list afterwards.
 */
export function useDownloadsBulkActions() {
  const engineRowsById = useDownloadsStore((state) => state.engineRowsById);
  const libraryOnlyIds = useDownloadsStore((state) => state.libraryOnlyIds);
  const transferById = useDownloadsStore((state) => state.transferById);
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const [error, setError] = useState<BulkError | null>(null);
  const busyRef = useRef(false);

  const summary = useMemo(() => {
    const rows: BulkRow[] = [];
    for (const [id, item] of Object.entries(engineRowsById)) {
      if (libraryOnlyIds[id]) {
        continue;
      }
      const transfer = transferById[id] ?? null;
      // Same inputs as the card's "pausing would restart it" note (DownloadCard).
      const runtime = resolveTransferRuntime(item.status, {
        localUri: transfer?.localUri ?? null,
        localState: transfer?.localState ?? null,
        executionState: transfer?.executionState ?? null,
        workerState: item.workerState ?? transfer?.workerState ?? null,
        supportsResume: transfer?.supportsResume ?? null,
        errorCode: item.errorCode ?? null,
      });
      rows.push({
        id,
        status: item.status,
        workerState: item.workerState ?? transfer?.workerState ?? null,
        pauseRestarts: runtime.pauseBlockedReason === 'SOURCE_NOT_RESUMABLE',
      });
    }
    return summarizeBulkActions(rows);
  }, [engineRowsById, libraryOnlyIds, transferById]);

  const run = useCallback(async (action: BulkAction, ids: readonly string[]) => {
    if (busyRef.current || ids.length === 0) {
      return;
    }
    busyRef.current = true;
    setBusy(action);
    setError(null);
    try {
      const engine = getV2Engine();
      if (action === 'pauseAll') {
        await pauseAllEngineDownloads(engine, ids);
      } else if (action === 'resumeAll') {
        await resumeAllEngineDownloads(engine, ids);
      } else {
        const outcome = await cancelAllEngineDownloads(engine, ids);
        if (outcome.failed.length > 0 && outcome.done.length === 0) {
          setError('cancelFailed');
        }
      }
    } catch {
      setError(action === 'cancelAll' ? 'cancelFailed' : action === 'pauseAll' ? 'pauseFailed' : 'resumeFailed');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, []);

  const pauseAll = useCallback(() => run('pauseAll', summary.pausableIds), [run, summary.pausableIds]);
  const resumeAll = useCallback(() => run('resumeAll', summary.resumableIds), [run, summary.resumableIds]);
  const cancelAll = useCallback(() => run('cancelAll', summary.cancellableIds), [run, summary.cancellableIds]);
  const clearError = useCallback(() => setError(null), []);

  return { summary, busy, error, clearError, pauseAll, resumeAll, cancelAll };
}
