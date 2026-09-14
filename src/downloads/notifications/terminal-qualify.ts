/**
 * Phase 7B — pure terminal notification qualification / payload builders.
 * No Expo / RN imports — unit-testable in Node.
 */

export type TerminalNotificationKind = 'COMPLETED' | 'FAILED' | null;

export type QualifyTerminalNotificationInput = {
  previousStatus?: string | null;
  nextStatus: string | null | undefined;
  /** Engine event type when available. */
  eventType?: 'completed' | 'failed' | 'cancelled' | 'status' | 'progress' | string;
  /** True when auto-retry is still scheduled after a failed event. */
  isRetryScheduled?: boolean;
  /** True when catalog hydration / screen mount (not a live transition). */
  isHydrationOrMount?: boolean;
};

/**
 * Qualify whether a status/event should produce a terminal notification.
 * Only real COMPLETED / FAILED transitions qualify — never RETRYING/CANCELLED/hydration.
 */
export function qualifyTerminalNotification(
  input: QualifyTerminalNotificationInput,
): TerminalNotificationKind {
  if (input.isHydrationOrMount) {
    return null;
  }

  if (input.eventType === 'cancelled' || input.eventType === 'progress') {
    return null;
  }

  const next = (input.nextStatus ?? '').toUpperCase();
  const prev = (input.previousStatus ?? '').toUpperCase();

  if (input.eventType === 'completed' || next === 'COMPLETED') {
    if (prev === 'COMPLETED') {
      return null;
    }
    if (next === 'COMPLETED' || input.eventType === 'completed') {
      return 'COMPLETED';
    }
  }

  if (input.eventType === 'failed' || next === 'FAILED') {
    if (input.isRetryScheduled) {
      return null;
    }
    if (next === 'CANCELLED' || next === 'COMPLETED' || next === 'QUEUED' || next === 'DOWNLOADING') {
      return null;
    }
    if (prev === 'FAILED') {
      return null;
    }
    if (next === 'FAILED' || input.eventType === 'failed') {
      return 'FAILED';
    }
  }

  // Transitional states never notify.
  if (
    next === 'RETRYING' ||
    next === 'PAUSED' ||
    next === 'FINALIZING' ||
    next === 'DOWNLOADING' ||
    next === 'QUEUED' ||
    next === 'PREPARING' ||
    next === 'STARTING' ||
    next === 'WAITING_FOR_WIFI' ||
    next === 'CANCELLED'
  ) {
    return null;
  }

  return null;
}

export type SafeNotificationPayload = {
  type: 'DOWNLOAD_DETAILS';
  downloadId: string;
  event: 'COMPLETED' | 'FAILED';
};

const SECRET_KEYS = [
  'cookie',
  'authorization',
  'sourceurl',
  'requestcontext',
  'referer',
  'origin',
  'token',
  'password',
  'otp',
];

/**
 * Build a non-secret notification data payload.
 * Android/Expo may persist this outside process memory.
 */
export function buildSafeNotificationPayload(input: {
  downloadId: string;
  event: 'COMPLETED' | 'FAILED';
  /** Rejected if present — for verifier / defensive checks. */
  forbiddenExtras?: Record<string, unknown>;
}): SafeNotificationPayload {
  const downloadId = input.downloadId.trim();
  if (!downloadId) {
    throw new Error('downloadId required');
  }
  if (input.forbiddenExtras) {
    for (const key of Object.keys(input.forbiddenExtras)) {
      if (SECRET_KEYS.some((s) => key.toLowerCase().includes(s))) {
        throw new Error(`Forbidden notification field: ${key}`);
      }
    }
  }
  return {
    type: 'DOWNLOAD_DETAILS',
    downloadId,
    event: input.event,
  };
}

export function resolveNotificationTarget(input: {
  downloadId: string;
  event: 'COMPLETED' | 'FAILED';
  exists: boolean;
}): { route: 'details' | 'downloads'; downloadId: string | null } {
  if (!input.exists) {
    return { route: 'downloads', downloadId: null };
  }
  return { route: 'details', downloadId: input.downloadId };
}

/**
 * Stable failure reason keys for localization.
 * Never returns raw codes / URLs / stacks — callers translate via i18n.
 */
export type FailureNotificationReasonKey =
  | 'sessionExpired'
  | 'sourceUnavailable'
  | 'fileValidationFailed'
  | 'networkError';

/** Map engine error codes to safe localized reason keys (not display strings). */
export function mapFailureNotificationReason(
  errorCode: string | null | undefined,
): FailureNotificationReasonKey | null {
  const code = (errorCode ?? '').toUpperCase();
  if (!code) {
    return null;
  }
  if (
    code === 'SESSION_EXPIRED' ||
    code === 'SESSION_CONTEXT_LOST' ||
    code === 'SESSION_CHANGED' ||
    code === 'AUTH_ERROR'
  ) {
    return 'sessionExpired';
  }
  if (
    code === 'SOURCE_CHANGED' ||
    code === 'SOURCE_UNAVAILABLE' ||
    code === 'INVALID_RESOURCE'
  ) {
    return 'sourceUnavailable';
  }
  if (
    code === 'FINAL_FILE_INVALID' ||
    code === 'FINAL_SIZE_MISMATCH' ||
    code === 'PARTIAL_FILE_CORRUPT'
  ) {
    return 'fileValidationFailed';
  }
  if (
    code === 'NETWORK_ERROR' ||
    code === 'NETWORK_TIMEOUT' ||
    code === 'RATE_LIMITED' ||
    code === 'HTTP_ERROR'
  ) {
    return 'networkError';
  }
  // Never return raw codes / URLs / stacks.
  return null;
}

export function failureNotificationReasonTranslationKey(
  reason: FailureNotificationReasonKey,
): `downloads.notifications.reasons.${FailureNotificationReasonKey}` {
  return `downloads.notifications.reasons.${reason}`;
}

export function shouldDeliverTerminalNotification(input: {
  preferenceEnabled: boolean;
  permissionGranted: boolean;
  qualified: TerminalNotificationKind;
  alreadyDelivered: boolean;
}): boolean {
  if (!input.preferenceEnabled || !input.permissionGranted) {
    return false;
  }
  if (!input.qualified) {
    return false;
  }
  if (input.alreadyDelivered) {
    return false;
  }
  return true;
}
