/**
 * The Queue screen for the v2 engine (fix/queue-v2). Pure.
 *
 * The screen used to read only the v1 scheduler, so v2 downloads never appeared there. Now its two lists also hold
 * the v2 engine's own downloads, from the engine's records (their real states, not the Downloads rows they are
 * projected into):
 * - Active: being prepared, downloading, or finishing up (merging / converting / verifying).
 * - Up next: queued, waiting for a network it may use, or waiting to retry — in the engine's first-come order.
 * Paused, finished, failed and cancelled downloads are on neither list (they are in Downloads). The rows render the
 * same live Downloads-store data as everywhere else, so progress moves as it does there. v1 records still exist, so
 * the v1 scheduler's lists are kept, first.
 */

import type { DownloadRecord, DownloadState } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { QueueSnapshot, QueueWaitingReason } from '@/downloads/scheduler';

export type V2QueueRecord = Pick<DownloadRecord, 'id' | 'state' | 'createdAt'>;

export type V2QueueView = {
  active: string[];
  pending: { downloadId: string; waitingReason: QueueWaitingReason }[];
};

const ACTIVE: ReadonlySet<DownloadState> = new Set<DownloadState>(['probing', 'downloading', 'processing']);

function waitingReason(state: DownloadState, wifiOnly: boolean): QueueWaitingReason | null {
  switch (state) {
    case 'queued':
      return 'CAPACITY';
    case 'waiting_network':
      // The engine waits for a network it may use: Wi-Fi under Wi-Fi only, any connection otherwise.
      return wifiOnly ? 'WAITING_FOR_WIFI' : 'OFFLINE';
    case 'waiting_retry':
      return 'RETRY_DELAY';
    default:
      return null;
  }
}

function firstCome(a: V2QueueRecord, b: V2QueueRecord): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Pure: the v2 engine's active and up-next downloads. States it does not know are on neither list. */
export function v2QueueView(records: Iterable<V2QueueRecord>, options: { wifiOnly: boolean }): V2QueueView {
  const sorted = [...records].sort(firstCome);
  const active: string[] = [];
  const pending: V2QueueView['pending'] = [];
  for (const record of sorted) {
    if (ACTIVE.has(record.state)) {
      active.push(record.id);
      continue;
    }
    const reason = waitingReason(record.state, options.wifiOnly);
    if (reason) {
      pending.push({ downloadId: record.id, waitingReason: reason });
    }
  }
  return { active, pending };
}

/**
 * Pure: the screen's snapshot — the v1 scheduler's lists first (v1 records still exist), then the v2 engine's. The
 * places in line are counted across both, starting at 1. An id in both (never expected) is listed once, as v2's.
 */
export function combineQueueSnapshots(v1: QueueSnapshot, v2: V2QueueView): QueueSnapshot {
  const v2Ids = new Set([...v2.active, ...v2.pending.map((item) => item.downloadId)]);
  const active = [
    ...v1.active.filter((item) => !v2Ids.has(item.downloadId)),
    ...v2.active.map((downloadId) => ({ downloadId })),
  ];
  const waiting = [
    ...v1.pending.filter((item) => !v2Ids.has(item.downloadId)).map(({ downloadId, waitingReason }) => ({ downloadId, waitingReason })),
    ...v2.pending,
  ];
  return {
    ...v1,
    active,
    pending: waiting.map((item, index) => ({ ...item, position: index + 1 })),
  };
}

/** Pure: the records after one state event; terminal and paused ones are dropped (they leave the Queue). */
export function applyQueueRecord(
  byId: Readonly<Record<string, V2QueueRecord>>,
  record: V2QueueRecord,
): Record<string, V2QueueRecord> {
  const listed = ACTIVE.has(record.state) || waitingReason(record.state, false) !== null;
  const current = byId[record.id];
  if (!listed) {
    if (!current) {
      return byId as Record<string, V2QueueRecord>;
    }
    const { [record.id]: _gone, ...rest } = byId;
    return rest;
  }
  if (current && current.state === record.state && current.createdAt === record.createdAt) {
    return byId as Record<string, V2QueueRecord>;
  }
  return { ...byId, [record.id]: { id: record.id, state: record.state, createdAt: record.createdAt } };
}
