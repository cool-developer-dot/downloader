import { persist } from 'zustand/middleware';

import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

/**
 * App Lock's "Unlock with fingerprint or face" (MMKV key `vidorax.appLockBiometric.v1`), off by default. Only whether
 * it is on is stored — nothing biometric ever reaches VidoraX. Turned off with App Lock itself, so setting App Lock up
 * again starts with it off.
 */
type BiometricUnlockPrefs = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

export const useBiometricUnlockPrefs = createStore<BiometricUnlockPrefs>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (enabled) => set((state) => (state.enabled === enabled ? state : { enabled })),
    }),
    {
      name: 'vidorax.appLockBiometric.v1',
      storage: createPersistStorage<Pick<BiometricUnlockPrefs, 'enabled'>>(),
      partialize: (state) => ({ enabled: state.enabled }),
      merge: (persisted, current) => ({
        ...current,
        enabled: (persisted as { enabled?: unknown } | null)?.enabled === true,
      }),
    },
  ),
);
