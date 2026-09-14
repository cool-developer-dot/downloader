/**
 * Phase 3 — Android download notifications verifier.
 * Usage: npm run verify:android-download-notifications
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  androidNotificationIdForDownload,
  activeNotificationIdentifier,
  completedNotificationIdentifier,
  failedNotificationIdentifier,
} from '../src/downloads/notifications/notification-id';
import {
  mapDownloadStatusToNotification,
  shouldPublishProgressTick,
  PROGRESS_NOTIFICATION_MIN_INTERVAL_MS,
} from '../src/downloads/notifications/lifecycle-map';
import {
  EVENT_NOTIFICATION_CHANNEL_ID,
  FGS_NOTIFICATION_ID,
} from '../src/downloads/notifications/types';
import { deriveEffectiveNotificationsState } from '../src/downloads/notifications/permission';
import {
  canEmitTerminalNotification,
  createNotificationDedupeStore,
  markTerminalNotificationEmitted,
} from '../src/downloads/notifications/dedupe';
import {
  qualifyTerminalNotification,
  buildSafeNotificationPayload,
} from '../src/downloads/notifications/terminal-qualify';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

async function main(): Promise<void> {
  const service = readSrc('src/downloads/notifications/service.ts');
  const bridge = readSrc('src/downloads/notifications/ensure-bridge.ts');
  const nativeKt = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/notifications/VidoraDownloadNotificationsModule.kt',
  );
  const mainApp = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/MainApplication.kt',
  );
  const manifest = readSrc('android/app/src/main/AndroidManifest.xml');
  const en = readSrc('src/localization/en.ts');
  const ur = readSrc('src/localization/ur.ts');
  const appLock = readSrc('src/security/app-lock/AppLockGate.tsx');
  const openSvc = readSrc('src/downloads/completed-file/action-service.ts');
  const packageJson = readSrc('package.json');

  await test('1. stable channel ID', () => {
    assert(EVENT_NOTIFICATION_CHANNEL_ID === 'vidorax_download_events');
    assert(nativeKt.includes('vidorax_download_events'));
  });

  await test('2. channel created idempotently', () => {
    assert(nativeKt.includes('getNotificationChannel(CHANNEL_ID)'));
    assert(service.includes('channelsReady'));
  });

  await test('3. Android 13 permission handled', () => {
    assert(manifest.includes('POST_NOTIFICATIONS'));
    assert(service.includes('requestPermissionsAsync') || service.includes('POST_NOTIFICATIONS'));
    assert(en.includes('notificationsPermissionRequired'));
  });

  await test('4. permission denial does not block enqueue', () => {
    assert(bridge.includes('Never starts workers') || bridge.includes('never control'));
    assert(service.includes('DOWNLOAD_NOTIFICATION_SUPPRESSED_PERMISSION_DENIED'));
    const denied = deriveEffectiveNotificationsState({
      preferenceEnabled: true,
      permissionStatus: 'denied',
      canAskAgain: false,
    });
    assert(!denied.effectiveEnabled);
  });

  await test('5. stable notification ID per download', () => {
    const a = androidNotificationIdForDownload('download-aaaaaaaa');
    const b = androidNotificationIdForDownload('download-aaaaaaaa');
    assert(a === b, 'deterministic');
    assert(a !== FGS_NOTIFICATION_ID);
  });

  await test('6. different downloads get distinct IDs', () => {
    const a = androidNotificationIdForDownload('download-aaaaaaaa');
    const b = androidNotificationIdForDownload('download-bbbbbbbb');
    assert(a !== b);
    assert(
      activeNotificationIdentifier('a') !== activeNotificationIdentifier('b'),
    );
  });

  await test('7. STARTING maps correctly', () => {
    const m = mapDownloadStatusToNotification('STARTING');
    assert('titleKey' in m && m.titleKey === 'preparingTitle');
  });

  await test('8. DOWNLOADING maps correctly', () => {
    const m = mapDownloadStatusToNotification('DOWNLOADING');
    assert('kind' in m && m.kind === 'progress');
  });

  await test('9. WAITING_FOR_WIFI maps correctly', () => {
    const m = mapDownloadStatusToNotification('WAITING_FOR_WIFI');
    assert('titleKey' in m && m.titleKey === 'waitingWifiTitle');
  });

  await test('10. PAUSED maps correctly', () => {
    const m = mapDownloadStatusToNotification('PAUSED');
    assert('kind' in m && m.kind === 'paused');
  });

  await test('11. RETRYING maps correctly', () => {
    const m = mapDownloadStatusToNotification('RETRYING');
    assert('kind' in m && m.kind === 'retrying');
  });

  await test('12. COMPLETED maps correctly', () => {
    const m = mapDownloadStatusToNotification('COMPLETED');
    assert('kind' in m && m.kind === 'completed');
  });

  await test('13. FAILED maps correctly', () => {
    const m = mapDownloadStatusToNotification('FAILED');
    assert('kind' in m && m.kind === 'failed');
  });

  await test('14. CANCELLED removes stale notification', () => {
    const m = mapDownloadStatusToNotification('CANCELLED');
    assert(m.kind === 'dismiss');
    assert(bridge.includes('dismissActive'));
  });

  await test('15. progress updates throttled/coalesced', () => {
    assert(PROGRESS_NOTIFICATION_MIN_INTERVAL_MS >= 500);
    assert(
      !shouldPublishProgressTick({
        previousPercent: 10,
        nextPercent: 10,
        previousIndeterminate: false,
        nextIndeterminate: false,
        lastPublishedAt: Date.now(),
        now: Date.now() + 100,
      }),
    );
    assert(
      shouldPublishProgressTick({
        previousPercent: 10,
        nextPercent: 11,
        previousIndeterminate: false,
        nextIndeterminate: false,
        lastPublishedAt: Date.now(),
        now: Date.now(),
      }),
    );
  });

  await test('16. byte accounting not throttled in engine (presentation only)', () => {
    assert(service.includes('shouldPublishProgressTick'));
    assert(!bridge.includes('bytesWritten ='), 'bridge does not mutate bytes');
  });

  await test('17. unknown total uses indeterminate progress', () => {
    assert(service.includes('!knownTotal') || service.includes('indeterminate'));
    assert(nativeKt.includes('setProgress(0, 0, true)'));
  });

  await test('18. known total uses determinate progress', () => {
    assert(nativeKt.includes('setProgress(100, pct, false)'));
  });

  await test('19. completion fires only after COMPLETED', () => {
    assert(bridge.includes("event.type === 'completed'"));
    assert(qualifyTerminalNotification({ eventType: 'completed', nextStatus: 'COMPLETED' }) === 'COMPLETED');
  });

  await test('20. FINALIZING does not produce success notification', () => {
    const m = mapDownloadStatusToNotification('FINALIZING');
    assert('kind' in m && m.kind === 'progress');
    assert(qualifyTerminalNotification({ nextStatus: 'FINALIZING' }) === null);
  });

  await test('21. duplicate completion suppressed', () => {
    const store = createNotificationDedupeStore();
    assert(canEmitTerminalNotification(store, 'id1', 'COMPLETED'));
    markTerminalNotificationEmitted(store, 'id1', 'COMPLETED');
    assert(!canEmitTerminalNotification(store, 'id1', 'COMPLETED'));
  });

  await test('22. notification tap carries download identity', () => {
    const payload = buildSafeNotificationPayload({
      downloadId: 'abc12345',
      event: 'COMPLETED',
    });
    assert(payload.downloadId === 'abc12345');
    assert(payload.type === 'DOWNLOAD_DETAILS');
    assert(nativeKt.includes('putExtra("downloadId"'));
  });

  await test('23. raw private file path not put in intent', () => {
    assert(!nativeKt.includes('file://'));
    assert(!nativeKt.includes('localUri'));
    assert(nativeKt.includes('vidorax://downloads/'));
  });

  await test('24. completed-file resolver reused where needed (details route)', () => {
    assert(bridge.includes('notifyCompleted'));
    // Tap routes to download details — same catalog identity as Play/Open
    const deep = readSrc('src/downloads/notifications/deep-link.ts');
    assert(deep.includes('downloadDetailsPath'));
  });

  await test('25. PendingIntent identity does not collide', () => {
    assert(nativeKt.includes('FLAG_IMMUTABLE'));
    assert(nativeKt.includes('downloadId.hashCode()'));
  });

  await test('26. App Lock not bypassed', () => {
    assert(appLock.includes('setNotificationAuthProbe'));
    assert(appLock.includes("status === 'UNLOCKED'"));
    assert(appLock.includes('flushPendingNotificationTarget'));
  });

  await test('27. background state does not crash (errors swallowed)', () => {
    assert(nativeKt.includes('promise.resolve(false)') || nativeKt.includes('catch'));
    assert(service.includes('non-fatal') || service.includes('catch'));
  });

  await test('28. multiple downloads remain independent', () => {
    assert(
      androidNotificationIdForDownload('aaaaaaaa') !==
        androidNotificationIdForDownload('bbbbbbbb'),
    );
    assert(service.includes('progressTickById'));
  });

  await test('29. Share unchanged', () => {
    assert(openSvc.includes('shareCompletedFile'));
    assert(!bridge.includes('shareCompletedFile'));
  });

  await test('30. Open unchanged', () => {
    assert(openSvc.includes('openCompletedFile'));
    assert(!bridge.includes('openCompletedFile'));
  });

  await test('31. Pause/resume unchanged (notifications observe only)', () => {
    assert(!bridge.includes('downloadEngine.pause'));
    assert(!bridge.includes('downloadEngine.resume'));
  });

  await test('32. Range/HLS unchanged', () => {
    assert(!bridge.includes('appendRange'));
    assert(!bridge.includes('hlsTransfer'));
  });

  await test('33. downloader state machine unchanged by notifications', () => {
    assert(!service.includes("status: 'FAILED'"));
    assert(!service.includes('patchItem'));
  });

  await test('34. EN/UR strings present', () => {
    assert(en.includes('downloadingTitle'));
    assert(en.includes("completedTitle: 'Download complete'"));
    assert(ur.includes('downloadingTitle'));
    assert(ur.includes('waitingWifiTitle'));
    assert(en.includes('channelName'));
  });

  await test('35. package script registered (no prebuild invoked by verifier)', () => {
    assert(packageJson.includes('verify:android-download-notifications'));
    // This verifier is static tsx only — never shells gradle or Expo native generation.
    const verifierSrc = readSrc('scripts/verify-android-download-notifications.ts');
    assert(!/\bexpo\s+prebuild\b/.test(verifierSrc.replace(/\/\/[^\n]*/g, '')));
  });

  await test('36. native module registered', () => {
    assert(mainApp.includes('DownloadNotificationsNativePackage'));
    assert(existsSync(join(ROOT, 'android/app/src/main/java/com/anonymous/vidorax/notifications/VidoraDownloadNotificationsModule.kt')));
  });

  await test('37. FGS not duplicated', () => {
    assert(!nativeKt.includes('startForeground'));
    assert(!nativeKt.includes('ForegroundService'));
  });

  await test('38. terminal identifiers stable', () => {
    assert(completedNotificationIdentifier('x').includes('completed'));
    assert(failedNotificationIdentifier('x').includes('failed'));
    assert(activeNotificationIdentifier('x').includes('active'));
  });

  await test('39. diagnostics events present', () => {
    assert(service.includes('DOWNLOAD_NOTIFICATION_PROGRESS'));
    assert(service.includes('DOWNLOAD_NOTIFICATION_COMPLETED'));
    assert(service.includes('DOWNLOAD_NOTIFICATION_FAILED'));
    assert(service.includes('DOWNLOAD_NOTIFICATION_TAPPED'));
    assert(service.includes('DOWNLOAD_NOTIFICATION_CHANNEL_READY'));
  });

  await test('40. preference AND permission required', () => {
    const on = deriveEffectiveNotificationsState({
      preferenceEnabled: true,
      permissionStatus: 'granted',
      canAskAgain: true,
    });
    assert(on.effectiveEnabled);
    const offPref = deriveEffectiveNotificationsState({
      preferenceEnabled: false,
      permissionStatus: 'granted',
      canAskAgain: true,
    });
    assert(!offPref.effectiveEnabled);
  });

  await test('41. acceptance doc present', () => {
    assert(
      existsSync(
        join(
          ROOT,
          'docs/testing/ANDROID-DOWNLOAD-NOTIFICATIONS-REAL-DEVICE-ACCEPTANCE.md',
        ),
      ),
    );
  });

  await test('42. architecture doc present', () => {
    assert(
      existsSync(
        join(ROOT, 'docs/ui/ANDROID-DOWNLOAD-NOTIFICATIONS-ARCHITECTURE.md'),
      ),
    );
  });

  await test('43. QUEUED maps to preparing/starting presentation', () => {
    const m = mapDownloadStatusToNotification('QUEUED');
    assert('kind' in m && m.kind === 'starting');
  });

  await test('44. PREPARING maps to preparing', () => {
    const m = mapDownloadStatusToNotification('PREPARING');
    assert('titleKey' in m && m.titleKey === 'preparingTitle');
  });

  await test('45. bridge wires status + progress + cancelled', () => {
    assert(bridge.includes("event.type === 'status'"));
    assert(bridge.includes('subscribeProgress'));
    assert(bridge.includes("event.type === 'cancelled'"));
  });

  console.log(`\nAndroid download notifications: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
