import { persist } from 'zustand/middleware';

import { storageKeys } from '@/constants';
import { downloadCatalogRepository } from '@/storage/repositories';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';
import { useDownloadsStore } from '@/store/downloads';

type FolderId = string | null;

type FolderAssignmentsState = {
  /**
   * Effective folder assignment cache for offline-friendly filtering.
   * Catalog `folder_id` is durable authority; this speeds UI updates.
   */
  folderIdByMediaId: Record<string, FolderId>;
};

type FolderAssignmentsRuntimeState = {
  mutationSeqByMediaId: Record<string, number>;
  pendingByMediaId: Record<string, boolean>;
  inFlightDesiredByMediaId: Record<string, FolderId>;
};

type FolderAssignmentsActions = {
  getEffectiveFolderId: (mediaId: string, fallbackFolderId: FolderId) => FolderId;
  isFolderMutationPending: (mediaId: string) => boolean;
  syncFromRemoteAssignments: (assignments: Record<string, FolderId>) => void;
  moveMediaToFolder: (input: {
    mediaId: string;
    desiredFolderId: FolderId;
    fallbackFolderId: FolderId;
  }) => Promise<{ folderId: FolderId; source: 'optimistic' | 'server' }>;
  reset: () => void;
};

export type MediaFolderAssignmentsStore = FolderAssignmentsState &
  FolderAssignmentsRuntimeState &
  FolderAssignmentsActions;

const initialState: FolderAssignmentsState & FolderAssignmentsRuntimeState = {
  folderIdByMediaId: {},
  mutationSeqByMediaId: {},
  pendingByMediaId: {},
  inFlightDesiredByMediaId: {},
};

export const useMediaFolderAssignmentsStore =
  createStore<MediaFolderAssignmentsStore>()(
    persist(
      (set, get) => ({
        ...initialState,

        getEffectiveFolderId: (mediaId: string, fallbackFolderId: FolderId) => {
          if (
            Object.prototype.hasOwnProperty.call(
              get().folderIdByMediaId,
              mediaId,
            )
          ) {
            return get().folderIdByMediaId[mediaId] as FolderId;
          }
          return fallbackFolderId;
        },

        isFolderMutationPending: (mediaId: string) =>
          Boolean(get().pendingByMediaId[mediaId]),

        syncFromRemoteAssignments: (assignments: Record<string, FolderId>) => {
          const current = get().folderIdByMediaId;
          const pending = get().pendingByMediaId;

          const next = { ...current };
          for (const [mediaId, folderId] of Object.entries(assignments)) {
            if (pending[mediaId]) continue;
            next[mediaId] = folderId;
          }

          set({ folderIdByMediaId: next });
        },

        moveMediaToFolder: async ({
          mediaId,
          desiredFolderId,
          fallbackFolderId,
        }) => {
          const currentEffective = get().getEffectiveFolderId(
            mediaId,
            fallbackFolderId,
          );

          if (currentEffective === desiredFolderId) {
            const pending = get().pendingByMediaId[mediaId];
            if (
              pending &&
              get().inFlightDesiredByMediaId[mediaId] === desiredFolderId
            ) {
              return { folderId: desiredFolderId, source: 'optimistic' };
            }
          }

          const nextSeq = (get().mutationSeqByMediaId[mediaId] ?? 0) + 1;

          set((s) => ({
            mutationSeqByMediaId: {
              ...s.mutationSeqByMediaId,
              [mediaId]: nextSeq,
            },
            pendingByMediaId: { ...s.pendingByMediaId, [mediaId]: true },
            inFlightDesiredByMediaId: {
              ...s.inFlightDesiredByMediaId,
              [mediaId]: desiredFolderId,
            },
            folderIdByMediaId: {
              ...s.folderIdByMediaId,
              [mediaId]: desiredFolderId,
            },
          }));

          try {
            await downloadCatalogRepository.setFolderId(mediaId, desiredFolderId);
            useDownloadsStore.getState().patchItem(mediaId, {
              folderId: desiredFolderId,
            });

            const latestSeq = get().mutationSeqByMediaId[mediaId];
            if (latestSeq !== nextSeq) {
              return { folderId: desiredFolderId, source: 'optimistic' };
            }

            set((s) => ({
              pendingByMediaId: { ...s.pendingByMediaId, [mediaId]: false },
              inFlightDesiredByMediaId: {
                ...s.inFlightDesiredByMediaId,
                [mediaId]: desiredFolderId,
              },
              folderIdByMediaId: {
                ...s.folderIdByMediaId,
                [mediaId]: desiredFolderId,
              },
            }));

            return { folderId: desiredFolderId, source: 'optimistic' };
          } catch (error) {
            const latestSeq = get().mutationSeqByMediaId[mediaId];
            if (latestSeq === nextSeq) {
              set((s) => ({
                pendingByMediaId: { ...s.pendingByMediaId, [mediaId]: false },
                folderIdByMediaId: {
                  ...s.folderIdByMediaId,
                  [mediaId]: currentEffective,
                },
              }));
            }
            throw error;
          }
        },

        reset: () => {
          set({ ...initialState });
        },
      }),
      {
        name: storageKeys.mediaFolderAssignments,
        storage: createPersistStorage<FolderAssignmentsState>(),
        partialize: (state): FolderAssignmentsState => ({
          folderIdByMediaId: state.folderIdByMediaId,
        }),
      },
    ),
  );

export const selectEffectiveFolderId =
  (mediaId: string, fallbackFolderId: FolderId) =>
  (state: MediaFolderAssignmentsStore) =>
    state.getEffectiveFolderId(mediaId, fallbackFolderId);
