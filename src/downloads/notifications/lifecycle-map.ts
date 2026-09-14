/**
 * Pure download-state → notification presentation mapping.
 * Presentation only — does not invent engine states.
 */

export type NotificationLifecycleKind =
  | 'progress'
  | 'paused'
  | 'waiting'
  | 'retrying'
  | 'starting'
  | 'completed'
  | 'failed'
  | 'dismiss'
  | 'suppress';

export type NotificationPresentation = {
  kind: NotificationLifecycleKind;
  /** Localization key under downloads.notifications.* */
  titleKey:
    | 'downloadingTitle'
    | 'preparingTitle'
    | 'waitingWifiTitle'
    | 'pausedTitle'
    | 'retryingTitle'
    | 'completedTitle'
    | 'failedTitle';
  sticky: boolean;
  showProgress: boolean;
  /** When showProgress and total known — use determinate bar / percent. */
  indeterminate: boolean;
};

/**
 * Map canonical download status to notification presentation.
 * FINALIZING stays sticky progress (never success).
 * CANCELLED / removed → dismiss.
 * COMPLETED / FAILED → terminal.
 */
export function mapDownloadStatusToNotification(
  status: string | null | undefined,
): NotificationPresentation | { kind: 'dismiss' | 'suppress' } {
  const s = (status ?? '').toUpperCase();

  switch (s) {
    case 'PREPARING':
    case 'STARTING':
    case 'QUEUED':
      return {
        kind: 'starting',
        titleKey: 'preparingTitle',
        sticky: true,
        showProgress: true,
        indeterminate: true,
      };
    case 'WAITING_FOR_WIFI':
      return {
        kind: 'waiting',
        titleKey: 'waitingWifiTitle',
        sticky: true,
        showProgress: true,
        indeterminate: true,
      };
    case 'DOWNLOADING':
      return {
        kind: 'progress',
        titleKey: 'downloadingTitle',
        sticky: true,
        showProgress: true,
        indeterminate: false,
      };
    case 'FINALIZING':
      return {
        kind: 'progress',
        titleKey: 'preparingTitle',
        sticky: true,
        showProgress: true,
        indeterminate: true,
      };
    case 'PAUSED':
      return {
        kind: 'paused',
        titleKey: 'pausedTitle',
        sticky: true,
        showProgress: false,
        indeterminate: true,
      };
    case 'RETRYING':
      return {
        kind: 'retrying',
        titleKey: 'retryingTitle',
        sticky: true,
        showProgress: true,
        indeterminate: true,
      };
    case 'COMPLETED':
      return {
        kind: 'completed',
        titleKey: 'completedTitle',
        sticky: false,
        showProgress: false,
        indeterminate: true,
      };
    case 'FAILED':
      return {
        kind: 'failed',
        titleKey: 'failedTitle',
        sticky: false,
        showProgress: false,
        indeterminate: true,
      };
    case 'CANCELLED':
      return { kind: 'dismiss' };
    default:
      return { kind: 'suppress' };
  }
}

/** Progress presentation throttle policy (pure). */
export const PROGRESS_NOTIFICATION_MIN_INTERVAL_MS = 1000;

export function shouldPublishProgressTick(input: {
  previousPercent: number | null;
  nextPercent: number | null;
  previousIndeterminate: boolean;
  nextIndeterminate: boolean;
  lastPublishedAt: number;
  now: number;
  force?: boolean;
}): boolean {
  if (input.force) {
    return true;
  }
  if (input.previousIndeterminate !== input.nextIndeterminate) {
    return true;
  }
  if (
    !input.nextIndeterminate &&
    input.previousPercent !== input.nextPercent
  ) {
    return true;
  }
  return input.now - input.lastPublishedAt >= PROGRESS_NOTIFICATION_MIN_INTERVAL_MS;
}
