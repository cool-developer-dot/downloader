/**
 * Deterministic notification identity for a download.
 * Expo uses string identifiers; Android NotificationManager uses ints.
 */

import { FGS_NOTIFICATION_ID } from './types';

/** Stable expo / dismiss identifier for the active (in-progress) notification. */
export function activeNotificationIdentifier(downloadId: string): string {
  return `vidorax-dl-active-${downloadId.trim()}`;
}

export function completedNotificationIdentifier(downloadId: string): string {
  return `vidorax-dl-completed-${downloadId.trim()}`;
}

export function failedNotificationIdentifier(downloadId: string): string {
  return `vidorax-dl-failed-${downloadId.trim()}`;
}

/**
 * Stable positive Android notification id derived from downloadId.
 * Avoids FGS_NOTIFICATION_ID collision. Never random per progress tick.
 */
export function androidNotificationIdForDownload(downloadId: string): number {
  const id = downloadId.trim();
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Keep in a safe positive range away from system / FGS ids.
  let notifId = (hash >>> 0) % 900_000_000;
  notifId += 100_000;
  if (notifId === FGS_NOTIFICATION_ID) {
    notifId += 1;
  }
  return notifId;
}
