/**
 * Permission + effective preference derivation for optional download notifications.
 * FGS operational notification is independent of this layer.
 */

import type {
  EffectiveNotificationsState,
  NotificationPermissionStatus,
} from './types';

export type NotificationPermissionAdapter = {
  getPermissionsAsync: () => Promise<{
    status: NotificationPermissionStatus;
    canAskAgain: boolean;
  }>;
  requestPermissionsAsync: () => Promise<{
    status: NotificationPermissionStatus;
    canAskAgain: boolean;
  }>;
  openSystemSettings?: () => Promise<void>;
};

export function deriveEffectiveNotificationsState(input: {
  preferenceEnabled: boolean;
  permissionStatus: NotificationPermissionStatus;
  canAskAgain: boolean;
}): EffectiveNotificationsState {
  const permissionGranted = input.permissionStatus === 'granted';
  return {
    preferenceEnabled: input.preferenceEnabled,
    permissionStatus: input.permissionStatus,
    permissionGranted,
    effectiveEnabled: input.preferenceEnabled && permissionGranted,
    canAskAgain: input.canAskAgain,
  };
}

/** Map expo-notifications status strings safely. */
export function mapExpoPermissionStatus(
  status: string | null | undefined,
): NotificationPermissionStatus {
  switch (status) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'undetermined':
      return 'undetermined';
    default:
      return 'unavailable';
  }
}
