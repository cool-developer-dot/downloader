import type { StateStorage } from 'zustand/middleware';

import { getMmkvInstance } from './instance';

/**
 * Zustand StateStorage adapter backed by MMKV.
 * Returns null when the native module is unavailable (e.g. Expo Go).
 */
export function createMmkvStateStorage(): StateStorage | null {
  const mmkv = getMmkvInstance();

  if (!mmkv) {
    return null;
  }

  return {
    getItem: (name) => {
      const value = mmkv.getString(name);
      return value ?? null;
    },
    setItem: (name, value) => {
      mmkv.set(name, value);
    },
    removeItem: (name) => {
      mmkv.remove(name);
    },
  };
}
