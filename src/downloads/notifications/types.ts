/**
 * Phase 3 — download notification types.
 * Local-device only. Never persisted to PostgreSQL.
 */

export type DownloadNotificationEventType = 'COMPLETED' | 'FAILED';

export type DownloadNotificationPayload = {
  type: 'DOWNLOAD_DETAILS';
  downloadId: string;
  /** Optional terminal kind — never secrets. */
  event?: 'COMPLETED' | 'FAILED';
};

export type FgsNotificationSummary = {
  activeCount: number;
  waitingCount: number;
  /** Safe display title for single-active case (filename/title only). */
  title: string | null;
  /** 0–100 when determinate; null when indeterminate / unavailable. */
  progressPercent: number | null;
  bytesDownloaded: number | null;
  totalBytes: number | null;
  indeterminate: boolean;
};

export type NotificationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'unavailable';

export type EffectiveNotificationsState = {
  preferenceEnabled: boolean;
  permissionStatus: NotificationPermissionStatus;
  permissionGranted: boolean;
  effectiveEnabled: boolean;
  canAskAgain: boolean;
};

export const FGS_NOTIFICATION_CHANNEL_ID = 'vidorax_downloads_fgs';
export const EVENT_NOTIFICATION_CHANNEL_ID = 'vidorax_download_events';
export const FGS_NOTIFICATION_ID = 77021;

/** Throttle window for FGS summary bridge updates (ms). */
export const FGS_SUMMARY_THROTTLE_MS = 750;
