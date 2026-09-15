import type { DownloadErrorCode } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { TranslationKey } from '@/localization/types';

export interface DownloadFailure {
  messageKey: TranslationKey;
  /** A retry can plausibly succeed (transient cause, or cookies refreshed by native). */
  retryable: boolean;
  /** The source link is stale or gone: the user should open the page again. */
  reopenPage: boolean;
}

const FAILURES: Record<DownloadErrorCode, DownloadFailure> = {
  NETWORK: { messageKey: 'media.failure.network', retryable: true, reopenPage: false },
  HTTP_403: { messageKey: 'media.failure.forbidden', retryable: true, reopenPage: true },
  HTTP_404: { messageKey: 'media.failure.notFound', retryable: false, reopenPage: true },
  HTTP_ERROR: { messageKey: 'media.failure.server', retryable: true, reopenPage: false },
  SOURCE_EXPIRED: { messageKey: 'media.failure.expired', retryable: false, reopenPage: true },
  DRM_PROTECTED: { messageKey: 'media.failure.drm', retryable: false, reopenPage: false },
  LIVE_UNSUPPORTED: { messageKey: 'media.failure.live', retryable: false, reopenPage: false },
  UNSUPPORTED_FORMAT: { messageKey: 'media.failure.unsupported', retryable: false, reopenPage: false },
  NOT_MEDIA: { messageKey: 'media.failure.notMedia', retryable: true, reopenPage: true },
  PROCESSING_FAILED: { messageKey: 'media.failure.processing', retryable: true, reopenPage: false },
  NO_SPACE: { messageKey: 'media.failure.noSpace', retryable: true, reopenPage: false },
  STORAGE_ERROR: { messageKey: 'media.failure.storage', retryable: true, reopenPage: false },
  UNKNOWN: { messageKey: 'media.failure.unknown', retryable: true, reopenPage: false },
};

export function describeDownloadFailure(code: DownloadErrorCode | null): DownloadFailure {
  // Codes arrive from native at runtime; an unrecognised one falls back instead of crashing a row.
  return (code && FAILURES[code]) || FAILURES.UNKNOWN;
}

/** Message for a rejected VidoraMedia call, by its `code` (see the contract header). */
export function actionErrorMessageKey(code: string | null): TranslationKey {
  switch (code) {
    case 'ERR_STORAGE_PERMISSION':
      return 'media.errors.storagePermission';
    case 'ERR_NOT_FOUND':
      return 'media.errors.notFound';
    case 'ERR_RUNNER_START':
      return 'media.errors.runnerStart';
    default:
      return 'media.errors.generic';
  }
}
