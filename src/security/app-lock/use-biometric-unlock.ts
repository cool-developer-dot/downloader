import { useEffect, useState } from 'react';

import { useAppLockStore } from './app-lock.store';
import { getBiometricPort } from './biometric-port';
import {
  authenticateWithBiometrics,
  isBiometricUnlockAvailable,
  type BiometricOutcome,
} from './biometric-unlock';

/** Whether this device can unlock with strong biometrics (checked once per mount; false until known). */
export function useBiometricAvailability(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void getBiometricPort()
      .then(isBiometricUnlockAvailable)
      .then((value) => {
        if (alive) {
          setAvailable(value);
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

/** The system prompt alone (Settings' confirmation, the Private section's own unlock). Never throws. */
export async function promptBiometrics(texts: { promptMessage: string; cancelLabel: string }): Promise<BiometricOutcome> {
  return authenticateWithBiometrics(await getBiometricPort(), texts);
}

/** The App Lock screen: the prompt, then the store's unlock (the PIN's throttle untouched). Never throws. */
export async function unlockAppLockWithBiometrics(texts: {
  promptMessage: string;
  cancelLabel: string;
}): Promise<BiometricOutcome> {
  let outcome: BiometricOutcome = 'failed';
  await useAppLockStore.getState().unlockWithBiometric(async () => {
    outcome = await promptBiometrics(texts);
    return outcome === 'success';
  });
  return outcome;
}
