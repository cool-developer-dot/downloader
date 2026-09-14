import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';

export class InMemoryStorage implements StateStorage {
  private readonly store = new Map<string, string>();

  getItem(name: string): string | null {
    return this.store.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.store.set(name, value);
  }

  removeItem(name: string): void {
    this.store.delete(name);
  }
}

export function createInMemoryStorage(): StateStorage {
  return new InMemoryStorage();
}

let persistStorageAdapter: StateStorage | null = null;
let inMemoryFallback: StateStorage | null = null;

export function configurePersistStorage(storage: StateStorage): void {
  persistStorageAdapter = storage;
}

export function getPersistStorageAdapter(): StateStorage {
  if (persistStorageAdapter) {
    return persistStorageAdapter;
  }

  if (!inMemoryFallback) {
    inMemoryFallback = createInMemoryStorage();
  }

  return inMemoryFallback;
}

/**
 * Zustand persist adapter that resolves storage on every call.
 *
 * `createJSONStorage(() => adapter)` captures the adapter once. If that happens
 * before MMKV/AsyncStorage is configured, writes go to a throwaway in-memory
 * map and local-only fields (e.g. maxConcurrentDownloads) vanish on reload.
 */
export function createPersistStorage<T>(): PersistStorage<T> {
  const read = (name: string): string | null | Promise<string | null> =>
    getPersistStorageAdapter().getItem(name);

  const parse = (str: string | null): StorageValue<T> | null => {
    if (str == null) {
      return null;
    }
    return JSON.parse(str) as StorageValue<T>;
  };

  return {
    getItem: (name) => {
      const str = read(name);
      if (str instanceof Promise) {
        return str.then(parse);
      }
      return parse(str);
    },
    setItem: (name, value) =>
      getPersistStorageAdapter().setItem(name, JSON.stringify(value)),
    removeItem: (name) => getPersistStorageAdapter().removeItem(name),
  };
}
