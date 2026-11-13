/**
 * App Lock "Unlock with fingerprint or face" (feat/biometric-unlock). Pure: the native side is injected.
 *
 * - Off by default, and offered only when the device can do it: a scanner, something enrolled, and strong (Class 3)
 *   biometrics — weak face unlock (a 2D camera match) is not accepted for App Lock.
 * - It is a shortcut, never a replacement: the PIN always remains, the system's own device-PIN fallback is disabled
 *   (the App Lock PIN is the fallback), and the PIN's attempt throttling is untouched — a biometric unlock neither
 *   resets nor bypasses it for PIN entries.
 * - Used by the App Lock screen and by the Private section's own unlock.
 */

/** The `expo-local-authentication` functions App Lock uses (`biometric-port.ts` binds the real module). */
export type BiometricPort = {
  hasHardwareAsync(): Promise<boolean>;
  isEnrolledAsync(): Promise<boolean>;
  getEnrolledLevelAsync(): Promise<number>;
  authenticateAsync(options: {
    promptMessage?: string;
    cancelLabel?: string;
    disableDeviceFallback?: boolean;
    biometricsSecurityLevel?: 'weak' | 'strong';
    requireConfirmation?: boolean;
  }): Promise<{ success: true } | { success: false; error: string; warning?: string }>;
};

/** `SecurityLevel.BIOMETRIC_STRONG` of expo-local-authentication. */
export const BIOMETRIC_STRONG = 3;

/** Pure-ish: whether this device can unlock App Lock with biometrics right now. Never throws. */
export async function isBiometricUnlockAvailable(port: BiometricPort | null): Promise<boolean> {
  if (!port) {
    return false;
  }
  try {
    const [hardware, enrolled, level] = await Promise.all([
      port.hasHardwareAsync(),
      port.isEnrolledAsync(),
      port.getEnrolledLevelAsync(),
    ]);
    return hardware && enrolled && level >= BIOMETRIC_STRONG;
  } catch {
    return false;
  }
}

/** Pure: whether Settings shows the option (App Lock on, and the device can do it). */
export function showsBiometricSetting(input: { appLockEnabled: boolean; available: boolean }): boolean {
  return input.appLockEnabled && input.available;
}

/** Pure: whether a locked screen offers (and opens once) the biometric prompt. */
export function offersBiometricUnlock(input: {
  settingOn: boolean;
  appLockEnabled: boolean;
  available: boolean;
  locked: boolean;
}): boolean {
  return input.settingOn && input.appLockEnabled && input.available && input.locked;
}

export type BiometricOutcome =
  /** Recognised: unlock. */
  | 'success'
  /** The user chose the PIN, or dismissed the prompt. */
  | 'cancelled'
  /** Too many tries: Android locked biometrics for now; the PIN is the way in. */
  | 'lockout'
  /** Anything else (not available, not enrolled any more, a system error): the PIN is the way in. */
  | 'failed';

export function biometricOutcome(
  result: { success: boolean; error?: string } | null | undefined,
): BiometricOutcome {
  if (result?.success === true) {
    return 'success';
  }
  switch (result?.error) {
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
    case 'user_fallback':
      return 'cancelled';
    case 'lockout':
      return 'lockout';
    default:
      return 'failed';
  }
}

/** Shows the system prompt: strong biometrics only, no device-PIN fallback (the App Lock PIN is). Never throws. */
export async function authenticateWithBiometrics(
  port: BiometricPort | null,
  texts: { promptMessage: string; cancelLabel: string },
): Promise<BiometricOutcome> {
  if (!port) {
    return 'failed';
  }
  try {
    return biometricOutcome(
      await port.authenticateAsync({
        promptMessage: texts.promptMessage,
        cancelLabel: texts.cancelLabel,
        disableDeviceFallback: true,
        biometricsSecurityLevel: 'strong',
      }),
    );
  } catch {
    return 'failed';
  }
}
