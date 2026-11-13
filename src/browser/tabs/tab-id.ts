import * as Crypto from 'expo-crypto';

/** Synchronous local tab identity — stable across reorder / persist. */
export function createTabId(): string {
  return Crypto.randomUUID();
}

/** B11: an incognito tab's id (`shouldPersistForTab` refuses it from the prefix alone). */
export function createIncognitoTabId(): string {
  return `incog-${Crypto.randomUUID()}`;
}
