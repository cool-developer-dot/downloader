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
  /** `parentId` (F12): the folder to create it in; omitted/null = the root. */
  createFolder: (name: string, parentId?: string | null) => Promise<MediaFolderItem>;
  /** F12: moves a folder under `parentId` (null = the root). Loops and depth are checked by src/files/api.ts. */
  moveFolder: (id: string, parentId: string | null) => Promise<MediaFolderItem>;
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

      createFolder: async (name: string, parentId: string | null = null) => {
        set({ loading: true, error: null });
        try {
          const entry = await mediaFolderRepository.create(name, parentId);
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

      moveFolder: async (id: string, parentId: string | null) => {
        const entry = await mediaFolderRepository.move(id, parentId);
        const moved = folderEntryToApiItem(entry);
        set({ itemsById: { ...get().itemsById, [id]: moved }, error: null });
        return moved;
      },

      deleteFolder: async (id: string) => {
        const current = get();
        const prev = current.itemsById[id];
        if (!prev) {
          throw new Error('Folder not found');
        }

        // F12: the folder's media and subfolders move up into its parent (the root for a top-level folder). Media
        // files are never deleted with a folder.
        const parentId = prev.parentId ?? null;
        await downloadCatalogRepository.moveFolderAssignments(id, parentId);

        try {
          const { useDownloadsStore } = await import('@/store/downloads');
          const store = useDownloadsStore.getState();
          for (const item of Object.values(store.itemsById)) {
            if (item.folderId === id) {
              store.patchItem(item.id, { folderId: parentId });
            }
          }
        } catch {
          // store patch is best-effort; catalog already cleared
        }
        try {
          // The assignment cache would otherwise keep pointing at the deleted folder.
          const { useMediaFolderAssignmentsStore } = await import('./folder-assignments');
          useMediaFolderAssignmentsStore.setState((state) => {
            let changed = false;
            const next: Record<string, string | null> = {};
            for (const [mediaId, folderId] of Object.entries(state.folderIdByMediaId)) {
              if (folderId === id) {
                changed = true;
                next[mediaId] = parentId;
              } else {
                next[mediaId] = folderId;
              }
            }
            return changed ? { folderIdByMediaId: next } : state;
          });
        } catch {
          // best-effort, like the downloads patch above
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
          // Subfolders were re-parented (and maybe renamed) in the database: reload them.
          await get().refetch();
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
