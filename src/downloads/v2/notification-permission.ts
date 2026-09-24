/**
 * POST_NOTIFICATIONS for the native download notifications (Android 13+). The permission is never a gate: a
 * denied prompt only means Android will not show the runner's notifications — the transfer itself, and the
 * Downloads screen, are unaffected.
 */

import * as ReactNative from 'react-native';

import { logV2Download } from './diagnostics';

export type NotificationPermissionDecision = 'not-required' | 'granted' | 'ask' | 'denied';

/** Android asks for POST_NOTIFICATIONS from 13 (API 33); before that the notification is simply allowed. */
export function decideNotificationPermission(input: {
  platform: string;
  version: number | string;
  granted: boolean;
  alreadyAsked: boolean;
}): NotificationPermissionDecision {
  if (input.platform !== 'android') {
    return 'not-required';
  }
  if (typeof input.version === 'number' && input.version < 33) {
    return 'not-required';
  }
  if (input.granted) {
    return 'granted';
  }
  // One prompt per app run: Android silently refuses a second one, and re-asking on every tap is noise.
  return input.alreadyAsked ? 'denied' : 'ask';
}

let asked = false;

export function resetNotificationPermissionPromptForTests(): void {
  asked = false;
}

/**
 * Asks once, from the user gesture that started a download. Returns what actually happened; never throws and
 * never blocks the download.
 */
export async function ensureDownloadNotificationPermission(): Promise<NotificationPermissionDecision> {
  try {
    const permissions = ReactNative.PermissionsAndroid;
    const name = permissions?.PERMISSIONS?.POST_NOTIFICATIONS;
    if (!permissions || !name) {
      return 'not-required';
    }
    const granted = await permissions.check(name).catch(() => false);
    const decision = decideNotificationPermission({
      platform: ReactNative.Platform.OS,
      version: ReactNative.Platform.Version,
      granted,
      alreadyAsked: asked,
    });
    if (decision !== 'ask') {
      return decision;
    }
    asked = true;
    const result = await permissions.request(name);
    const outcome: NotificationPermissionDecision =
      result === permissions.RESULTS.GRANTED ? 'granted' : 'denied';
    logV2Download('notification_permission', { state: outcome });
    return outcome;
  } catch {
    // No PermissionsAndroid (or no native module): nothing to ask for, nothing to break.
    return 'not-required';
  }
}
