import { getAppPersistAdapterLabel, readPersistedAppSlice } from '@/store/app/persist';
import { selectOnboardingComplete, useAppStore } from '@/store/app';

const LOG_PREFIX = '[onboarding-persist]';

export async function logOnboardingPersistSnapshot(
  phase: 'bootstrap-after-sync' | 'onboarding-complete' | 'splash-exit',
): Promise<void> {
  if (!__DEV__) {
    return;
  }

  const disk = await readPersistedAppSlice();
  const memory = selectOnboardingComplete(useAppStore.getState());

  console.log(LOG_PREFIX, phase, {
    adapter: getAppPersistAdapterLabel(),
    hydrated: useAppStore.persist.hasHydrated(),
    memoryOnboardingComplete: memory,
    diskOnboardingComplete: disk.onboardingComplete === true,
    diskFirstLaunch: disk.firstLaunch,
    rawDisk: disk,
  });
}
