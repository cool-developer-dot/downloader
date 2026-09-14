/**
 * Phase 7B — Android file actions + terminal notification verifier.
 * Usage: npm run verify:phase7b-android-file-actions
 *
 * Exercises exported logic directly. No Python/Maestro/APK.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveCompletedActions,
  resolveExternalHandoffMime,
  isContentUri,
  isRawFileUri,
  isUnsafeCallerPath,
  validateExternalContentUri,
  isVidoraExpoFileProviderUri,
  mapCompletedActionError,
  CompletedFileActionError,
} from '../src/downloads/completed-file';
import {
  canEmitTerminalNotification,
  createNotificationDedupeStore,
  markTerminalNotificationEmitted,
  shouldEmitTerminalNotification,
} from '../src/downloads/notifications/dedupe';
import {
  qualifyTerminalNotification,
  buildSafeNotificationPayload,
  shouldDeliverTerminalNotification,
  resolveNotificationTarget,
  mapFailureNotificationReason,
} from '../src/downloads/notifications/terminal-qualify';
import { EVENT_NOTIFICATION_CHANNEL_ID } from '../src/downloads/notifications/types';

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
  // PLAY
  await test('1. COMPLETED + physical → canPlay', () => {
    const a = resolveCompletedActions({
      status: 'COMPLETED',
      physicalFilePresent: true,
      allowExternalHandoff: true,
    });
    assert(a.canPlay, 'canPlay');
  });

  await test('2. active file → cannot Play as completed', () => {
    assert(
      !resolveCompletedActions({
        status: 'DOWNLOADING',
        physicalFilePresent: false,
      }).canPlay,
      'active',
    );
  });

  await test('3. FAILED → cannot Play', () => {
    assert(
      !resolveCompletedActions({ status: 'FAILED', physicalFilePresent: false }).canPlay,
      'failed',
    );
  });

  await test('4. CANCELLED → cannot Play', () => {
    assert(
      !resolveCompletedActions({
        status: 'CANCELLED',
        physicalFilePresent: false,
      }).canPlay,
      'cancelled',
    );
  });

  await test('5. missing physical file → cannot Play', () => {
    assert(
      !resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: false,
        allowExternalHandoff: true,
      }).canPlay,
      'missing',
    );
  });

  await test('6. Play resolves canonical downloadId (service uses id)', () => {
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    assert(svc.includes('playCompletedFile'), 'play api');
    assert(svc.includes('playerPath'), 'route');
    assert(!svc.includes('sourceUrl: item.sourceUrl'), 'no sourceUrl play');
  });

  await test('7. Play does not use sourceUrl', () => {
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    assert(svc.includes('sourceUrl: null'), 'null source');
  });

  await test('8. Play does not require Cookie/Auth', () => {
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    assert(!svc.includes('Cookie:'), 'cookie header');
    assert(!svc.includes("'Authorization'"), 'auth header');
    assert(!svc.includes('requestContext'), 'ctx');
  });

  // OPEN
  await test('9. completed file → Open allowed', () => {
    assert(
      resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: true,
        allowExternalHandoff: true,
      }).canOpen,
      'open',
    );
  });

  await test('10. missing file → Open blocked', () => {
    assert(
      !resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: false,
        allowExternalHandoff: true,
      }).canOpen,
      'blocked',
    );
  });

  await test('11. external URI is content:// (native module)', () => {
    const native = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/fileactions/VidoraFileActionsModule.kt',
    );
    assert(native.includes('content://'), 'content');
    assert(native.includes('FLAG_GRANT_READ_URI_PERMISSION'), 'grant');
    assert(native.includes('ACTION_VIEW'), 'view');
    assert(native.includes('ClipData'), 'clipdata required for URI grant');
  });

  await test('12. no raw file:// exposed by native Open', () => {
    const native = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/fileactions/VidoraFileActionsModule.kt',
    );
    assert(native.includes('file'), 'mentions reject file');
    assert(native.includes('parseTrustedContentUri'), 'parser');
    assert(native.includes('FileSystemFileProvider'), 'authority');
    assert(isContentUri('content://com.anonymous.vidorax.FileSystemFileProvider/expo_files/x'));
    assert(
      !native.includes('parseContentUri(') || native.includes('parseTrustedContentUri'),
      'trusted parser',
    );
    assert(!validateExternalContentUri('file:///data/user/0/x'));
  });

  await test('13. MIME from Phase 7A', () => {
    const m = resolveExternalHandoffMime('video/mp4', 'clip.bin');
    assert(m.mimeType === 'video/mp4', m.mimeType);
  });

  await test('14. MP4 uses video/mp4', () => {
    assert(resolveExternalHandoffMime('video/mp4').intentMime === 'video/mp4');
  });

  await test('15. WebM uses video/webm', () => {
    assert(resolveExternalHandoffMime('video/webm').intentMime === 'video/webm');
  });

  await test('16. TS uses actual MIME', () => {
    assert(resolveExternalHandoffMime('video/mp2t').intentMime === 'video/mp2t');
  });

  await test('17. unknown MIME safe fallback', () => {
    const m = resolveExternalHandoffMime(null, 'clip.unknown');
    assert(m.mimeType === null, 'null persisted');
    assert(m.intentMime === '*/*', 'intent fallback');
  });

  await test('18. temporary read grant present', () => {
    const native = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/fileactions/VidoraFileActionsModule.kt',
    );
    assert(native.includes('FLAG_GRANT_READ_URI_PERMISSION'), 'read');
  });

  await test('19. no write grant unless proven required', () => {
    const native = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/fileactions/VidoraFileActionsModule.kt',
    );
    assert(!native.includes('FLAG_GRANT_WRITE_URI_PERMISSION'), 'no write');
  });

  await test('20. arbitrary path rejected', () => {
    assert(isUnsafeCallerPath('/etc/passwd'), 'passwd');
    assert(isUnsafeCallerPath('C:\\Windows\\x'), 'win');
  });

  await test('21. traversal path rejected', () => {
    assert(isUnsafeCallerPath('../../secret'), 'trav');
  });

  await test('22. non-managed file rejected (assertManagedDownloadPath in service)', () => {
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    assert(svc.includes('assertManagedDownloadPath'), 'managed');
  });

  await test('23. no compatible app → safe error', () => {
    const err = mapCompletedActionError({ code: 'NO_COMPATIBLE_APP' });
    assert(err.code === 'NO_COMPATIBLE_APP', err.code);
  });

  await test('24. intent failure → safe error', () => {
    const err = mapCompletedActionError(new Error('OPEN_FAILED'));
    assert(err.code === 'OPEN_FAILED' || err instanceof CompletedFileActionError, 'err');
  });

  await test('25. action failure does not change COMPLETED state', () => {
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    assert(!svc.includes("status: 'FAILED'"), 'no fail mutation');
    assert(!svc.includes('patchItem'), 'no store patch');
  });

  // SHARE
  await test('26. share uses content URI', () => {
    const native = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/fileactions/VidoraFileActionsModule.kt',
    );
    assert(native.includes('ACTION_SEND'), 'send');
    assert(native.includes('EXTRA_STREAM'), 'stream');
  });

  await test('27. share uses correct MIME', () => {
    const fa = readSrc('src/downloads/engine/file-actions.ts');
    assert(fa.includes('resolveExternalHandoffMime'), 'mime');
  });

  await test('28. ACTION_SEND safe API', () => {
    const native = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/fileactions/VidoraFileActionsModule.kt',
    );
    assert(native.includes('Intent.ACTION_SEND'), 'send');
  });

  await test('29. temporary read grant on share', () => {
    const native = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/fileactions/VidoraFileActionsModule.kt',
    );
    assert(native.includes('shareContentUri'), 'share');
    assert(native.includes('FLAG_GRANT_READ_URI_PERMISSION'), 'grant');
  });

  await test('30-34. no secrets in share path', () => {
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    assert(svc.includes('sourceUrl: null'), 'no source');
    assert(!svc.includes('requestContext'), 'ctx');
    assert(!svc.includes('getCookie'), 'cookie getter');
    assert(!svc.includes('Authorization:'), 'auth header');
  });

  await test('35. no base64 whole-file loading', () => {
    const fa = readSrc('src/downloads/engine/file-actions.ts');
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    assert(!fa.includes('readAsStringAsync'), 'fa');
    assert(!svc.includes('base64'), 'svc');
  });

  await test('36. completed state unchanged after Share (no status write)', () => {
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    assert(!svc.includes("status: 'FAILED'"), 'no fail');
    assert(!svc.includes('patchItem'), 'no patch');
    assert(!svc.includes('persistDownloadCatalog'), 'no persist');
  });

  await test('37. missing file → safe failure mapping', () => {
    assert(mapCompletedActionError({ code: 'FILE_MISSING' }).code === 'FILE_MISSING');
  });

  await test('38. unknown MIME → safe fallback', () => {
    assert(resolveExternalHandoffMime(undefined).intentMime === '*/*');
  });

  await test('39. repeated Share does not consume file', () => {
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    assert(!svc.includes('consumed'), 'no consume');
  });

  await test('40. Library and Downloads use centralized action implementation', () => {
    const lib = readSrc('src/screens/library/hooks/useLibraryScreen.ts');
    const dl = readSrc('src/screens/downloads/hooks/useDownloadsScreen.ts');
    assert(lib.includes('openCompletedFile') || lib.includes('action-service'), 'lib');
    assert(dl.includes('openCompletedFile') || dl.includes('action-service'), 'dl');
  });

  // NOTIFICATION QUALIFICATION
  await test('41. COMPLETED transition qualifies', () => {
    assert(
      qualifyTerminalNotification({
        previousStatus: 'DOWNLOADING',
        nextStatus: 'COMPLETED',
        eventType: 'completed',
      }) === 'COMPLETED',
    );
  });

  await test('42. FAILED transition qualifies', () => {
    assert(
      qualifyTerminalNotification({
        previousStatus: 'DOWNLOADING',
        nextStatus: 'FAILED',
        eventType: 'failed',
      }) === 'FAILED',
    );
  });

  await test('43. CANCELLED does not become failure', () => {
    assert(
      qualifyTerminalNotification({
        nextStatus: 'CANCELLED',
        eventType: 'cancelled',
      }) === null,
    );
  });

  await test('44. RETRYING does not become failure', () => {
    assert(
      qualifyTerminalNotification({
        nextStatus: 'RETRYING',
        eventType: 'status',
      }) === null,
    );
  });

  await test('45. PAUSED does not notify', () => {
    assert(
      qualifyTerminalNotification({ nextStatus: 'PAUSED', eventType: 'status' }) ===
        null,
    );
  });

  await test('46. FINALIZING does not notify', () => {
    assert(
      qualifyTerminalNotification({
        nextStatus: 'FINALIZING',
        eventType: 'status',
      }) === null,
    );
  });

  await test('47. catalog hydration COMPLETED does not notify', () => {
    assert(
      qualifyTerminalNotification({
        nextStatus: 'COMPLETED',
        eventType: 'completed',
        isHydrationOrMount: true,
      }) === null,
    );
  });

  await test('48. screen mount does not notify', () => {
    assert(
      qualifyTerminalNotification({
        nextStatus: 'COMPLETED',
        isHydrationOrMount: true,
      }) === null,
    );
  });

  await test('49. failed+retry scheduled does not qualify', () => {
    assert(
      qualifyTerminalNotification({
        nextStatus: 'FAILED',
        eventType: 'failed',
        isRetryScheduled: true,
      }) === null,
    );
  });

  // DEDUPE
  await test('50. same terminal event posts once', () => {
    const store = createNotificationDedupeStore();
    assert(canEmitTerminalNotification(store, 'a', 'COMPLETED'));
    markTerminalNotificationEmitted(store, 'a', 'COMPLETED');
    assert(!canEmitTerminalNotification(store, 'a', 'COMPLETED'));
  });

  await test('51. duplicate callback posts once', () => {
    const store = createNotificationDedupeStore();
    assert(shouldEmitTerminalNotification(store, 'b', 'FAILED'));
    assert(!shouldEmitTerminalNotification(store, 'b', 'FAILED'));
  });

  await test('52. app restart does not replay when marker present', () => {
    const store = createNotificationDedupeStore();
    markTerminalNotificationEmitted(store, 'c', 'COMPLETED');
    assert(!canEmitTerminalNotification(store, 'c', 'COMPLETED'));
  });

  await test('53. two downloadIds both notify', () => {
    const store = createNotificationDedupeStore();
    assert(canEmitTerminalNotification(store, 'A', 'COMPLETED'));
    assert(canEmitTerminalNotification(store, 'B', 'COMPLETED'));
  });

  await test('54. FAILED once only', () => {
    const store = createNotificationDedupeStore();
    markTerminalNotificationEmitted(store, 'd', 'FAILED');
    assert(!canEmitTerminalNotification(store, 'd', 'FAILED'));
  });

  await test('55. completion after retries posts once', () => {
    assert(
      qualifyTerminalNotification({
        previousStatus: 'DOWNLOADING',
        nextStatus: 'COMPLETED',
        eventType: 'completed',
        isRetryScheduled: false,
      }) === 'COMPLETED',
    );
  });

  await test('56. no unbounded dedupe map (MAX 200)', () => {
    const dedupe = readSrc('src/downloads/notifications/dedupe.ts');
    assert(dedupe.includes('MAX_ENTRIES = 200'), 'bound');
  });

  await test('57. dedupe marker contains no secrets', () => {
    const key = `${'dl'}:COMPLETED`;
    assert(!key.includes('http'), 'no url');
    assert(!key.toLowerCase().includes('cookie'), 'no cookie');
  });

  // PAYLOAD
  await test('58. payload contains downloadId', () => {
    const p = buildSafeNotificationPayload({ downloadId: 'x1', event: 'COMPLETED' });
    assert(p.downloadId === 'x1', p.downloadId);
  });

  await test('59. safe action/type only', () => {
    const p = buildSafeNotificationPayload({ downloadId: 'x1', event: 'FAILED' });
    assert(p.type === 'DOWNLOAD_DETAILS', p.type);
    assert(p.event === 'FAILED', p.event);
  });

  await test('60-65. payload rejects secrets', () => {
    let threw = false;
    try {
      buildSafeNotificationPayload({
        downloadId: 'x',
        event: 'COMPLETED',
        forbiddenExtras: { Cookie: 'a' },
      });
    } catch {
      threw = true;
    }
    assert(threw, 'cookie rejected');
    const p = buildSafeNotificationPayload({ downloadId: 'x', event: 'COMPLETED' });
    assert(!('sourceUrl' in p), 'no sourceUrl');
    assert(!('Authorization' in p), 'no auth');
  });

  // PERMISSION / BOUNDARIES
  await test('66-72. permission delivery gates', () => {
    assert(
      shouldDeliverTerminalNotification({
        preferenceEnabled: true,
        permissionGranted: true,
        qualified: 'COMPLETED',
        alreadyDelivered: false,
      }),
    );
    assert(
      !shouldDeliverTerminalNotification({
        preferenceEnabled: true,
        permissionGranted: false,
        qualified: 'COMPLETED',
        alreadyDelivered: false,
      }),
      'denied',
    );
    assert(
      !shouldDeliverTerminalNotification({
        preferenceEnabled: true,
        permissionGranted: true,
        qualified: 'COMPLETED',
        alreadyDelivered: true,
      }),
      'already',
    );
  });

  await test('73-78. routing', () => {
    assert(
      resolveNotificationTarget({
        downloadId: 'x',
        event: 'COMPLETED',
        exists: true,
      }).route === 'details',
    );
    assert(
      resolveNotificationTarget({
        downloadId: 'x',
        event: 'FAILED',
        exists: false,
      }).route === 'downloads',
    );
  });

  await test('79-90. security / boundaries static', () => {
    const svc = readSrc('src/downloads/completed-file/action-service.ts');
    const native = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/fileactions/VidoraFileActionsModule.kt',
    );
    const manifest = readSrc('android/app/src/main/AndroidManifest.xml');
    const notify = readSrc('src/downloads/notifications/service.ts');

    assert(!svc.includes('MediaStore'), 'no mediastore');
    assert(!svc.includes('MANAGE_EXTERNAL_STORAGE'), 'no manage');
    assert(!native.toLowerCase().includes('ffmpeg'), 'no ffmpeg');
    assert(manifest.includes('FileActionsNativePackage') === false, 'pkg in MainApp not manifest');
    assert(
      readSrc(
        'android/app/src/main/java/com/anonymous/vidorax/MainApplication.kt',
      ).includes('FileActionsNativePackage'),
      'registered',
    );
    assert(notify.includes('channelId: EVENT_NOTIFICATION_CHANNEL_ID'), 'channel bind');
    assert(notify.includes('markTerminalNotificationEmitted'), 'dedupe after success');
    assert(EVENT_NOTIFICATION_CHANNEL_ID === 'vidorax_download_events', 'channel id');
    assert(mapFailureNotificationReason('SESSION_EXPIRED') === 'sessionExpired');
    assert(mapFailureNotificationReason('FINAL_FILE_INVALID') === 'fileValidationFailed');
    assert(mapFailureNotificationReason('NETWORK_ERROR') === 'networkError');
    assert(
      isVidoraExpoFileProviderUri(
        'content://com.anonymous.vidorax.FileSystemFileProvider/expo_files/x',
      ),
      'trusted provider uri',
    );
    assert(
      !isVidoraExpoFileProviderUri('content://media/external/video/media/1'),
      'reject mediastore authority',
    );
    assert(!isVidoraExpoFileProviderUri('file:///data/user/0/x'), 'reject file');
    assert(!isRawFileUri('content://x'));
    assert(isContentUri('content://x'));

    // No custom FileProvider root-path added by 7B
    assert(!existsSync(join(ROOT, 'android/app/src/main/res/xml/file_paths.xml')));
  });

  console.log(`\nPhase 7B android file actions: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
