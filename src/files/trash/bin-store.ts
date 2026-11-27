/**
 * F13: the recycle bin's state on this device (MMKV `vidorax.files.bin.v1`): its settings and the trashed items.
 * Only src/files/trash writes it; the downloads store and the library read `entries` to hide trashed items.
 */
import { persist } from 'zustand/middleware';

import { mmkvKeys } from '@/storage/constants';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import { DEFAULT_BIN_SETTINGS, normalizeBinEntries, normalizeBinSettings, type BinEntry, type BinSettings } from './bin-model';

type BinState = {
  settings: BinSettings;
  entries: Record<string, BinEntry>;
};

export const useBinStore = createStore<BinState>()(
  persist(
    (): BinState => ({ settings: DEFAULT_BIN_SETTINGS, entries: {} }),
    {
      name: mmkvKeys.filesBin,
      storage: createPersistStorage<BinState>(),
      partialize: (state) => ({ settings: state.settings, entries: state.entries }),
      merge: (persisted, current) => {
        const value = (persisted ?? {}) as Partial<BinState>;
        return { ...current, settings: normalizeBinSettings(value.settings), entries: normalizeBinEntries(value.entries) };
      },
    },
  ),
);

/** True while `id` is in the bin (hidden from every list). */
export function isTrashed(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(useBinStore.getState().entries, id);
}
