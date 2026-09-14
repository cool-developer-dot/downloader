import * as SQLite from 'expo-sqlite';

import { DATABASE_NAME } from '@/storage/constants';
import { StorageError, toStorageError } from '@/storage/types';

import { assertDatabaseReady, migrateDatabase } from './migrations';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let databaseInstance: SQLite.SQLiteDatabase | null = null;
let initializationError: StorageError | null = null;

export function getDatabaseOrNull(): SQLite.SQLiteDatabase | null {
  return databaseInstance;
}

export function getDatabaseInitError(): StorageError | null {
  return initializationError;
}

export function isDatabaseReady(): boolean {
  return databaseInstance !== null && initializationError === null;
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (databaseInstance) {
    return databaseInstance;
  }

  if (initializationError) {
    throw initializationError;
  }

  if (!databasePromise) {
    databasePromise = openAndInitializeDatabase();
  }

  return databasePromise;
}

async function openAndInitializeDatabase(): Promise<SQLite.SQLiteDatabase> {
  try {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await migrateDatabase(db);
    await assertDatabaseReady(db);

    databaseInstance = db;
    initializationError = null;
    return db;
  } catch (error) {
    databasePromise = null;
    initializationError = toStorageError(
      error,
      'Failed to initialize local SQLite database',
      'DATABASE_INIT_FAILED',
    );
    throw initializationError;
  }
}

export async function withDatabaseTransaction<T>(
  task: (db: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const db = await getDatabase();

  try {
    let result!: T;

    await db.withTransactionAsync(async () => {
      result = await task(db);
    });

    return result;
  } catch (error) {
    throw toStorageError(error, 'Database transaction failed', 'TRANSACTION_FAILED');
  }
}

export async function resetDatabaseConnection(): Promise<void> {
  if (databaseInstance) {
    try {
      await databaseInstance.closeAsync();
    } catch {
      // Ignore close errors during reset.
    }
  }

  databaseInstance = null;
  databasePromise = null;
  initializationError = null;
}
