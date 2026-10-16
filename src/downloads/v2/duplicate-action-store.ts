import { persist } from 'zustand/middleware';

import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import { DEFAULT_DUPLICATE_ACTION, normalizeDuplicateAction, type DuplicateAction } from './duplicate-action';

/** Download Settings → "When a video is already downloaded" (#386), on this device (MMKV `vidorax.duplicateAction.v1`). */
type DuplicateActionState = {
  action: DuplicateAction;
  setAction: (action: DuplicateAction) => void;
};

export const useDuplicateActionStore = createStore<DuplicateActionState>()(
  persist(
    (set) => ({
      action: DEFAULT_DUPLICATE_ACTION,
      setAction: (action) => set((state) => (state.action === action ? state : { action })),
    }),
    {
      name: 'vidorax.duplicateAction.v1',
      storage: createPersistStorage<{ action: DuplicateAction }>(),
      partialize: (state) => ({ action: state.action }),
      merge: (persisted, current) => ({
        ...current,
        action: normalizeDuplicateAction((persisted as { action?: unknown } | null)?.action),
      }),
    },
  ),
);

export function getDuplicateAction(): DuplicateAction {
  return useDuplicateActionStore.getState().action;
}
