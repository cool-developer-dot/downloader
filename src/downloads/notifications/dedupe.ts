/**
 * Bounded terminal-event notification dedupe.
 * Keyed by downloadId + event type. Prevents hydration spam.
 */

export type NotificationDedupeStore = {
  /** Map key → last emitted epoch ms */
  entries: Map<string, number>;
};

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

export function createNotificationDedupeStore(): NotificationDedupeStore {
  return { entries: new Map() };
}

export function makeDedupeKey(
  downloadId: string,
  event: 'COMPLETED' | 'FAILED',
): string {
  return `${downloadId}:${event}`;
}

/**
 * Returns true if this event should emit (first time or TTL expired).
 * Does NOT record — call markTerminalNotificationEmitted after successful schedule.
 */
export function canEmitTerminalNotification(
  store: NotificationDedupeStore,
  downloadId: string,
  event: 'COMPLETED' | 'FAILED',
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): boolean {
  if (!downloadId) {
    return false;
  }
  pruneDedupeStore(store, now, ttlMs);
  const key = makeDedupeKey(downloadId, event);
  const prev = store.entries.get(key);
  if (typeof prev === 'number' && now - prev < ttlMs) {
    return false;
  }
  return true;
}

export function markTerminalNotificationEmitted(
  store: NotificationDedupeStore,
  downloadId: string,
  event: 'COMPLETED' | 'FAILED',
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): void {
  if (!downloadId) {
    return;
  }
  pruneDedupeStore(store, now, ttlMs);
  store.entries.set(makeDedupeKey(downloadId, event), now);
  trimStore(store);
}

/**
 * Returns true if this event should emit (first time or TTL expired).
 * Records the emission when returning true.
 * @deprecated Prefer canEmitTerminalNotification + markTerminalNotificationEmitted
 * so failed schedules do not burn the dedupe key.
 */
export function shouldEmitTerminalNotification(
  store: NotificationDedupeStore,
  downloadId: string,
  event: 'COMPLETED' | 'FAILED',
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): boolean {
  if (!canEmitTerminalNotification(store, downloadId, event, now, ttlMs)) {
    return false;
  }
  markTerminalNotificationEmitted(store, downloadId, event, now, ttlMs);
  return true;
}

/** Test helper — force clear one key. */
export function clearDedupeEntry(
  store: NotificationDedupeStore,
  downloadId: string,
  event: 'COMPLETED' | 'FAILED',
): void {
  store.entries.delete(makeDedupeKey(downloadId, event));
}

export function pruneDedupeStore(
  store: NotificationDedupeStore,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
): void {
  for (const [key, ts] of store.entries) {
    if (now - ts >= ttlMs) {
      store.entries.delete(key);
    }
  }
}

function trimStore(store: NotificationDedupeStore): void {
  if (store.entries.size <= MAX_ENTRIES) {
    return;
  }
  const sorted = [...store.entries.entries()].sort((a, b) => a[1] - b[1]);
  const removeCount = store.entries.size - MAX_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    store.entries.delete(sorted[i]![0]);
  }
}

/** Serialize for MMKV (bounded). */
export function serializeDedupeStore(store: NotificationDedupeStore): string {
  pruneDedupeStore(store);
  const obj: Record<string, number> = {};
  for (const [key, ts] of store.entries) {
    obj[key] = ts;
  }
  return JSON.stringify(obj);
}

export function deserializeDedupeStore(raw: string | null | undefined): NotificationDedupeStore {
  const store = createNotificationDedupeStore();
  if (!raw || typeof raw !== 'string') {
    return store;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return store;
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && key.includes(':')) {
        store.entries.set(key, value);
      }
    }
    pruneDedupeStore(store);
    trimStore(store);
  } catch {
    // ignore corrupt
  }
  return store;
}
