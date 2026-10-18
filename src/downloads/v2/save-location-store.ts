import { persist } from 'zustand/middleware';

import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import {
  DEFAULT_SAVE_LOCATION,
  normalizeCopyRecords,
  normalizeSaveLocation,
  reduceSaveLocation,
  withCopyRecord,
  withoutCopyRecords,
  type ExternalCopyRecord,
  type ExternalCopyRecords,
  type SaveLocationAction,
  type SaveLocationSettings,
} from './save-location';

/**
 * "Also save a copy to…" (#297) settings, on this device only (MMKV key `vidorax.saveLocation.v1`). Kept out of the
 * app settings on purpose: a folder grant belongs to this device, so a settings import from another one must never
 * point copies at a folder that does not exist here.
 */
type SaveLocationState = SaveLocationSettings & {
  dispatch: (action: SaveLocationAction) => void;
};

function settingsOf(state: SaveLocationSettings): SaveLocationSettings {
  return {
    enabled: state.enabled,
    treeUri: state.treeUri,
    folderName: state.folderName,
    byType: state.byType,
    bySite: state.bySite,
    enabledAt: state.enabledAt,
    accessLost: state.accessLost,
  };
}

export const useSaveLocationStore = createStore<SaveLocationState>()(
  persist(
    (set) => ({
      ...DEFAULT_SAVE_LOCATION,
      dispatch: (action) =>
        set((state) => {
          const current = settingsOf(state);
          const next = reduceSaveLocation(current, action);
          return next === current ? state : next;
        }),
    }),
    {
      name: 'vidorax.saveLocation.v1',
      storage: createPersistStorage<SaveLocationSettings>(),
      partialize: (state) => settingsOf(state),
      merge: (persisted, current) => ({ ...current, ...normalizeSaveLocation(persisted) }),
    },
  ),
);

export function getSaveLocationSettings(): SaveLocationSettings {
  return settingsOf(useSaveLocationStore.getState());
}

/**
 * Where each library item's copy went (MMKV key `vidorax.externalCopies.v1`): written once per finished copy, never
 * per progress tick. Forgetting a record never touches the copy itself.
 */
type ExternalCopiesState = {
  records: ExternalCopyRecords;
  setRecord: (id: string, record: ExternalCopyRecord) => void;
  forget: (ids: readonly string[]) => void;
};

export const useExternalCopiesStore = createStore<ExternalCopiesState>()(
  persist(
    (set) => ({
      records: {},
      setRecord: (id, record) => set((state) => ({ records: withCopyRecord(state.records, id, record) })),
      forget: (ids) =>
        set((state) => {
          const records = withoutCopyRecords(state.records, ids);
          return records === state.records ? state : { records };
        }),
    }),
    {
      name: 'vidorax.externalCopies.v1',
      storage: createPersistStorage<Pick<ExternalCopiesState, 'records'>>(),
      partialize: (state) => ({ records: state.records }),
      merge: (persisted, current) => ({
        ...current,
        records: normalizeCopyRecords((persisted as { records?: unknown } | null)?.records),
      }),
    },
  ),
);

/** The copy running right now (memory only), for the progress line on that item's details. */
type FolderCopyStatusState = { activeId: string | null };

export const useFolderCopyStatusStore = createStore<FolderCopyStatusState>()(() => ({ activeId: null }));
