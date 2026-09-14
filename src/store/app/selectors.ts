import type { AppStore } from './types';

export const selectAppInitialized = (state: AppStore) => state.initialized;
export const selectAppLoading = (state: AppStore) => state.loading;
export const selectAppFirstLaunch = (state: AppStore) => state.firstLaunch;
/** Persisted first-time onboarding flag (`hasCompletedOnboarding` in product spec). */
export const selectOnboardingComplete = (state: AppStore) => state.onboardingComplete;
export const selectHasCompletedOnboarding = selectOnboardingComplete;
export const selectAppOnline = (state: AppStore) => state.online;
export const selectAppMaintenanceMode = (state: AppStore) => state.maintenanceMode;
export const selectAppVersion = (state: AppStore) => state.appVersion;
