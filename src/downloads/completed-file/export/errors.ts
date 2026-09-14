/**
 * Phase 7C — export / delete error model (pure).
 */

export type CompletedFileExportErrorCode =
  | 'FILE_MISSING'
  | 'NOT_COMPLETED'
  | 'INVALID_MANAGED_PATH'
  | 'UNSUPPORTED_EXPORT_DESTINATION'
  | 'MEDIASTORE_INSERT_FAILED'
  | 'OUTPUT_STREAM_UNAVAILABLE'
  | 'COPY_IO_FAILED'
  | 'INSUFFICIENT_STORAGE'
  | 'COPY_SIZE_MISMATCH'
  | 'MEDIASTORE_PUBLISH_FAILED'
  | 'LEGACY_EXPORT_CANCELLED'
  | 'LEGACY_EXPORT_FAILED'
  | 'EXPORT_IN_PROGRESS'
  | 'ALREADY_EXPORTED'
  | 'DELETE_IN_PROGRESS'
  | 'DELETE_FILE_FAILED'
  | 'DELETE_CATALOG_FAILED'
  | 'NATIVE_UNAVAILABLE'
  | 'UNKNOWN';

export class CompletedFileExportError extends Error {
  readonly code: CompletedFileExportErrorCode;

  constructor(code: CompletedFileExportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CompletedFileExportError';
    this.code = code;
  }
}

export function mapExportErrorMessageKey(
  code: CompletedFileExportErrorCode,
): string {
  switch (code) {
    case 'FILE_MISSING':
      return 'library.fileUnavailable';
    case 'INSUFFICIENT_STORAGE':
      return 'downloads.export.notEnoughStorage';
    case 'LEGACY_EXPORT_CANCELLED':
      return 'downloads.export.cancelled';
    case 'ALREADY_EXPORTED':
      return 'downloads.export.alreadySaved';
    case 'DELETE_FILE_FAILED':
    case 'DELETE_CATALOG_FAILED':
      return 'library.deleteFailed';
    default:
      return 'downloads.export.unableToSave';
  }
}

export function isBenignExportCancellation(
  code: CompletedFileExportErrorCode,
): boolean {
  return code === 'LEGACY_EXPORT_CANCELLED';
}
