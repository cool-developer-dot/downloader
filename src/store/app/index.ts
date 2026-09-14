import { persist } from 'zustand/middleware';

import { storageKeys } from '@/constants';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import { createAppActions } from './actions';
import { unwrapPersistedAppState } from './persist';
import { initialAppState } from './state';
import type { AppState, AppStore } from './types';

export const useAppStore = createStore<AppStore>()(
  persist(
    (set) => ({
      ...initialAppState,
      ...createAppActions(set),
    }),
    {
      name: storageKeys.app,
      storage: createPersistStorage(),
      skipHydration: true,
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
