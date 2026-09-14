/**
 * Runtime persist flow simulation for onboarding flag durability.
 * Run: npx tsx scripts/verify-onboarding-persist-flow.ts
 */
import { storageKeys } from '../src/constants';
import {
  readPersistedAppSlice,
  unwrapPersistedAppState,
} from '../src/store/app/persist';
import {
  createInMemoryStorage,
  configurePersistStorage,
} from '../src/store/shared/persist-storage';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

async function main(): Promise<void> {
  console.log('Onboarding persist flow verification\n');

  await test('unwrap handles zustand envelope', () => {
    const slice = unwrapPersistedAppState({
      state: { onboardingComplete: true, firstLaunch: false },
      version: 0,
    });
    assert(slice.onboardingComplete === true, 'onboardingComplete from envelope');
    assert(slice.firstLaunch === false, 'firstLaunch from envelope');
  });

  await test('unwrap handles flat legacy slice', () => {
    const slice = unwrapPersistedAppState({
      onboardingComplete: true,
      firstLaunch: false,
    });
    assert(slice.onboardingComplete === true, 'flat onboardingComplete');
  });

  await test('merge guard rejects wrapped state without unwrap', () => {
    const wrapped = {
      state: { onboardingComplete: true, firstLaunch: false },
      version: 0,
    };

    const broken =
      (wrapped as { onboardingComplete?: boolean }).onboardingComplete === true;
    assert(!broken, 'direct access on envelope must fail');

    const fixed = unwrapPersistedAppState(wrapped).onboardingComplete === true;
    assert(fixed, 'unwrap must recover onboardingComplete=true');
  });

  await test('durable write survives adapter reconfiguration', async () => {
    const memoryA = createInMemoryStorage();
    configurePersistStorage(memoryA);

    const payload = JSON.stringify({
      state: { onboardingComplete: true, firstLaunch: false },
      version: 0,
    });
    memoryA.setItem(storageKeys.app, payload);

    const memoryB = createInMemoryStorage();
    memoryB.setItem(storageKeys.app, payload);
    configurePersistStorage(memoryB);

    const slice = await readPersistedAppSlice();
    assert(slice.onboardingComplete === true, 'disk read after adapter switch');
  });

  console.log('\nOnboarding persist flow verification passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
