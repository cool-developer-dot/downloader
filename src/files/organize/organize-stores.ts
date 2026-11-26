/**
 * Files F7: Hamza's own maps, keyed by folder id (Faran's `folders.ts` is never touched):
 * - #778 Folder icon color (`vidorax.files.folderColors.v1`): a folder's swatch; forgotten when the folder is gone;
 * - #954 Drag reorder (`vidorax.files.customOrder.v1`): a folder's Custom sort — on or off, and its saved order.
 */

import { persist } from 'zustand/middleware';

import { mmkvKeys } from '@/storage/constants';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import { dropGoneIds } from './custom-order';
import { isSwatchId, type SwatchId } from './swatches';

type FolderColorsState = {
  colors: Record<string, SwatchId>;
  setColor: (folderIds: readonly string[], color: SwatchId | null) => void;
  /** Forgets the colours of folders that no longer exist (call with every folder id). */
  prune: (existingIds: readonly string[]) => void;
};

export const useFolderColorsStore = createStore<FolderColorsState>()(
  persist(
    (set) => ({
      colors: {},
      setColor: (folderIds, color) =>
        set((state) => {
          const colors = { ...state.colors };
          for (const id of folderIds) {
            if (color) colors[id] = color;
            else delete colors[id];
          }
          return { colors };
        }),
      prune: (existingIds) =>
        set((state) => {
          const exists = new Set(existingIds);
          const stale = Object.keys(state.colors).filter((id) => !exists.has(id));
          if (stale.length === 0) return state;
          const colors = { ...state.colors };
          for (const id of stale) delete colors[id];
          return { colors };
        }),
    }),
    {
      name: mmkvKeys.filesFolderColors,
      storage: createPersistStorage<{ colors: Record<string, SwatchId> }>(),
      partialize: (state) => ({ colors: state.colors }),
      merge: (persisted, current) => {
        const raw = (persisted as { colors?: unknown } | null)?.colors;
        const colors: Record<string, SwatchId> = {};
        if (raw && typeof raw === 'object') {
          for (const [id, color] of Object.entries(raw as Record<string, unknown>)) {
            if (id && isSwatchId(color)) colors[id] = color;
          }
        }
        return { ...current, colors };
      },
    },
  ),
);

export type CustomOrder = { enabled: boolean; ids: string[] };

type CustomOrderState = {
  byFolder: Record<string, CustomOrder>;
  setEnabled: (folderId: string, enabled: boolean) => void;
  setOrder: (folderId: string, ids: readonly string[]) => void;
  prune: (folderId: string, currentIds: readonly string[]) => void;
};

export const useCustomOrderStore = createStore<CustomOrderState>()(
  persist(
    (set) => ({
      byFolder: {},
      setEnabled: (folderId, enabled) =>
        set((state) => ({ byFolder: { ...state.byFolder, [folderId]: { ids: state.byFolder[folderId]?.ids ?? [], enabled } } })),
      setOrder: (folderId, ids) =>
        set((state) => ({ byFolder: { ...state.byFolder, [folderId]: { enabled: state.byFolder[folderId]?.enabled ?? true, ids: [...ids] } } })),
      prune: (folderId, currentIds) =>
        set((state) => {
          const order = state.byFolder[folderId];
          if (!order) return state;
          const ids = dropGoneIds(order.ids, currentIds);
          return ids.length === order.ids.length ? state : { byFolder: { ...state.byFolder, [folderId]: { ...order, ids } } };
        }),
    }),
    {
      name: mmkvKeys.filesCustomOrder,
      storage: createPersistStorage<{ byFolder: Record<string, CustomOrder> }>(),
      partialize: (state) => ({ byFolder: state.byFolder }),
      merge: (persisted, current) => {
        const raw = (persisted as { byFolder?: unknown } | null)?.byFolder;
        const byFolder: Record<string, CustomOrder> = {};
        if (raw && typeof raw === 'object') {
          for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
            const order = value as { enabled?: unknown; ids?: unknown } | null;
            if (id && order && Array.isArray(order.ids)) {
              byFolder[id] = { enabled: order.enabled === true, ids: order.ids.filter((entry): entry is string => typeof entry === 'string') };
            }
          }
        }
        return { ...current, byFolder };
      },
    },
  ),
);
