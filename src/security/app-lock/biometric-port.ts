import type { BiometricPort } from './biometric-unlock';

let override: BiometricPort | null | undefined;
let loaded: Promise<BiometricPort | null> | null = null;

/**
 * `expo-local-authentication`, loaded on first use (the lock screen and Settings ask only when the option matters).
 * Null when the native module is not in this build: the option is then never shown.
 */
export function getBiometricPort(): Promise<BiometricPort | null> {
  if (override !== undefined) {
    return Promise.resolve(override);
  }
  if (!loaded) {
    loaded = import('expo-local-authentication')
      .then((module) => module as unknown as BiometricPort)
      .catch(() => null);
  }
  return loaded;
}

/** `undefined` restores the real module. */
export function setBiometricPortForTests(port: BiometricPort | null | undefined): void {
  override = port;
}
