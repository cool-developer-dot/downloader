/**
 * DownloadNotificationService — single abstraction for optional local notifications.
 * Does NOT own FGS operational notification (that is native VidoraXDownloadService).
 *
 * Never starts downloads. Never schedules. Payload = { type, downloadId } only.
 */

import { mmkvKeys } from '@/storage/constants/mmkv-keys';

import {
  createNotificationDedupeStore,
  canEmitTerminalNotification,
  deserializeDedupeStore,
  markTerminalNotificationEmitted,
  serializeDedupeStore,
  type NotificationDedupeStore,
} from './dedupe';
import {
  buildSafeNotificationPayload,
  failureNotificationReasonTranslationKey,
  mapFailureNotificationReason,
} from './terminal-qualify';
import {
  capturePendingNotificationTarget,
  resolveNotificationNavigation,
} from './deep-link';
import {
  deriveEffectiveNotificationsState,
  mapExpoPermissionStatus,
  type NotificationPermissionAdapter,
} from './permission';
import type {
  DownloadNotificationPayload,
  EffectiveNotificationsState,
  NotificationPermissionStatus,
} from './types';
import { EVENT_NOTIFICATION_CHANNEL_ID } from './types';
import {
  androidNotificationIdForDownload,
  activeNotificationIdentifier,
  completedNotificationIdentifier,
  failedNotificationIdentifier,
} from './notification-id';
import {
  mapDownloadStatusToNotification,
  shouldPublishProgressTick,
  type NotificationPresentation,
} from './lifecycle-map';
import {
  isNativeDownloadNotificationsAvailable,
  nativeDismissNotification,
  nativeEnsureChannels,
  nativeNotifyTerminal,
  nativeUpsertProgress,
} from './native-download-notifications';
import { hardeningLog } from '@/downloads/hardening-diagnostics';

export type LocalNotificationAdapter = {
  ensureEventChannel: () => Promise<void>;
  scheduleNotification: (input: {
    title: string;
    body: string;
    data: DownloadNotificationPayload;
    identifier: string;
    sticky?: boolean;
  }) => Promise<void>;
  dismissNotification: (identifier: string) => Promise<void>;
  getLastNotificationResponse: () => Promise<{
    downloadId: string | null;
  } | null>;
  addResponseListener: (
    handler: (downloadId: string) => void,
  ) => () => void;
};

type ServiceOptions = {
  permissionAdapter?: NotificationPermissionAdapter;
  localAdapter?: LocalNotificationAdapter;
  getPreferenceEnabled?: () => boolean;
};


function defaultPreferenceEnabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { areDownloadNotificationsEnabled } = require('../settings') as {
      areDownloadNotificationsEnabled: () => boolean;
    };
    return areDownloadNotificationsEnabled();
  } catch {
    return false;
  }
}

function readMmkvString(key: string): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMmkvInstance } = require('@/storage/mmkv') as {
      getMmkvInstance: () => { getString: (k: string) => string | undefined } | null;
    };
    return getMmkvInstance()?.getString(key);
  } catch {
    return undefined;
  }
}

function writeMmkvString(key: string, value: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMmkvInstance } = require('@/storage/mmkv') as {
      getMmkvInstance: () => { set: (k: string, v: string) => void } | null;
    };
    getMmkvInstance()?.set(key, value);
  } catch {
    // ignore
  }
}

function isWebPlatform(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native') as { Platform?: { OS?: string } };
    return rn.Platform?.OS === 'web';
  } catch {
    return false;
  }
}

function isAndroidPlatform(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native') as { Platform?: { OS?: string } };
    return rn.Platform?.OS === 'android';
  } catch {
    return false;
  }
}

/**
 * Expo Go throws on Android when `expo-notifications` is imported (push removed in SDK 53).
 * Never load that package in Expo Go — use RN PermissionsAndroid + no-op local adapter.
 */
function isExpoGoRuntime(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expo = require('expo') as { isRunningInExpoGo?: () => boolean };
    if (typeof expo.isRunningInExpoGo === 'function' && expo.isRunningInExpoGo()) {
      return true;
    }
  } catch {
    // continue
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as {
      executionEnvironment?: string;
      appOwnership?: string | null;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExecutionEnvironment } = require('expo-constants') as {
      ExecutionEnvironment?: { StoreClient?: string };
    };
    return (
      Constants.executionEnvironment === ExecutionEnvironment?.StoreClient ||
      Constants.appOwnership === 'expo'
    );
  } catch {
    return false;
  }
}

let singleton: DownloadNotificationService | null = null;

export class DownloadNotificationService {
  private permissionStatus: NotificationPermissionStatus = 'undetermined';
  private canAskAgain = true;
  private channelsReady = false;
  private responseAttached = false;
  private responseUnsub: (() => void) | null = null;
  private dedupe: NotificationDedupeStore;
  private readonly getPreferenceEnabled: () => boolean;
  private permissionAdapter: NotificationPermissionAdapter | null;
  private localAdapter: LocalNotificationAdapter | null;
  /** Per-download last published progress tick (presentation throttle only). */
  private readonly progressTickById = new Map<
    string,
    { percent: number | null; indeterminate: boolean; at: number }
  >();

  constructor(options: ServiceOptions = {}) {
    this.getPreferenceEnabled =
      options.getPreferenceEnabled ?? defaultPreferenceEnabled;
    this.permissionAdapter = options.permissionAdapter ?? null;
    this.localAdapter = options.localAdapter ?? null;
    this.dedupe = loadDedupeFromDisk();
  }

  async initialize(): Promise<void> {
    await this.refreshPermissionState();
    await this.ensureChannels();
    this.attachResponseListenerOnce();
    await this.captureColdStartResponse();
  }

  async refreshPermissionState(): Promise<EffectiveNotificationsState> {
    const adapter = await this.resolvePermissionAdapter();
    if (!adapter) {
      this.permissionStatus = isAndroidPlatform() ? 'undetermined' : 'unavailable';
      this.canAskAgain = false;
      return this.getEffectiveState();
    }
    try {
      const result = await adapter.getPermissionsAsync();
      this.permissionStatus = result.status;
      this.canAskAgain = result.canAskAgain;
    } catch {
      this.permissionStatus = 'unavailable';
      this.canAskAgain = false;
    }
    return this.getEffectiveState();
  }

  getEffectiveState(): EffectiveNotificationsState {
    return deriveEffectiveNotificationsState({
      preferenceEnabled: this.getPreferenceEnabled(),
      permissionStatus: this.permissionStatus,
      canAskAgain: this.canAskAgain,
    });
  }

  /**
   * User toggled preference ON — request OS permission if needed.
   * Never call from bootstrap.
   */
  async enableFromUserGesture(): Promise<EffectiveNotificationsState> {
    await this.refreshPermissionState();
    if (this.permissionStatus === 'granted') {
      return this.getEffectiveState();
    }
    if (!this.canAskAgain) {
      return this.getEffectiveState();
    }
    const adapter = await this.resolvePermissionAdapter();
    if (!adapter) {
      return this.getEffectiveState();
    }
    try {
      const result = await adapter.requestPermissionsAsync();
      this.permissionStatus = result.status;
      this.canAskAgain = result.canAskAgain;
    } catch {
      // leave prior state
    }
    return this.getEffectiveState();
  }

  async openSystemSettings(): Promise<void> {
    const adapter = await this.resolvePermissionAdapter();
    await adapter?.openSystemSettings?.();
  }

  async notifyCompleted(input: {
    downloadId: string;
    title: string;
  }): Promise<boolean> {
    await this.dismissActive(input.downloadId);
    return this.emitTerminal('COMPLETED', input);
  }

  async notifyFailed(input: {
    downloadId: string;
    title: string;
    errorCode?: string | null;
  }): Promise<boolean> {
    await this.dismissActive(input.downloadId);
    return this.emitTerminal('FAILED', input);
  }

  /**
   * Present/update lifecycle notification for an active download.
   * No-op when preference/permission disabled — never blocks transfer.
   */
  async presentLifecycle(input: {
    downloadId: string;
    status: string;
    title: string;
    progressPercent?: number | null;
    totalBytes?: number | null;
    force?: boolean;
  }): Promise<boolean> {
    const downloadId = input.downloadId.trim();
    if (!downloadId) {
      return false;
    }

    const mapped = mapDownloadStatusToNotification(input.status);
    if (mapped.kind === 'suppress') {
      return false;
    }
    if (mapped.kind === 'dismiss') {
      await this.dismissActive(downloadId);
      hardeningLog('DOWNLOAD_NOTIFICATION_CANCELLED', { downloadId });
      return true;
    }
    if (mapped.kind === 'completed' || mapped.kind === 'failed') {
      // Terminal path owns COMPLETED/FAILED — bridge calls notify* separately.
      return false;
    }

    const presentation = mapped as NotificationPresentation;
    const knownTotal =
      typeof input.totalBytes === 'number' &&
      Number.isFinite(input.totalBytes) &&
      input.totalBytes > 0;
    const rawPercent =
      typeof input.progressPercent === 'number' &&
      Number.isFinite(input.progressPercent)
        ? Math.max(0, Math.min(100, Math.floor(input.progressPercent)))
        : null;
    const indeterminate =
      presentation.indeterminate ||
      !knownTotal ||
      presentation.kind === 'starting' ||
      presentation.kind === 'waiting' ||
      presentation.kind === 'retrying' ||
      presentation.kind === 'paused';
    const percent = indeterminate ? null : rawPercent;

    const prev = this.progressTickById.get(downloadId);
    const now = Date.now();
    if (
      !shouldPublishProgressTick({
        previousPercent: prev?.percent ?? null,
        nextPercent: percent,
        previousIndeterminate: prev?.indeterminate ?? true,
        nextIndeterminate: indeterminate,
        lastPublishedAt: prev?.at ?? 0,
        now,
        force: input.force === true || prev == null,
      })
    ) {
      return false;
    }

    if (!(await this.ensurePresentationAllowed('progress'))) {
      return false;
    }

    const safeTitle = sanitizeBodyTitle(input.title);
    const title = translateLifecycleTitle(presentation.titleKey);
    const body =
      !indeterminate && percent != null
        ? `${safeTitle}\n${percent}%`
        : safeTitle;

    const ok = await this.publishActive({
      downloadId,
      title,
      body,
      percent,
      indeterminate,
      sticky: presentation.sticky,
    });
    if (ok) {
      this.progressTickById.set(downloadId, {
        percent,
        indeterminate,
        at: now,
      });
      hardeningLog('DOWNLOAD_NOTIFICATION_PROGRESS', {
        downloadId,
        kind: presentation.kind,
        percent: percent ?? -1,
        indeterminate,
      });
    }
    return ok;
  }

  async dismissActive(downloadId: string): Promise<void> {
    const id = downloadId.trim();
    if (!id) {
      return;
    }
    this.progressTickById.delete(id);
    const androidId = androidNotificationIdForDownload(id);
    if (isNativeDownloadNotificationsAvailable()) {
      await nativeDismissNotification(androidId);
    }
    const adapter = await this.resolveLocalAdapter();
    if (adapter) {
      try {
        await adapter.dismissNotification(activeNotificationIdentifier(id));
      } catch {
        // non-fatal
      }
    }
  }

  /** Test / injection. */
  getDedupeStore(): NotificationDedupeStore {
    return this.dedupe;
  }

  dispose(): void {
    this.responseUnsub?.();
    this.responseUnsub = null;
    this.responseAttached = false;
  }

  private async emitTerminal(
    event: 'COMPLETED' | 'FAILED',
    input: { downloadId: string; title: string; errorCode?: string | null },
  ): Promise<boolean> {
    if (!(await this.ensurePresentationAllowed(event === 'COMPLETED' ? 'completed' : 'failed'))) {
      return false;
    }
    if (!canEmitTerminalNotification(this.dedupe, input.downloadId, event)) {
      return false;
    }

    await this.ensureChannels();

    const safeTitle = sanitizeBodyTitle(input.title);
    const title =
      event === 'COMPLETED'
        ? translate('downloads.notifications.completedTitle')
        : translate('downloads.notifications.failedTitle');
    const reasonKey =
      event === 'FAILED'
        ? mapFailureNotificationReason(input.errorCode)
        : null;
    const reasonText = reasonKey
      ? translate(failureNotificationReasonTranslationKey(reasonKey))
      : null;
    const body =
      event === 'COMPLETED'
        ? safeTitle
        : reasonText
          ? `${safeTitle}\n${reasonText}`
          : `${safeTitle}\n${translate('downloads.notifications.tapForDetails')}`;

    const payload = buildSafeNotificationPayload({
      downloadId: input.downloadId,
      event,
    });

    try {
      const androidId = androidNotificationIdForDownload(input.downloadId);
      let scheduled = false;
      if (isNativeDownloadNotificationsAvailable()) {
        scheduled = await nativeNotifyTerminal({
          downloadId: input.downloadId,
          notificationId: androidId,
          title,
          body,
        });
      }

      if (!scheduled) {
        const adapter = await this.resolveLocalAdapter();
        if (!adapter) {
          return false;
        }
        await adapter.scheduleNotification({
          title,
          body,
          data: payload,
          identifier:
            event === 'COMPLETED'
              ? completedNotificationIdentifier(input.downloadId)
              : failedNotificationIdentifier(input.downloadId),
          sticky: false,
        });
        scheduled = true;
      }

      if (!scheduled) {
        return false;
      }

      markTerminalNotificationEmitted(this.dedupe, input.downloadId, event);
      persistDedupe(this.dedupe);
      hardeningLog(
        event === 'COMPLETED'
          ? 'DOWNLOAD_NOTIFICATION_COMPLETED'
          : 'DOWNLOAD_NOTIFICATION_FAILED',
        { downloadId: input.downloadId },
      );
      return true;
    } catch {
      // Do not burn dedupe key on schedule failure.
      return false;
    }
  }

  private async ensurePresentationAllowed(
    reason: 'progress' | 'completed' | 'failed',
  ): Promise<boolean> {
    await this.refreshPermissionState();

    const before = this.getEffectiveState();
    if (
      before.preferenceEnabled &&
      before.permissionStatus === 'undetermined' &&
      before.canAskAgain
    ) {
      await this.maybeRequestPermissionOnce();
      await this.refreshPermissionState();
    }

    const effective = this.getEffectiveState();
    if (!effective.effectiveEnabled) {
      hardeningLog('DOWNLOAD_NOTIFICATION_SUPPRESSED_PERMISSION_DENIED', {
        reason,
        preference: effective.preferenceEnabled,
        permission: effective.permissionStatus,
      });
      return false;
    }
    return true;
  }

  private async publishActive(input: {
    downloadId: string;
    title: string;
    body: string;
    percent: number | null;
    indeterminate: boolean;
    sticky: boolean;
  }): Promise<boolean> {
    await this.ensureChannels();
    const androidId = androidNotificationIdForDownload(input.downloadId);

    if (isNativeDownloadNotificationsAvailable()) {
      const ok = await nativeUpsertProgress({
        downloadId: input.downloadId,
        notificationId: androidId,
        title: input.title,
        body: input.body,
        progressPercent: input.percent,
        indeterminate: input.indeterminate,
        sticky: input.sticky,
      });
      if (ok) {
        return true;
      }
    }

    const adapter = await this.resolveLocalAdapter();
    if (!adapter) {
      return false;
    }
    try {
      await adapter.scheduleNotification({
        title: input.title,
        body: input.body,
        data: {
          type: 'DOWNLOAD_DETAILS',
          downloadId: input.downloadId,
        },
        identifier: activeNotificationIdentifier(input.downloadId),
        sticky: input.sticky,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async maybeRequestPermissionOnce(): Promise<void> {
    const key = 'vidorax.mmkv.downloads.notificationPermissionPrompted.v1';
    if (readMmkvString(key) === '1') {
      return;
    }
    writeMmkvString(key, '1');
    try {
      await this.enableFromUserGesture();
    } catch {
      // non-fatal — download continues without alerts
    }
  }

  private async ensureChannels(): Promise<void> {
    if (this.channelsReady) {
      return;
    }
    try {
      if (isNativeDownloadNotificationsAvailable()) {
        const ok = await nativeEnsureChannels();
        if (ok) {
          hardeningLog('DOWNLOAD_NOTIFICATION_CHANNEL_READY', {
            channel: EVENT_NOTIFICATION_CHANNEL_ID,
            via: 'native',
          });
        }
      }
      const adapter = await this.resolveLocalAdapter();
      if (adapter) {
        await adapter.ensureEventChannel();
      }
      this.channelsReady = true;
      hardeningLog('DOWNLOAD_NOTIFICATION_CHANNEL_READY', {
        channel: EVENT_NOTIFICATION_CHANNEL_ID,
      });
    } catch {
      // non-fatal
    }
  }

  private attachResponseListenerOnce(): void {
    if (this.responseAttached) {
      return;
    }
    this.responseAttached = true;
    void this.resolveLocalAdapter().then((adapter) => {
      if (!adapter) {
        return;
      }
      this.responseUnsub = adapter.addResponseListener((downloadId) => {
        hardeningLog('DOWNLOAD_NOTIFICATION_TAPPED', { downloadId });
        void resolveNotificationNavigation(downloadId);
      });
    });
  }

  private async captureColdStartResponse(): Promise<void> {
    const adapter = await this.resolveLocalAdapter();
    if (!adapter) {
      return;
    }
    try {
      const response = await adapter.getLastNotificationResponse();
      if (response?.downloadId) {
        capturePendingNotificationTarget(response.downloadId);
      }
    } catch {
      // ignore
    }
  }

  private async resolvePermissionAdapter(): Promise<NotificationPermissionAdapter | null> {
    if (this.permissionAdapter) {
      return this.permissionAdapter;
    }
    if (isWebPlatform()) {
      return null;
    }
    try {
      if (isExpoGoRuntime()) {
        this.permissionAdapter = await createExpoGoPermissionAdapter();
      } else {
        this.permissionAdapter = await createExpoPermissionAdapter();
      }
      return this.permissionAdapter;
    } catch {
      return null;
    }
  }

  private async resolveLocalAdapter(): Promise<LocalNotificationAdapter | null> {
    if (this.localAdapter) {
      return this.localAdapter;
    }
    if (isWebPlatform()) {
      return null;
    }
    try {
      // Never import expo-notifications inside Expo Go (Android throws).
      if (isExpoGoRuntime()) {
        this.localAdapter = createExpoGoNoopLocalAdapter();
      } else {
        this.localAdapter = await createExpoLocalAdapter();
      }
      return this.localAdapter;
    } catch {
      return null;
    }
  }
}

function sanitizeBodyTitle(title: string): string {
  const trimmed = (title ?? '').trim() || 'Download';
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('://')) {
    return 'Download';
  }
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}

const NOTIFICATION_COPY_FALLBACKS: Record<string, string> = {
  'downloads.notifications.downloadingTitle': 'Downloading',
  'downloads.notifications.preparingTitle': 'Preparing download',
  'downloads.notifications.waitingWifiTitle': 'Waiting for Wi-Fi',
  'downloads.notifications.pausedTitle': 'Download paused',
  'downloads.notifications.retryingTitle': 'Retrying download',
  'downloads.notifications.completedTitle': 'Download complete',
  'downloads.notifications.failedTitle': 'Download failed',
  'downloads.notifications.tapForDetails': 'Tap for details',
  'downloads.notifications.channelName': 'Downloads',
};

function translate(key: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loc = require('@/localization') as {
      translate: (k: string) => string;
    };
    const value = loc.translate(key);
    if (typeof value === 'string' && value.length > 0 && value !== key) {
      return value;
    }
  } catch {
    // Node verifiers / missing i18n — use EN fallbacks.
  }
  return NOTIFICATION_COPY_FALLBACKS[key] ?? key;
}

function translateLifecycleTitle(
  key: NotificationPresentation['titleKey'],
): string {
  switch (key) {
    case 'downloadingTitle':
      return translate('downloads.notifications.downloadingTitle');
    case 'preparingTitle':
      return translate('downloads.notifications.preparingTitle');
    case 'waitingWifiTitle':
      return translate('downloads.notifications.waitingWifiTitle');
    case 'pausedTitle':
      return translate('downloads.notifications.pausedTitle');
    case 'retryingTitle':
      return translate('downloads.notifications.retryingTitle');
    case 'completedTitle':
      return translate('downloads.notifications.completedTitle');
    case 'failedTitle':
      return translate('downloads.notifications.failedTitle');
    default:
      return translate('downloads.notifications.downloadingTitle');
  }
}

function loadDedupeFromDisk(): NotificationDedupeStore {
  try {
    const raw = readMmkvString(mmkvKeys.downloadNotificationEvents);
    return deserializeDedupeStore(raw);
  } catch {
    return createNotificationDedupeStore();
  }
}

function persistDedupe(store: NotificationDedupeStore): void {
  try {
    writeMmkvString(
      mmkvKeys.downloadNotificationEvents,
      serializeDedupeStore(store),
    );
  } catch {
    // ignore
  }
}

async function createExpoGoPermissionAdapter(): Promise<NotificationPermissionAdapter> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Platform, PermissionsAndroid } = require('react-native') as {
    Platform: { OS: string; Version: number | string };
    PermissionsAndroid: {
      PERMISSIONS: { POST_NOTIFICATIONS?: string };
      RESULTS: { GRANTED: string; DENIED: string; NEVER_ASK_AGAIN: string };
      check: (permission: string) => Promise<boolean>;
      request: (permission: string) => Promise<string>;
    };
  };
  const Linking = await import('expo-linking');

  const postNotifications = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;

  return {
    async getPermissionsAsync() {
      if (Platform.OS !== 'android') {
        return { status: 'unavailable' as const, canAskAgain: false };
      }
      // Pre-33: notification permission not required at runtime.
      if (typeof Platform.Version === 'number' && Platform.Version < 33) {
        return { status: 'granted' as const, canAskAgain: true };
      }
      if (!postNotifications) {
        return { status: 'granted' as const, canAskAgain: true };
      }
      try {
        const granted = await PermissionsAndroid.check(postNotifications);
        return {
          status: granted ? ('granted' as const) : ('denied' as const),
          canAskAgain: true,
        };
      } catch {
        return { status: 'unavailable' as const, canAskAgain: false };
      }
    },
    async requestPermissionsAsync() {
      if (Platform.OS !== 'android' || !postNotifications) {
        return { status: 'unavailable' as const, canAskAgain: false };
      }
      if (typeof Platform.Version === 'number' && Platform.Version < 33) {
        return { status: 'granted' as const, canAskAgain: true };
      }
      try {
        const result = await PermissionsAndroid.request(postNotifications);
        if (result === PermissionsAndroid.RESULTS.GRANTED) {
          return { status: 'granted' as const, canAskAgain: true };
        }
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          return { status: 'denied' as const, canAskAgain: false };
        }
        return { status: 'denied' as const, canAskAgain: true };
      } catch {
        return { status: 'unavailable' as const, canAskAgain: false };
      }
    },
    async openSystemSettings() {
      await Linking.openSettings();
    },
  };
}

/** Expo Go cannot load expo-notifications on Android — no optional event alerts here. */
function createExpoGoNoopLocalAdapter(): LocalNotificationAdapter {
  return {
    async ensureEventChannel() {},
    async scheduleNotification() {
      if (__DEV__) {
        console.info(
          '[downloads/notifications] Optional local notifications require a development build (not Expo Go).',
        );
      }
    },
    async dismissNotification() {},
    async getLastNotificationResponse() {
      return null;
    },
    addResponseListener() {
      return () => undefined;
    },
  };
}

async function createExpoPermissionAdapter(): Promise<NotificationPermissionAdapter> {
  // Dev/production native builds only — never call from Expo Go.
  const Notifications = await import('expo-notifications');
  const Linking = await import('expo-linking');

  return {
    async getPermissionsAsync() {
      const result = await Notifications.getPermissionsAsync();
      return {
        status: mapExpoPermissionStatus(result.status),
        canAskAgain: result.canAskAgain !== false,
      };
    },
    async requestPermissionsAsync() {
      const result = await Notifications.requestPermissionsAsync();
      return {
        status: mapExpoPermissionStatus(result.status),
        canAskAgain: result.canAskAgain !== false,
      };
    },
    async openSystemSettings() {
      await Linking.openSettings();
    },
  };
}

async function createExpoLocalAdapter(): Promise<LocalNotificationAdapter> {
  const Notifications = await import('expo-notifications');

  // Local notifications only — never register push tokens.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  return {
    async ensureEventChannel() {
      if (!isAndroidPlatform()) {
        return;
      }
      await Notifications.setNotificationChannelAsync(EVENT_NOTIFICATION_CHANNEL_ID, {
        name: translate('downloads.notifications.channelName'),
        importance: Notifications.AndroidImportance.DEFAULT,
        bypassDnd: false,
        enableVibrate: false,
        showBadge: false,
      });
    },

    async scheduleNotification({ title, body, data, identifier, sticky }) {
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title,
          body,
          data,
          sound: false,
          sticky: sticky === true,
          autoDismiss: sticky !== true,
        },
        // Immediate delivery on the downloads event channel (not the Expo fallback).
        trigger: isAndroidPlatform()
          ? { channelId: EVENT_NOTIFICATION_CHANNEL_ID }
          : null,
      });
    },

    async dismissNotification(identifier) {
      try {
        await Notifications.dismissNotificationAsync(identifier);
      } catch {
        // ignore
      }
      try {
        await Notifications.cancelScheduledNotificationAsync(identifier);
      } catch {
        // ignore
      }
    },

    async getLastNotificationResponse() {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (!response) {
        return null;
      }
      const data = response.notification.request.content.data as
        | DownloadNotificationPayload
        | undefined;
      if (data?.type === 'DOWNLOAD_DETAILS' && typeof data.downloadId === 'string') {
        return { downloadId: data.downloadId };
      }
      return { downloadId: null };
    },

    addResponseListener(handler) {
      const sub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as
          | DownloadNotificationPayload
          | undefined;
        if (data?.type === 'DOWNLOAD_DETAILS' && typeof data.downloadId === 'string') {
          handler(data.downloadId);
        }
      });
      return () => {
        sub.remove();
      };
    },
  };
}

export function getDownloadNotificationService(): DownloadNotificationService {
  if (!singleton) {
    singleton = new DownloadNotificationService();
  }
  return singleton;
}

export function createDownloadNotificationService(
  options: ServiceOptions,
): DownloadNotificationService {
  return new DownloadNotificationService(options);
}

export function setDownloadNotificationServiceForTests(
  value: DownloadNotificationService | null,
): void {
  singleton = value;
}
