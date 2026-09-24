import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * Persisted state must never be written before it has been read. Zustand writes the partialized slice on every
 * `set`, so a store that sets anything during startup — a loading flag, an online flag — would replace the
 * user's persisted values with the in-memory defaults before hydration ever ran.
 */
export function hydrationGuardedStorage<T>(base: PersistStorage<T>): {
  storage: PersistStorage<T>;
  onHydrated: () => void;
  isOpen: () => boolean;
} {
  let open = false;
  return {
    isOpen: () => open,
    onHydrated: () => {
      open = true;
    },
    storage: {
      getItem: (name) => base.getItem(name),
      setItem: (name: string, value: StorageValue<T>) => {
        if (!open) {
          return;
        }
        return base.setItem(name, value);
      },
      removeItem: (name) => base.removeItem(name),
    },
  };
}
