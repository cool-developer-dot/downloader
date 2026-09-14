/**
 * One-time cleanup of obsolete auth/session secrets.
 * Does not touch MMKV preferences, SQLite, downloads, library, or playback.
 */

import { storageKeys } from '@/constants';

/** Allowlist of SecureStore keys that may be deleted during Phase 2 cleanup. */
export const OBSOLETE_AUTH_SECURE_KEYS = [
  storageKeys.authToken,
  storageKeys.refreshToken,
  storageKeys.profileSnapshot,
  storageKeys.auth,
] as const;

export type ObsoleteAuthCleanupResult = {
  alreadyComplete: boolean;
  attempted: number;
};

function isCleanupComplete(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const flags = require('@/storage/mmkv/flags') as {
      getAuthSecretsClearedV1: (fallback?: boolean) => boolean;
    };
    return flags.getAuthSecretsClearedV1();
  } catch {
    return false;
  }
}

function markCleanupComplete(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const flags = require('@/storage/mmkv/flags') as {
      setAuthSecretsClearedV1: (value: boolean) => void;
    };
    flags.setAuthSecretsClearedV1(true);
  } catch {
    // Node verify / missing MMKV — next launch retries, which is idempotent.
  }
}

async function deleteSecureKey(key: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require('expo-secure-store') as {
      deleteItemAsync: (k: string) => Promise<void>;
    };
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Missing key or unavailable SecureStore is success for this allowlist.
  }
}

/**
 * Idempotent. Skips SecureStore entirely after the completion flag is set.
 */
export async function cleanupObsoleteAuthSecrets(): Promise<ObsoleteAuthCleanupResult> {
  if (isCleanupComplete()) {
    return { alreadyComplete: true, attempted: 0 };
  }

  for (const key of OBSOLETE_AUTH_SECURE_KEYS) {
    await deleteSecureKey(key);
  }

  markCleanupComplete();
  return {
    alreadyComplete: false,
    attempted: OBSOLETE_AUTH_SECURE_KEYS.length,
  };
}
