import type { StoreApi } from 'zustand';

import { initialAppState } from './state';
import type { AppActions, AppStore } from './types';

export function createAppActions(
  set: StoreApi<AppStore>['setState'],
): AppActions {
  return {
    initialize: () => {
      set({ initialized: true, loading: false });
    },
    setLoading: (loading) => {
      set({ loading });
    },
    setOnline: (online) => {
      set({ online });
    },
    completeOnboarding: () => {
      // Persisted as `onboardingComplete` — product alias: hasCompletedOnboarding.
      set({ onboardingComplete: true, firstLaunch: false });
    },
    reset: () => {
      set(initialAppState);
    },
  };
}
