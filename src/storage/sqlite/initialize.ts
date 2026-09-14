import { getDatabase, getDatabaseInitError, isDatabaseReady } from './client';
import { StorageError } from '@/storage/types';

export interface InitializeSqliteResult {
  ready: boolean;
  error: StorageError | null;
}

/**
 * Opens the local SQLite database and applies migrations.
 * Safe to call multiple times — subsequent calls reuse the same connection.
 */
export async function initializeSqlite(): Promise<InitializeSqliteResult> {
  if (isDatabaseReady()) {
    return { ready: true, error: null };
  }

  try {
    await getDatabase();
    return { ready: true, error: null };
  } catch (error) {
    const storageError =
      error instanceof StorageError
        ? error
        : getDatabaseInitError() ??
          new StorageError(
            'Failed to initialize SQLite',
            'DATABASE_INIT_FAILED',
            error,
          );

    if (__DEV__) {
      console.warn('[storage] SQLite initialization failed:', storageError.message);
    }

    return { ready: false, error: storageError };
  }
}
