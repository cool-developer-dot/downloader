import { persist } from 'zustand/middleware';

import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import {
  DEFAULT_NETWORK_OPTIONS,
  normalizeHeaders,
  normalizeNetworkOptions,
  type HeaderPair,
  type NetworkOptionsInput,
  type TimeoutChoice,
  type UserAgentMode,
} from './network-options';

/**
 * Advanced network options on this device. The User-Agent and timeout choices live in MMKV
 * (`vidorax.networkOptions.v1`). Custom headers may hold secrets, so they never go there or into the app settings:
 * they live in the secure store (`vidorax.networkHeaders.v1`), which settings backup and export never read, and are
 * written only when the user adds, removes or clears one.
 */
type NetworkOptionsState = NetworkOptionsInput & {
  /** False until the headers were read from the secure store. */
  headersHydrated: boolean;
  setUserAgentMode: (mode: UserAgentMode) => void;
  setCustomUserAgent: (value: string) => void;
  setTimeoutChoice: (choice: TimeoutChoice) => void;
  setHeaders: (headers: HeaderPair[]) => void;
  reset: () => void;
};

type PersistedOptions = Omit<NetworkOptionsInput, 'headers'>;

export const useNetworkOptionsStore = createStore<NetworkOptionsState>()(
  persist(
    (set) => ({
      ...DEFAULT_NETWORK_OPTIONS,
      headersHydrated: false,
      setUserAgentMode: (mode) => set((state) => (state.userAgentMode === mode ? state : { userAgentMode: mode })),
      setCustomUserAgent: (value) => set((state) => (state.customUserAgent === value ? state : { customUserAgent: value })),
      setTimeoutChoice: (choice) => set((state) => (state.timeout === choice ? state : { timeout: choice })),
      setHeaders: (headers) => {
        const next = normalizeHeaders(headers);
        // The user's change wins over a secure-store read still in flight.
        set({ headers: next, headersHydrated: true });
        void writeHeaders(next);
      },
      reset: () => {
        set({ ...DEFAULT_NETWORK_OPTIONS, headersHydrated: true });
        void writeHeaders([]);
      },
    }),
    {
      name: 'vidorax.networkOptions.v1',
      storage: createPersistStorage<PersistedOptions>(),
      partialize: (state) => ({
        userAgentMode: state.userAgentMode,
        customUserAgent: state.customUserAgent,
        timeout: state.timeout,
      }),
      merge: (persisted, current) => ({ ...current, ...normalizeNetworkOptions(persisted) }),
    },
  ),
);

/** What the settings push sends: the current choices, headers once they are read. */
export function getNetworkOptionsInput(): NetworkOptionsInput {
  const state = useNetworkOptionsStore.getState();
  return {
    userAgentMode: state.userAgentMode,
    customUserAgent: state.customUserAgent,
    headers: state.headers,
    timeout: state.timeout,
  };
}

// --- secure storage of the headers ---

export const NETWORK_HEADERS_SECURE_KEY = 'vidorax.networkHeaders.v1';

export type HeadersStorage = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  remove: () => Promise<void>;
};

let storageOverride: HeadersStorage | null = null;

export function setNetworkHeadersStorageForTests(storage: HeadersStorage | null): void {
  storageOverride = storage;
  hydration = null;
}

async function headersStorage(): Promise<HeadersStorage> {
  if (storageOverride) {
    return storageOverride;
  }
  const SecureStore = await import('expo-secure-store');
  return {
    read: () => SecureStore.getItemAsync(NETWORK_HEADERS_SECURE_KEY),
    write: (value) => SecureStore.setItemAsync(NETWORK_HEADERS_SECURE_KEY, value),
    remove: () => SecureStore.deleteItemAsync(NETWORK_HEADERS_SECURE_KEY),
  };
}

async function writeHeaders(headers: HeaderPair[]): Promise<void> {
  try {
    const storage = await headersStorage();
    if (headers.length === 0) {
      await storage.remove();
    } else {
      await storage.write(JSON.stringify(headers));
    }
  } catch {
    // The headers still apply for this session; the next change tries to save again.
  }
}

let hydration: Promise<void> | null = null;

/** Reads the headers from the secure store once. Never rejects. */
export function ensureNetworkHeadersHydrated(): Promise<void> {
  if (hydration) {
    return hydration;
  }
  hydration = (async () => {
    try {
      const storage = await headersStorage();
      const raw = await storage.read();
      const headers = raw ? normalizeHeaders(JSON.parse(raw)) : [];
      // A change made while reading wins over what was stored.
      if (!useNetworkOptionsStore.getState().headersHydrated) {
        useNetworkOptionsStore.setState({ headers, headersHydrated: true });
      }
    } catch {
      useNetworkOptionsStore.setState({ headersHydrated: true });
    }
  })();
  return hydration;
}

const BRIDGE_LISTENER_KEY = '__vidoraxNetworkOptionsBridgeListener';

/**
 * The download-settings push follows these options (and the headers once read). One listener at a time, kept on
 * `globalThis`, so a Fast Refresh replaces it instead of pushing twice.
 */
export function subscribeNetworkOptions(listener: () => void): () => void {
  const slot = globalThis as unknown as Record<string, (() => void) | undefined>;
  slot[BRIDGE_LISTENER_KEY]?.();
  const unsubscribe = useNetworkOptionsStore.subscribe((state, previous) => {
    if (
      state.userAgentMode !== previous.userAgentMode ||
      state.customUserAgent !== previous.customUserAgent ||
      state.timeout !== previous.timeout ||
      state.headers !== previous.headers
    ) {
      listener();
    }
  });
  const detach = () => {
    unsubscribe();
    if (slot[BRIDGE_LISTENER_KEY] === detach) {
      slot[BRIDGE_LISTENER_KEY] = undefined;
    }
  };
  slot[BRIDGE_LISTENER_KEY] = detach;
  void ensureNetworkHeadersHydrated();
  return detach;
}
