type PersistedStore = {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (callback: () => void) => () => void;
    rehydrate: () => Promise<void> | void;
  };
};

const DEFAULT_HYDRATION_TIMEOUT_MS = 5_000;

export function waitForStoreHydration(
  store: PersistedStore,
  timeoutMs: number = DEFAULT_HYDRATION_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    if (store.persist.hasHydrated()) {
      resolve();
      return;
    }

    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve();
    };

    // Guarantee bootstrap proceeds even if storage never settles (e.g. Expo Go SecureStore).
    const timer = setTimeout(finish, timeoutMs);

    unsubscribe = store.persist.onFinishHydration(finish);

    // Guard against a race where hydration completed between the check and subscription.
    if (store.persist.hasHydrated()) {
      finish();
    }
  });
}

/**
 * Force a second persist read after the durable adapter is configured.
 * First hydration can complete against in-memory storage if the store module
 * loaded before `configurePersistStorage`.
 */
export function rehydrateAndWait(
  store: PersistedStore,
  timeoutMs: number = DEFAULT_HYDRATION_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve();
    };

    const timer = setTimeout(finish, timeoutMs);
    unsubscribe = store.persist.onFinishHydration(finish);
    void Promise.resolve(store.persist.rehydrate()).finally(() => {
      if (store.persist.hasHydrated()) {
        finish();
      }
    });
  });
}

export async function waitForStoresHydration(
  stores: PersistedStore[],
  timeoutMs: number = DEFAULT_HYDRATION_TIMEOUT_MS,
): Promise<void> {
  await Promise.all(stores.map((store) => waitForStoreHydration(store, timeoutMs)));
}
