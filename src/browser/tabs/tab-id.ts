import * as Crypto from 'expo-crypto';

/** Synchronous local tab identity — stable across reorder / persist. */
export function createTabId(): string {
  return Crypto.randomUUID();
}
