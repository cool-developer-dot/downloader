import {
  readPersistedAppSlice,
  type PersistedAppSlice,
} from './persist';
import { useAppStore } from './index';

/**
 * Apply the durable `vidorax.app` slice onto the in-memory store.
 * Covers merge/envelope mismatches and in-memory first-hydrate races.
 */
export async function syncAppStoreFromDisk(): Promise<PersistedAppSlice> {
  const slice = await readPersistedAppSlice();
  const onboardingComplete = slice.onboardingComplete === true;
  const firstLaunch = slice.firstLaunch !== false;

  useAppStore.setState({ onboardingComplete, firstLaunch });

  return { onboardingComplete, firstLaunch };
}

const PERSIST_VERIFY_TIMEOUT_MS = 3_000;
const PERSIST_VERIFY_INTERVAL_MS = 50;

/** Wait until onboardingComplete is durably written before leaving onboarding. */
export async function awaitOnboardingPersisted(): Promise<boolean> {
  const deadline = Date.now() + PERSIST_VERIFY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const slice = await readPersistedAppSlice();
    if (slice.onboardingComplete === true) {
      useAppStore.setState({ onboardingComplete: true, firstLaunch: false });
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, PERSIST_VERIFY_INTERVAL_MS));
  }

  return false;
}
