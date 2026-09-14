import {
  PLAYBACK_LOCAL_NAMESPACE,
  PLAYBACK_STORAGE_KEY_PREFIX,
} from './constants';
import type { PlaybackState } from './types';
import { computeProgressPercent, isValidProgressNumbers } from './domain/progress';

/** Injectable storage for Node verify / Expo Go without MMKV. */
export type PlaybackStorageAdapter = {
  getItem: (key: string) => string | null | undefined;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  getAllKeys?: () => string[];
};

let adapterOverride: PlaybackStorageAdapter | null = null;

const memoryStore = new Map<string, string>();

const memoryAdapter: PlaybackStorageAdapter = {
  getItem: (key) => memoryStore.get(key) ?? null,
  setItem: (key, value) => {
    memoryStore.set(key, value);
  },
  removeItem: (key) => {
    memoryStore.delete(key);
  },
  getAllKeys: () => Array.from(memoryStore.keys()),
};

function defaultAdapter(): PlaybackStorageAdapter {
  try {
    // Lazy require — Node verify / Expo Go may lack MMKV.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mmkv = require('@/storage/mmkv/helpers') as {
      mmkvGetString: (key: string) => string | undefined;
      mmkvSetString: (key: string, value: string) => void;
      mmkvRemove: (key: string) => boolean;
      mmkvGetAllKeys: () => string[];
      getMmkvInstance?: () => unknown;
    };
    // Prefer MMKV when the native instance exists.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const instanceMod = require('@/storage/mmkv/instance') as {
      getMmkvInstance: () => unknown;
    };
    if (instanceMod.getMmkvInstance()) {
      return {
        getItem: (key) => mmkv.mmkvGetString(key) ?? null,
        setItem: (key, value) => {
          mmkv.mmkvSetString(key, value);
        },
        removeItem: (key) => {
          mmkv.mmkvRemove(key);
        },
        getAllKeys: () => mmkv.mmkvGetAllKeys(),
      };
    }
  } catch {
    // fall through
  }
  return memoryAdapter;
}

function getAdapter(): PlaybackStorageAdapter {
  return adapterOverride ?? defaultAdapter();
}

export function configurePlaybackStorageAdapter(
  adapter: PlaybackStorageAdapter | null,
): void {
  adapterOverride = adapter;
}

export function resetPlaybackStorageForTests(): void {
  adapterOverride = null;
  memoryStore.clear();
}

export function playbackStorageKey(namespace: string, mediaId: string): string {
  return `${PLAYBACK_STORAGE_KEY_PREFIX}:${namespace}:${mediaId}`;
}

/** Parse `vidorax.playback.v1:<namespace>:<mediaId>`. */
export function parsePlaybackStorageKey(
  key: string,
): { namespace: string; mediaId: string } | null {
  const prefix = `${PLAYBACK_STORAGE_KEY_PREFIX}:`;
  if (!key.startsWith(prefix)) {
    return null;
  }
  const rest = key.slice(prefix.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) {
    return null;
  }
  const namespace = rest.slice(0, colon);
  const mediaId = rest.slice(colon + 1);
  if (!namespace || !mediaId) {
    return null;
  }
  return { namespace, mediaId };
}

export function isLocalPlaybackNamespace(namespace: string): boolean {
  return namespace === PLAYBACK_LOCAL_NAMESPACE;
}

function isPlaybackStateShape(value: unknown): value is Omit<
  PlaybackState,
  'clientRevision'
> & { clientRevision?: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.mediaId === 'string' &&
    typeof row.positionSeconds === 'number' &&
    typeof row.durationSeconds === 'number' &&
    typeof row.progressPercent === 'number' &&
    (typeof row.lastPlayedAt === 'string' || row.lastPlayedAt === null) &&
    typeof row.completed === 'boolean' &&
    typeof row.updatedAt === 'string' &&
    typeof row.pendingSync === 'boolean'
  );
}

function normalizePlaybackState(
  value: Omit<PlaybackState, 'clientRevision'> & { clientRevision?: number },
): PlaybackState {
  return {
    mediaId: value.mediaId,
    positionSeconds: value.positionSeconds,
    durationSeconds: value.durationSeconds,
    progressPercent: value.progressPercent,
    lastPlayedAt: value.lastPlayedAt,
    completed: value.completed,
    updatedAt: value.updatedAt,
    pendingSync: value.pendingSync,
    clientRevision:
      typeof value.clientRevision === 'number' &&
      Number.isFinite(value.clientRevision) &&
      value.clientRevision >= 0
        ? Math.trunc(value.clientRevision)
        : 0,
  };
}

export function loadPlaybackState(
  userId: string,
  mediaId: string,
): PlaybackState | null {
  if (!userId || !mediaId) {
    return null;
  }
  const raw = getAdapter().getItem(playbackStorageKey(userId, mediaId));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlaybackStateShape(parsed)) {
      return null;
    }
    return normalizePlaybackState(parsed);
  } catch {
    return null;
  }
}

export function savePlaybackState(
  userId: string,
  state: Omit<PlaybackState, 'clientRevision'> & { clientRevision?: number },
): PlaybackState {
  const normalized: PlaybackState = normalizePlaybackState({
    mediaId: state.mediaId,
    positionSeconds: state.positionSeconds,
    durationSeconds: state.durationSeconds,
    progressPercent: computeProgressPercent(
      state.positionSeconds,
      state.durationSeconds,
    ),
    lastPlayedAt: state.lastPlayedAt,
    completed: state.completed,
    updatedAt: state.updatedAt,
    pendingSync: state.pendingSync,
    clientRevision: state.clientRevision,
  });

  if (
    !isValidProgressNumbers(
      normalized.positionSeconds,
      normalized.durationSeconds,
    )
  ) {
    return normalized;
  }

  getAdapter().setItem(
    playbackStorageKey(userId, normalized.mediaId),
    JSON.stringify(normalized),
  );
  return normalized;
}

export function deletePlaybackState(userId: string, mediaId: string): void {
  getAdapter().removeItem(playbackStorageKey(userId, mediaId));
}

/** List all persisted playback states for a namespace (adapter-backed). */
export function listPlaybackStatesForUser(namespace: string): PlaybackState[] {
  if (!namespace) {
    return [];
  }
  const adapter = getAdapter();
  const prefix = `${PLAYBACK_STORAGE_KEY_PREFIX}:${namespace}:`;
  const keys = adapter.getAllKeys?.() ?? [];
  const out: PlaybackState[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const raw = adapter.getItem(key);
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isPlaybackStateShape(parsed)) {
        out.push(normalizePlaybackState(parsed));
      }
    } catch {
      // skip
    }
  }
  return out;
}

export function listLocalPlaybackStates(): PlaybackState[] {
  return listPlaybackStatesForUser(PLAYBACK_LOCAL_NAMESPACE);
}

const PLAYBACK_MIGRATION_ADAPTER_MARKER = 'vidorax.playback.migration.local.v1';

function readPlaybackStateFromRaw(raw: string | null | undefined): PlaybackState | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlaybackStateShape(parsed)) {
      return null;
    }
    return normalizePlaybackState(parsed);
  } catch {
    return null;
  }
}

function timestampMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function isPlaybackMigrationComplete(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const flags = require('@/storage/mmkv/flags') as {
      getPlaybackMigratedLocalV1: (fallback?: boolean) => boolean;
    };
    if (flags.getPlaybackMigratedLocalV1()) {
      return true;
    }
  } catch {
    // Node verify / missing MMKV
  }
  return getAdapter().getItem(PLAYBACK_MIGRATION_ADAPTER_MARKER) === '1';
}

function markPlaybackMigrationComplete(): void {
  getAdapter().setItem(PLAYBACK_MIGRATION_ADAPTER_MARKER, '1');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const flags = require('@/storage/mmkv/flags') as {
      setPlaybackMigratedLocalV1: (value: boolean) => void;
    };
    flags.setPlaybackMigratedLocalV1(true);
  } catch {
    // Node verify / missing MMKV
  }
}

export type PlaybackNamespaceMigrationResult = {
  migrated: number;
  skippedNewerLocal: number;
  removed: number;
  alreadyComplete: boolean;
};

/**
 * One-time copy of cloud-user playback keys onto `local`.
 * Idempotent. Marks complete only after a successful pass.
 * Does not overwrite a newer local value.
 */
export function migratePlaybackKeysToLocalNamespace(): PlaybackNamespaceMigrationResult {
  if (isPlaybackMigrationComplete()) {
    return {
      migrated: 0,
      skippedNewerLocal: 0,
      removed: 0,
      alreadyComplete: true,
    };
  }

  const adapter = getAdapter();
  const keys = adapter.getAllKeys?.() ?? [];
  let migrated = 0;
  let skippedNewerLocal = 0;
  let removed = 0;

  for (const key of keys) {
    if (key === PLAYBACK_MIGRATION_ADAPTER_MARKER) {
      continue;
    }
    const parsedKey = parsePlaybackStorageKey(key);
    if (!parsedKey) {
      continue;
    }
    if (isLocalPlaybackNamespace(parsedKey.namespace)) {
      continue;
    }

    const incoming = readPlaybackStateFromRaw(adapter.getItem(key));
    const existingLocal = loadPlaybackState(
      PLAYBACK_LOCAL_NAMESPACE,
      parsedKey.mediaId,
    );

    if (incoming) {
      const incomingState: PlaybackState = {
        ...incoming,
        mediaId: parsedKey.mediaId,
      };
      if (!existingLocal) {
        savePlaybackState(PLAYBACK_LOCAL_NAMESPACE, incomingState);
        migrated += 1;
      } else if (timestampMs(existingLocal.updatedAt) >= timestampMs(incomingState.updatedAt)) {
        skippedNewerLocal += 1;
      } else {
        savePlaybackState(PLAYBACK_LOCAL_NAMESPACE, incomingState);
        migrated += 1;
      }
    }

    adapter.removeItem(key);
    removed += 1;
  }

  markPlaybackMigrationComplete();
  return { migrated, skippedNewerLocal, removed, alreadyComplete: false };
}

/** Clears in-memory adapter only (tests). */
export function clearMemoryPlaybackStorage(): void {
  memoryStore.clear();
}
