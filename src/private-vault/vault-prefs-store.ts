import { persist } from 'zustand/middleware';

import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

/**
 * Private's own preference (MMKV key `vidorax.privateVault.v1`): whether the user has acknowledged that private
 * videos are lost for good if VidoraX is uninstalled or its data is cleared. Nothing about the vault's content.
 */
type PrivateVaultPrefs = {
  dataLossAcknowledged: boolean;
  acknowledgeDataLoss: () => void;
};

export const usePrivateVaultPrefs = createStore<PrivateVaultPrefs>()(
  persist(
    (set) => ({
      dataLossAcknowledged: false,
      acknowledgeDataLoss: () => set((state) => (state.dataLossAcknowledged ? state : { dataLossAcknowledged: true })),
    }),
    {
      name: 'vidorax.privateVault.v1',
      storage: createPersistStorage<Pick<PrivateVaultPrefs, 'dataLossAcknowledged'>>(),
      partialize: (state) => ({ dataLossAcknowledged: state.dataLossAcknowledged }),
      merge: (persisted, current) => ({
        ...current,
        dataLossAcknowledged: (persisted as { dataLossAcknowledged?: unknown } | null)?.dataLossAcknowledged === true,
      }),
    },
  ),
);
