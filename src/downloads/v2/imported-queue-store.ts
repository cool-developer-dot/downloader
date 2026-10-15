import { persist } from 'zustand/middleware';

import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import { MAX_QUEUE_ITEMS, type ImportedQueueItem } from './queue-backup';

/**
 * Pages restored from a queue backup, waiting for the user to open them (Import Queue, #503). Only page URLs,
 * titles and quality labels — never engine state. Kept on the device so an import survives a restart.
 */
export type ImportedQueueEntry = ImportedQueueItem & { importedAt: number; openedAt: number | null };

type ImportedQueueState = {
  entries: ImportedQueueEntry[];
  add: (items: readonly ImportedQueueItem[], now?: number) => void;
  markOpened: (key: string, now?: number) => void;
  remove: (key: string) => void;
  clear: () => void;
};

export const useImportedQueueStore = createStore<ImportedQueueState>()(
  persist(
    (set) => ({
      entries: [],
      add: (items, now = Date.now()) =>
        set((state) => {
          const known = new Set(state.entries.map((entry) => entry.key));
          const fresh = items
            .filter((item) => !known.has(item.key))
            .map((item) => ({ ...item, importedAt: now, openedAt: null }));
          return { entries: [...state.entries, ...fresh].slice(-MAX_QUEUE_ITEMS) };
        }),
      markOpened: (key, now = Date.now()) =>
        set((state) => ({
          entries: state.entries.map((entry) => (entry.key === key ? { ...entry, openedAt: now } : entry)),
        })),
      remove: (key) => set((state) => ({ entries: state.entries.filter((entry) => entry.key !== key) })),
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'vidorax.importedQueue.v1',
      storage: createPersistStorage<Pick<ImportedQueueState, 'entries'>>(),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
