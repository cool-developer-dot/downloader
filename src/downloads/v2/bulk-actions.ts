/**
 * Pause All (#327), Resume All (#328) and Cancel All (#329) over the v2 engine's downloads.
 *
 * Which rows each action applies to mirrors the engine (`DownloadEngine.PAUSABLE`, `resume` from PAUSED, `cancel`
 * from any non-terminal state), seen through the projection the UI renders (`projectV2Download`):
 * - QUEUED rows are queued / probing / waiting for a network or a retry — all pausable.
 * - DOWNLOADING rows are downloading, or `processing` (merging, verifying: `workerState` VERIFYING). Processing is
 *   not pausable, but it can be cancelled.
 * - PAUSED rows can be resumed or cancelled.
 */

import type { DownloadStatus } from '@/api/types';

import type { V2EnginePort } from './engine-port';

export type BulkRow = {
  id: string;
  status: DownloadStatus;
  workerState?: string | null;
  /** The row shows "pausing would restart it" (`pauseBlockedReason === 'SOURCE_NOT_RESUMABLE'`). */
  pauseRestarts?: boolean;
};

export type BulkSummary = {
  pausableIds: string[];
  resumableIds: string[];
  cancellableIds: string[];
  /** Pausable rows that cannot resume: Pause All warns about these first. */
  pauseRestartCount: number;
};

const PROCESSING_WORKER_STATE = 'VERIFYING';

export function isBulkPausable(row: BulkRow): boolean {
  if (row.status === 'QUEUED') {
    return true;
  }
  return row.status === 'DOWNLOADING' && row.workerState !== PROCESSING_WORKER_STATE;
}

export function isBulkResumable(row: BulkRow): boolean {
  return row.status === 'PAUSED';
}

export function isBulkCancellable(row: BulkRow): boolean {
  return row.status === 'QUEUED' || row.status === 'DOWNLOADING' || row.status === 'PAUSED';
}

/** Pure: what each bulk action would touch. A row appears once even if listed twice. */
export function summarizeBulkActions(rows: readonly BulkRow[]): BulkSummary {
  const seen = new Set<string>();
  const summary: BulkSummary = { pausableIds: [], resumableIds: [], cancellableIds: [], pauseRestartCount: 0 };
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    if (isBulkPausable(row)) {
      summary.pausableIds.push(row.id);
      if (row.pauseRestarts === true) {
        summary.pauseRestartCount += 1;
      }
    }
    if (isBulkResumable(row)) {
      summary.resumableIds.push(row.id);
    }
    if (isBulkCancellable(row)) {
      summary.cancellableIds.push(row.id);
    }
  }
  return summary;
}

export type BulkOutcome = { done: string[]; failed: string[] };

async function eachSequentially(
  ids: readonly string[],
  run: (id: string) => Promise<void>,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { done: [], failed: [] };
  for (const id of ids) {
    try {
      await run(id);
      outcome.done.push(id);
    } catch {
      // One download the engine refuses (already finished, gone) never stops the others.
      outcome.failed.push(id);
    }
  }
  return outcome;
}

const ENGINE_MISSING = 'The download engine is not available.';

/** The engine's own `pauseAll`; per-item `pause` on an older native build without it. */
export async function pauseAllEngineDownloads(engine: V2EnginePort | null, ids: readonly string[]): Promise<void> {
  if (!engine) {
    throw new Error(ENGINE_MISSING);
  }
  if (typeof engine.pauseAll === 'function') {
    await engine.pauseAll();
    return;
  }
  await eachSequentially(ids, (id) => engine.pause(id));
}

/** The engine's own `resumeAll`; per-item `resume` on an older native build without it. */
export async function resumeAllEngineDownloads(engine: V2EnginePort | null, ids: readonly string[]): Promise<void> {
  if (!engine) {
    throw new Error(ENGINE_MISSING);
  }
  if (typeof engine.resumeAll === 'function') {
    await engine.resumeAll();
    return;
  }
  await eachSequentially(ids, (id) => engine.resume(id));
}

/** There is no native cancel-all: each download is cancelled with the engine's per-item `cancel`, in order. */
export async function cancelAllEngineDownloads(
  engine: V2EnginePort | null,
  ids: readonly string[],
): Promise<BulkOutcome> {
  if (!engine) {
    throw new Error(ENGINE_MISSING);
  }
  return eachSequentially(ids, (id) => engine.cancel(id));
}

const FIELD = '\u001f';
const ROW = '\u001e';

/** Pure: the rows as one string (stable while nothing the bulk bar shows has changed). */
export function bulkSignature(rows: readonly BulkRow[]): string {
  return rows
    .map((row) => [row.id, row.status, row.workerState ?? '', row.pauseRestarts ? '1' : ''].join(FIELD))
    .join(ROW);
}

/** Pure: the rows back from `bulkSignature`. */
export function rowsFromBulkSignature(signature: string): BulkRow[] {
  if (!signature) {
    return [];
  }
  return signature.split(ROW).map((part) => {
    const [id = '', status = '', workerState = '', restarts = ''] = part.split(FIELD);
    return { id, status: status as BulkRow['status'], workerState: workerState || null, pauseRestarts: restarts === '1' };
  });
}
