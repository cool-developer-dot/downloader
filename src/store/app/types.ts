export interface AppState {
  initialized: boolean;
  loading: boolean;
  firstLaunch: boolean;
  onboardingComplete: boolean;
  online: boolean;
  maintenanceMode: boolean;
  appVersion: string;
}

export interface AppActions {
  initialize: () => void;
  setLoading: (loading: boolean) => void;
  setOnline: (online: boolean) => void;
  completeOnboarding: () => void;
  reset: () => void;
}

export type AppStore = AppState & AppActions;
