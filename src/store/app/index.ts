import { persist } from 'zustand/middleware';

import { storageKeys } from '@/constants';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import { createAppActions } from './actions';
import { hydrationGuardedStorage } from './persist-guard';
import { unwrapPersistedAppState } from './persist';
import { initialAppState } from './state';
import type { AppState, AppStore } from './types';

type PersistedAppFields = Pick<AppState, 'firstLaunch' | 'onboardingComplete'>;

const guarded = hydrationGuardedStorage<PersistedAppFields>(
  createPersistStorage<PersistedAppFields>(),
);

export const useAppStore = createStore<AppStore>()(
  persist(
    (set) => ({
      ...initialAppState,
      ...createAppActions(set),
    }),
    {
      name: storageKeys.app,
      // Zustand persists the slice on every set, so an early `setLoading` would write the defaults over the
      // user's real `onboardingComplete` before it has been read back. Writes wait for hydration.
      storage: guarded.storage,
      skipHydration: true,
      onRehydrateStorage: () => guarded.onHydrated,
      partialize: (state): Pick<AppState, 'firstLaunch' | 'onboardingComplete'> => ({
        firstLaunch: state.firstLaunch,
        onboardingComplete: state.onboardingComplete,
      }),
      merge: (persistedState, currentState) => {
        const persisted = unwrapPersistedAppState(persistedState);

        return {
          ...currentState,
          ...persisted,
          onboardingComplete: persisted.onboardingComplete === true,
          firstLaunch: persisted.firstLaunch !== false,
        };
      },
    },
  ),
);

export * from './selectors';
export type { AppActions, AppState, AppStore } from './types';
