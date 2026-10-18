/**
 * The existing "Download notifications" setting also controls the v2 engine's notifications (native runner). Off:
 * finished and failed downloads post nothing, and no download has a notification of its own; the one notification
 * Android requires while downloads run is kept, only minimized. The native side keeps the value, so a download
 * that resumes before JavaScript runs obeys it too. A build without the native function is left as it was.
 */

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

export type NotificationTogglePort = {
  setDownloadNotificationsEnabled(enabled: boolean): Promise<void>;
};

let override: NotificationTogglePort | null | undefined;

export function getNotificationTogglePort(): NotificationTogglePort | null {
  if (override !== undefined) {
    return override;
  }
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<NotificationTogglePort>;
  return typeof media.setDownloadNotificationsEnabled === 'function' ? (media as NotificationTogglePort) : null;
}

/** `undefined` restores the real module. */
export function setNotificationTogglePortForTests(port: NotificationTogglePort | null | undefined): void {
  override = port;
}

let lastPushed: boolean | null = null;

export function resetNotificationToggleForTests(): void {
  lastPushed = null;
}

/** Pushes the value when it changed; a failure is retried with the next change and never blocks the app. */
export async function pushNotificationToggle(port: NotificationTogglePort | null, enabled: boolean): Promise<boolean> {
  if (!port || lastPushed === enabled) {
    return false;
  }
  try {
    await port.setDownloadNotificationsEnabled(enabled);
    lastPushed = enabled;
    return true;
  } catch {
    return false;
  }
}
