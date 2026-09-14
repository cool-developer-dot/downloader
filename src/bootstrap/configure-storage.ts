import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { StateStorage } from 'zustand/middleware';

import {
  createMmkvStateStorage,
  getMmkvUnavailableReason,
} from '@/storage/mmkv';
import {
  configurePersistStorage,
  createInMemoryStorage,
} from '@/store/shared/persist-storage';

let configured = false;

/**
 * Expo Go cannot load Nitro-backed native modules (react-native-mmkv).
 * Falling back to AsyncStorage there is expected — not a fault to surface in LogBox.
 */
function isExpoGoRuntime(): boolean {
  return (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    Constants.appOwnership === 'expo'
  );
}

function createSafeAsyncStorage(): StateStorage {
  return {
    getItem: async (name) => {
      try {
        return await AsyncStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: async (name, value) => {
      try {
        await AsyncStorage.setItem(name, value);
      } catch {
        // Expo Go / unlinked native module — ignore so Zustand set() never throws.
      }
    },
    removeItem: async (name) => {
      try {
        await AsyncStorage.removeItem(name);
      } catch {
        // no-op
      }
    },
  };
}

function isAsyncStorageUsable(): boolean {
  try {
    // Touch the module surface; a null native module throws on first access in v3,
    // and can reject on first call in mislinked builds.
    return typeof AsyncStorage?.getItem === 'function';
  } catch {
    return false;
  }
}

function resolvePersistStorage(): StateStorage {
  const mmkvStorage = createMmkvStateStorage();

  if (mmkvStorage) {
    return mmkvStorage;
  }

  if (isAsyncStorageUsable()) {
    // Expo Go: MMKV is unsupported — AsyncStorage is the intended path.
    // Dev/prod native builds: warn once; MMKV should be linked there.
    if (__DEV__ && !isExpoGoRuntime()) {
      const reason = getMmkvUnavailableReason() ?? 'native module unavailable';
      console.warn(
        `[storage] MMKV unavailable in native build (${reason}) — falling back to AsyncStorage`,
      );
    }
    return createSafeAsyncStorage();
  }

  if (__DEV__) {
    console.warn(
      '[storage] MMKV and AsyncStorage unavailable — using in-memory persist',
    );
  }

  return createInMemoryStorage();
}

/**
 * Wires Zustand persist storage once per JS runtime.
 * Safe under Fast Refresh — does not re-warn or reconfigure on remount.
 */
export function configureAppStorage(): void {
  if (configured) {
    return;
  }

  configurePersistStorage(resolvePersistStorage());
  configured = true;
}

configureAppStorage();
