import { environment } from '@/constants';

import type { AppState } from './types';

export const initialAppState: AppState = {
  initialized: false,
  loading: false,
  firstLaunch: true,
  onboardingComplete: false,
  online: true,
  maintenanceMode: false,
  appVersion: environment.version,
};
