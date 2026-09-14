import { persist } from 'zustand/middleware';

import type { MediaFolderItem } from '@/api';
import { storageKeys } from '@/constants';
import {
  downloadCatalogRepository,
  folderEntryToApiItem,
  mediaFolderRepository,
} from '@/storage/repositories';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

type FoldersState = {
  itemsById: Record<string, MediaFolderItem>;
  orderedIds: string[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
};

type FoldersActions = {
  ensureReady: () => Promise<void>;
  refetch: () => Promise<void>;
  createFolder: (name: string) => Promise<MediaFolderItem>;
  renameFolder: (id: string, name: string) => Promise<MediaFolderItem>;
  deleteFolder: (id: string) => Promise<void>;
  reset: () => void;
};

export type FoldersStore = FoldersState & FoldersActions;

const initialFoldersState: FoldersState = {
  itemsById: {},
  orderedIds: [],
  loading: false,
  error: null,
  initialized: false,
};

function indexById(items: MediaFolderItem[]): {
  itemsById: Record<string, MediaFolderItem>;
  orderedIds: string[];
} {
  const itemsById: Record<string, MediaFolderItem> = {};
  const orderedIds: string[] = [];
  for (const item of items) {
    if (itemsById[item.id]) continue;
    itemsById[item.id] = item;
    orderedIds.push(item.id);
  }
  return { itemsById, orderedIds };
}

export const useFoldersStore = createStore<FoldersStore>()(
  persist(
    (set, get) => ({
      ...initialFoldersState,

      ensureReady: async () => {
        if (get().initialized || get().loading) return;
        await get().refetch();
      },

      refetch: async () => {
        set({ loading: true, error: null });
        try {
          const entries = await mediaFolderRepository.list();
          const items = entries.map(folderEntryToApiItem);
          const { itemsById, orderedIds } = indexById(items);
          set({
            itemsById,
            orderedIds,
            initialized: true,
            loading: false,
            error: null,
          });
        } catch (error) {
          set({
            loading: false,
            error:
              error instanceof Error ? error.message : 'Failed to load folders',
            initialized: true,
          });
        }
      },

      createFolder: async (name: string) => {
        set({ loading: true, error: null });
        try {
          const entry = await mediaFolderRepository.create(name);
          const folder = folderEntryToApiItem(entry);
          const current = get();
          const nextItemsById = { ...current.itemsById, [folder.id]: folder };
          const nextOrderedIds = [folder.id, ...current.orderedIds].filter(
            (id, idx, arr) => arr.indexOf(id) === idx,
          );
          set({
            itemsById: nextItemsById,
            orderedIds: nextOrderedIds,
            loading: false,
            error: null,
            initialized: true,
          });

          return folder;
        } catch (error) {
          set({
            loading: false,
            error:
              error instanceof Error ? error.message : 'Failed to create folder',
          });
          throw error;
        }
      },

      renameFolder: async (id: string, name: string) => {
        const current = get();
        const prev = current.itemsById[id];
        if (!prev) {
          throw new Error('Folder not found');
        }

        const optimistic = { ...prev, name };
        set({
          itemsById: {
            ...current.itemsById,
            [id]: optimistic,
          },
          error: null,
        });

        try {
          const entry = await mediaFolderRepository.rename(id, name);
          const updated = folderEntryToApiItem(entry);
          set({
            itemsById: {
              ...get().itemsById,
              [id]: updated,
            },
            error: null,
          });
          return updated;
        } catch (error) {
          set({
            itemsById: {
              ...get().itemsById,
              [id]: prev,
            },
            error:
              error instanceof Error ? error.message : 'Failed to rename folder',
          });
          throw error;
        }
      },

      deleteFolder: async (id: string) => {
        const current = get();
        const prev = current.itemsById[id];
        if (!prev) {
          throw new Error('Folder not found');
        }

        // Unassign media first — never delete media files with the folder.
        await downloadCatalogRepository.clearFolderAssignments(id);

        try {
          const { useDownloadsStore } = await import('@/store/downloads');
          const store = useDownloadsStore.getState();
          for (const item of Object.values(store.itemsById)) {
            if (item.folderId === id) {
              store.patchItem(item.id, { folderId: null });
            }
          }
        } catch {
          // store patch is best-effort; catalog already cleared
        }

        set({
          itemsById: Object.fromEntries(
            Object.entries(current.itemsById).filter(
              ([folderId]) => folderId !== id,
            ),
          ),
          orderedIds: current.orderedIds.filter((x) => x !== id),
          error: null,
        });

        try {
          await mediaFolderRepository.delete(id);
        } catch (error) {
          set({
            itemsById: {
              ...get().itemsById,
              [id]: prev,
            },
            orderedIds: [id, ...get().orderedIds],
            error:
              error instanceof Error ? error.message : 'Failed to delete folder',
          });
          throw error;
        }
      },

      reset: () => {
        set({ ...initialFoldersState });
      },
    }),
    {
      name: storageKeys.mediaFolders,
      storage: createPersistStorage<FoldersState>(),
      partialize: (state): FoldersState => ({
        itemsById: state.itemsById,
        orderedIds: state.orderedIds,
        initialized: state.initialized,
        loading: false,
        error: null,
      }),
    },
  ),
);

export const folderIdsSelector = (state: FoldersState) => state.orderedIds;
export const foldersByIdSelector = (state: FoldersState) => state.itemsById;
export const foldersLoadingSelector = (state: FoldersState) => state.loading;
export const foldersErrorSelector = (state: FoldersState) => state.error;
