/**
 * Phase 7B — completed-file action errors (usage actions, not transfer states).
 */

export type CompletedFileActionErrorCode =
  | 'FILE_MISSING'
  | 'FILE_UNREADABLE'
  | 'NOT_COMPLETED'
  | 'URI_CREATION_FAILED'
  | 'NO_COMPATIBLE_APP'
  | 'OPEN_FAILED'
  | 'SHARE_FAILED'
  | 'PATH_REJECTED'
  | 'UNSUPPORTED';

export class CompletedFileActionError extends Error {
  readonly code: CompletedFileActionErrorCode;

  constructor(code: CompletedFileActionErrorCode, message: string) {
    super(message);
    this.name = 'CompletedFileActionError';
    this.code = code;
  }
}

export function mapCompletedActionError(
  error: unknown,
): CompletedFileActionError {
  if (error instanceof CompletedFileActionError) {
    return error;
  }

  const code =
    typeof error === 'object' &&
    error != null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : typeof error === 'object' &&
          error != null &&
          'message' in error &&
          typeof (error as { message: unknown }).message === 'string'
        ? (error as { message: string }).message
        : error instanceof Error
          ? error.message
          : '';

  const normalized = code.toUpperCase();
  if (
    normalized.includes('NO_COMPATIBLE_APP') ||
    normalized.includes('ACTIVITY_NOT_FOUND')
  ) {
    return new CompletedFileActionError(
      'NO_COMPATIBLE_APP',
      'No compatible video app is installed.',
    );
  }
  if (
    normalized.includes('PARTIAL_FILE_MISSING') ||
    normalized.includes('FILE_MISSING') ||
    (normalized.includes('MISSING') && !normalized.includes('PERMISSION'))
  ) {
    return new CompletedFileActionError(
      'FILE_MISSING',
      "Downloaded file couldn't be found.",
    );
  }
  if (
    normalized.includes('FILE_UNREADABLE') ||
    normalized.includes('FINAL_FILE_INVALID') ||
    normalized.includes('UNREADABLE') ||
    normalized.includes('CORRUPT')
  ) {
    return new CompletedFileActionError(
      'FILE_UNREADABLE',
      "VidoraX couldn't open this downloaded file.",
    );
  }
  if (normalized.includes('URI_CREATION') || normalized.includes('CONTENT')) {
    return new CompletedFileActionError(
      'URI_CREATION_FAILED',
      'Unable to prepare this file for sharing.',
    );
  }
  if (normalized.includes('PATH') || normalized.includes('INVALID_DESTINATION')) {
    return new CompletedFileActionError(
      'PATH_REJECTED',
      'This file cannot be shared from here.',
    );
  }
  if (normalized.includes('SHARE')) {
    return new CompletedFileActionError(
      'SHARE_FAILED',
      'Unable to share this video.',
    );
  }
  return new CompletedFileActionError(
    'OPEN_FAILED',
    "VidoraX couldn't open this downloaded file.",
  );
}

/** Localization key hints for UI layers — never hard-code product copy in services. */
export function completedActionErrorMessageKey(
  code: CompletedFileActionErrorCode,
): string {
  switch (code) {
    case 'FILE_MISSING':
      return 'files.unavailable';
    case 'FILE_UNREADABLE':
      return 'files.unreadable';
    case 'NO_COMPATIBLE_APP':
      return 'files.noCompatibleApp';
    case 'SHARE_FAILED':
      return 'files.shareFailed';
    case 'URI_CREATION_FAILED':
    case 'PATH_REJECTED':
      return 'files.uriFailed';
    case 'NOT_COMPLETED':
      return 'files.notCompleted';
    default:
      return 'files.openFailed';
  }
}
