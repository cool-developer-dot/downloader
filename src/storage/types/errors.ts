export type StorageErrorCode =
  | 'DATABASE_INIT_FAILED'
  | 'DATABASE_NOT_READY'
  | 'TRANSACTION_FAILED'
  | 'QUERY_FAILED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'MMKV_UNAVAILABLE'
  | 'UNKNOWN';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: StorageErrorCode, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

export function toStorageError(
  error: unknown,
  fallbackMessage: string,
  code: StorageErrorCode = 'UNKNOWN',
): StorageError {
  if (error instanceof StorageError) {
    return error;
  }

  if (error instanceof Error) {
    return new StorageError(error.message || fallbackMessage, code, error);
  }

  return new StorageError(fallbackMessage, code, error);
}
