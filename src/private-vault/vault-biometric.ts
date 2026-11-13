import type { BiometricOutcome } from '@/security/app-lock/biometric-unlock';

import { withExternalUi } from './external-ui';

/**
 * Private's own unlock with App Lock's "Unlock with fingerprint or face": the system prompt is a screen of this action,
 * so neither Private nor App Lock locks while it is up. The App Lock PIN and its throttling are untouched. Never throws.
 */
export async function unlockPrivateWithBiometrics(prompt: () => Promise<BiometricOutcome>): Promise<BiometricOutcome> {
  try {
    return await withExternalUi(prompt);
  } catch {
    return 'failed';
  }
}
