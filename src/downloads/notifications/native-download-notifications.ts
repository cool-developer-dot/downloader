/**
 * Optional native NotificationManager bridge for per-download progress bars.
 * Falls back to expo-notifications when module is absent.
 *
 * React Native is required lazily so Node/tsx static verifiers can import
 * DownloadNotificationService without transforming react-native.
 */

type NativeShape = {
  ensureChannels: () => Promise<boolean>;
  upsertProgress: (
    downloadId: string,
    notificationId: number,
    title: string,
    body: string,
    progressPercent: number | null,
    indeterminate: boolean,
    sticky: boolean,
  ) => Promise<boolean>;
  notifyTerminal: (
    downloadId: string,
    notificationId: number,
    title: string,
    body: string,
  ) => Promise<boolean>;
  dismiss: (notificationId: number) => Promise<boolean>;
};

function getNative(): NativeShape | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules, Platform } = require('react-native') as {
      NativeModules: { VidoraDownloadNotifications?: NativeShape };
      Platform: { OS?: string };
    };
    if (Platform.OS !== 'android') {
      return null;
    }
    const mod = NativeModules.VidoraDownloadNotifications;
    if (
      !mod ||
      typeof mod.upsertProgress !== 'function' ||
      typeof mod.notifyTerminal !== 'function' ||
      typeof mod.dismiss !== 'function'
    ) {
      return null;
    }
    return mod;
  } catch {
    return null;
  }
}

export function isNativeDownloadNotificationsAvailable(): boolean {
  return getNative() != null;
}

export async function nativeEnsureChannels(): Promise<boolean> {
  const native = getNative();
  if (!native?.ensureChannels) {
    return false;
  }
  try {
    return Boolean(await native.ensureChannels());
  } catch {
    return false;
  }
}

export async function nativeUpsertProgress(input: {
  downloadId: string;
  notificationId: number;
  title: string;
  body: string;
  progressPercent: number | null;
  indeterminate: boolean;
  sticky: boolean;
}): Promise<boolean> {
  const native = getNative();
  if (!native) {
    return false;
  }
  try {
    return Boolean(
      await native.upsertProgress(
        input.downloadId,
        input.notificationId,
        input.title,
        input.body,
        input.progressPercent,
        input.indeterminate,
        input.sticky,
      ),
    );
  } catch {
    return false;
  }
}

export async function nativeNotifyTerminal(input: {
  downloadId: string;
  notificationId: number;
  title: string;
  body: string;
}): Promise<boolean> {
  const native = getNative();
  if (!native) {
    return false;
  }
  try {
    return Boolean(
      await native.notifyTerminal(
        input.downloadId,
        input.notificationId,
        input.title,
        input.body,
      ),
    );
  } catch {
    return false;
  }
}

export async function nativeDismissNotification(
  notificationId: number,
): Promise<boolean> {
  const native = getNative();
  if (!native) {
    return false;
  }
  try {
    return Boolean(await native.dismiss(notificationId));
  } catch {
    return false;
  }
}
