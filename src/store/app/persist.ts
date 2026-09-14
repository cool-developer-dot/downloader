import { storageKeys } from '@/constants';
import { isMmkvAvailable } from '@/storage/mmkv';
import { getPersistStorageAdapter } from '@/store/shared/persist-storage';

export type PersistedAppSlice = {
  firstLaunch?: boolean;
  onboardingComplete?: boolean;
};

/** Zustand envelope or legacy flat slice — settings store uses the same guard. */
export function unwrapPersistedAppState(persisted: unknown): PersistedAppSlice {
  if (!persisted || typeof persisted !== 'object') {
    return {};
  }

  const record = persisted as Record<string, unknown>;
  if (record.state && typeof record.state === 'object') {
    return record.state as PersistedAppSlice;
  }

  return record as PersistedAppSlice;
}

export function getAppPersistAdapterLabel(): string {
  if (isMmkvAvailable()) {
    return 'mmkv';
  }

  const adapter = getPersistStorageAdapter();
  const name = adapter.constructor?.name ?? 'unknown';

  if (name.includes('InMemory')) {
    return 'in-memory';
  }

  return 'async-storage';
}

export async function readPersistedAppSlice(): Promise<PersistedAppSlice> {
  const adapter = getPersistStorageAdapter();
  const raw = await Promise.resolve(adapter.getItem(storageKeys.app));

  if (!raw) {
    return {};
  }

  try {
    return unwrapPersistedAppState(JSON.parse(raw));
  } catch {
    return {};
  }
}
