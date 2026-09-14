import { persist } from 'zustand/middleware';

import { storageKeys } from '@/constants';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';
import { normalizeThemePreference } from '@/theme/theme-preference';

import { createThemeActions } from './actions';
import { initialThemeState } from './state';
import type { ThemeStore } from './types';

export const useThemeStore = createStore<ThemeStore>()(
  persist(
    (set, get) => ({
      ...initialThemeState,
      ...createThemeActions(set, get),
    }),
    {
      name: storageKeys.themePreference,
      storage: createPersistStorage(),
      partialize: (state) => ({ themeMode: state.themeMode }),
      merge: (persistedState, currentState) => {
        const persisted =
          persistedState && typeof persistedState === 'object'
            ? (persistedState as { themeMode?: unknown; state?: { themeMode?: unknown } })
            : null;
        const raw =
          persisted?.themeMode ??
          persisted?.state?.themeMode ??
          currentState.themeMode;
        return {
          ...currentState,
          themeMode: normalizeThemePreference(raw),
        };
      },
    },
  ),
);

export * from './selectors';
export type { ThemeActions, ThemePreference, ThemeState, ThemeStore } from './types';
