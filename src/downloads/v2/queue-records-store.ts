/**
 * The v2 engine's queued and running downloads for the Queue screen (fix/queue-v2): one more listener on the engine's
 * state events (the download bridge is untouched), seeded from `listDownloads` once. Only id, state and creation time
 * are kept — nothing else is needed to place a download in the Queue. A build without the native engine lists none.
 */

import { createStore } from '@/store/shared/create-store';

import { getV2Engine } from './engine-port';
import { applyQueueRecord, type V2QueueRecord } from './queue-view';

export const useV2QueueRecords = createStore<{ byId: Record<string, V2QueueRecord> }>(() => ({ byId: {} }));

function apply(record: V2QueueRecord): void {
  useV2QueueRecords.setState((state) => {
    const byId = applyQueueRecord(state.byId, record);
    return byId === state.byId ? state : { byId };
  });
}

let attached = false;

/** Idempotent; called when the Queue screen opens, then kept for the engine's lifetime. */
export function ensureV2QueueRecords(): void {
  if (attached) {
    return;
  }
  const engine = getV2Engine();
  if (!engine) {
    return;
  }
  attached = true;
  // Subscribe first, so no change between the seed and the listener is missed; a seed older than an event loses.
  const seen = new Set<string>();
  const subscription = engine.addListener('onDownloadStateChange', ({ record }) => {
    seen.add(record.id);
    apply(record);
  });
  void engine
    .listDownloads()
    .then((records) => {
      for (const record of records) {
        if (!seen.has(record.id)) {
          apply(record);
        }
      }
    })
    .catch(() => undefined);
  replaceListener(subscription);
}

const LISTENER_KEY = '__vidoraxQueueRecordsListener';

/** A Fast Refresh re-runs this module (and its `attached` flag): the earlier copy's listener is removed first. */
function replaceListener(next: { remove(): void }): void {
  const store = globalThis as unknown as Record<string, { remove(): void } | undefined>;
  try {
    store[LISTENER_KEY]?.remove();
  } catch {
    // already gone
  }
  store[LISTENER_KEY] = next;
}
