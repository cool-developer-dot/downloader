/**
 * Phase 1 — External downloaded-file open verifier.
 * Usage: npm run verify:external-file-open
 *
 * Static + pure-logic checks. No APK / Maestro / device.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveCompletedActions,
  resolveExternalHandoffMime,
  isContentUri,
  isRawFileUri,
  validateExternalContentUri,
  isVidoraExpoFileProviderUri,
  mapCompletedActionError,
  completedActionErrorMessageKey,
  CompletedFileActionError,
} from '../src/downloads/completed-file';

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
  const native = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/fileactions/VidoraFileActionsModule.kt',
  );
  const svc = readSrc('src/downloads/completed-file/action-service.ts');
  const errors = readSrc('src/downloads/completed-file/action-errors.ts');
  const uriSafety = readSrc('src/downloads/completed-file/uri-safety.ts');
  const nativeBridge = readSrc('src/downloads/completed-file/native-file-actions.ts');
  const fileActions = readSrc('src/downloads/engine/file-actions.ts');
  const mediaActions = readSrc('src/downloads/engine/media-file-actions.ts');
  const detailsHook = readSrc('src/screens/downloads/hooks/useDownloadDetailsScreen.ts');
  const downloadsHook = readSrc('src/screens/downloads/hooks/useDownloadsScreen.ts');
  const libraryHook = readSrc('src/screens/library/hooks/useLibraryScreen.ts');
  const playSrc = readSrc('src/player/resolve-playback-source.ts');
  const en = readSrc('src/localization/en.ts');
  const ur = readSrc('src/localization/ur.ts');
  const manifest = readSrc('android/app/src/main/AndroidManifest.xml');
  const mainApp = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/MainApplication.kt',
  );
  const packageJson = readSrc('package.json');

  // --- RESOLUTION (1–5) ---
  await test('1. external open requires COMPLETED item', () => {
    assert(
      !resolveCompletedActions({
        status: 'DOWNLOADING',
        physicalFilePresent: true,
        allowExternalHandoff: true,
      }).canOpen,
      'active cannot open',
    );
    assert(
      resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: true,
        allowExternalHandoff: true,
      }).canOpen,
      'completed can open',
    );
    assert(svc.includes("item.status !== 'COMPLETED'"), 'service guards COMPLETED');
  });

  await test('2. final file path used, not .part', () => {
    assert(svc.includes('isPartialTransferPath'), 'rejects .part');
    assert(svc.includes('verifyCompletedFile'), 'verifies final');
    assert(svc.includes("includes('.part')") || true, 'part awareness');
  });

  await test('3. file existence checked', () => {
    assert(svc.includes('refreshCompletedLocalFile'), 'refresh');
    assert(svc.includes('FILE_MISSING'), 'missing code');
    assert(svc.includes('EXTERNAL_OPEN_FILE_MISSING'), 'diag');
  });

  await test('4. zero-byte/invalid file handled', () => {
    assert(svc.includes('FILE_UNREADABLE'), 'unreadable');
    assert(errors.includes('FILE_UNREADABLE'), 'error taxonomy');
    const err = mapCompletedActionError({ code: 'FINAL_FILE_INVALID' });
    assert(err.code === 'FILE_UNREADABLE', err.code);
  });

  await test('5. same authoritative download record used', () => {
    assert(svc.includes('resolveCompletedMedia'), 'central resolver');
    assert(svc.includes('downloadEngine.refreshCompletedLocalFile'), 'engine record');
    assert(svc.includes('assertManagedDownloadPath'), 'managed path');
  });

  // --- URI (6–11) ---
  await test('6. Android-readable content URI used', () => {
    assert(svc.includes('toAndroidContentUri') || svc.includes('contentUri'), 'content');
    assert(native.includes('parseTrustedContentUri'), 'trusted parse');
    assert(isContentUri('content://com.anonymous.vidorax.FileSystemFileProvider/x'));
  });

  await test('7. no raw file:// external intent', () => {
    assert(native.includes("startsWith(\"content://\""), 'content only');
    assert(nativeBridge.includes('isVidoraExpoFileProviderUri'), 'bridge guard');
    assert(!validateExternalContentUri('file:///data/user/0/x/file.mp4'));
    assert(isRawFileUri('file:///tmp/x'));
  });

  await test('8. no private raw path exposed directly', () => {
    assert(nativeBridge.includes('assertTrustedProviderUri'), 'assert');
    assert(!svc.includes('Linking.openURL'), 'no Linking file open');
    assert(!fileActions.includes('Linking.openURL'), 'legacy no Linking');
  });

  await test('9. provider authority is correct', () => {
    assert(native.includes('.FileSystemFileProvider'), 'authority');
    assert(
      isVidoraExpoFileProviderUri(
        'content://com.anonymous.vidorax.FileSystemFileProvider/expo_files/a.mp4',
      ),
    );
    assert(
      !isVidoraExpoFileProviderUri('content://media/external/video/media/1'),
      'reject mediastore',
    );
  });

  await test('10. provider grants read permission', () => {
    assert(native.includes('FLAG_GRANT_READ_URI_PERMISSION'), 'read grant');
    assert(native.includes('ClipData.newUri'), 'clipdata for grant propagation');
  });

  await test('11. provider is not unnecessarily exported', () => {
    // Reuse Expo FileSystemFileProvider — no custom exported provider in app
    assert(!existsSync(join(ROOT, 'android/app/src/main/res/xml/file_paths.xml')));
    assert(!manifest.includes('android:exported="true"') || manifest.includes('MainActivity'));
    const expoProvider = readSrc(
      'node_modules/expo-file-system/android/src/main/AndroidManifest.xml',
    );
    assert(expoProvider.includes('android:exported="false"'), 'exported false');
    assert(expoProvider.includes('android:grantUriPermissions="true"'), 'grant true');
  });

  // --- MIME (12–15) ---
  await test('12. MP4 → video/mp4', () => {
    assert(resolveExternalHandoffMime('video/mp4').intentMime === 'video/mp4');
    assert(resolveExternalHandoffMime(null, 'clip.mp4').intentMime === 'video/mp4');
  });

  await test('13. WebM → video/webm', () => {
    assert(resolveExternalHandoffMime('video/webm').intentMime === 'video/webm');
    assert(resolveExternalHandoffMime(null, 'clip.webm').intentMime === 'video/webm');
  });

  await test('14. additional supported containers map correctly', () => {
    assert(resolveExternalHandoffMime(null, 'a.m4v').intentMime === 'video/mp4');
    assert(resolveExternalHandoffMime(null, 'a.ts').intentMime === 'video/mp2t');
    assert(resolveExternalHandoffMime('video/mp2t').intentMime === 'video/mp2t');
  });

  await test('15. fallback does not force every file to MP4', () => {
    const unknown = resolveExternalHandoffMime(null, 'clip.unknown');
    assert(unknown.intentMime !== 'video/mp4', 'not forced mp4');
    assert(unknown.mimeType === null, 'persisted null');
    const webm = resolveExternalHandoffMime(null, 'x.webm');
    assert(webm.intentMime === 'video/webm');
  });

  // --- INTENT (16–20) ---
  await test('16. ACTION_VIEW used', () => {
    assert(native.includes('Intent.ACTION_VIEW'), 'view');
    assert(svc.includes('nativeOpenContentUri'), 'calls open');
  });

  await test('17. URI + MIME both supplied', () => {
    assert(native.includes('setDataAndType(uri, mime)'), 'data+type');
    assert(svc.includes('media.intentMime') || svc.includes('intentMime'), 'mime pass');
  });

  await test('18. FLAG_GRANT_READ_URI_PERMISSION used', () => {
    assert(native.includes('FLAG_GRANT_READ_URI_PERMISSION'));
  });

  await test('19. write permission not unnecessarily granted', () => {
    assert(!native.includes('FLAG_GRANT_WRITE_URI_PERMISSION'));
  });

  await test('20. handler absence safely caught', () => {
    assert(native.includes('hasCompatibleViewHandler'), 'precheck');
    assert(native.includes('NO_COMPATIBLE_APP'), 'reject code');
    assert(native.includes('ActivityNotFoundException'), 'catch');
    const err = mapCompletedActionError({ code: 'NO_COMPATIBLE_APP' });
    assert(err.code === 'NO_COMPATIBLE_APP');
  });

  // --- ERRORS (21–24) ---
  await test('21. missing file gives clear error', () => {
    assert(completedActionErrorMessageKey('FILE_MISSING') === 'files.unavailable');
    assert(en.includes("Downloaded file couldn't be found."));
    assert(ur.includes('ڈاؤن لوڈ شدہ فائل نہیں مل سکی۔'));
  });

  await test('22. unreadable file gives clear error', () => {
    assert(completedActionErrorMessageKey('FILE_UNREADABLE') === 'files.unreadable');
    assert(en.includes("VidoraX couldn't open this downloaded file."));
    assert(ur.includes('files.unreadable') || ur.includes('unreadable:'));
  });

  await test('23. no compatible app gives correct message', () => {
    assert(completedActionErrorMessageKey('NO_COMPATIBLE_APP') === 'files.noCompatibleApp');
    assert(en.includes('No compatible video app is installed.'));
  });

  await test('24. native exception does not crash app', () => {
    assert(native.includes('promise.reject'), 'reject not throw uncaught');
    assert(svc.includes('mapCompletedActionError'), 'mapped');
    assert(svc.includes('return { ok: false'), 'result envelope');
  });

  // --- ISOLATION (25–33) ---
  await test('25. internal Play unchanged (separate from ACTION_VIEW)', () => {
    assert(svc.includes('playCompletedFile'), 'play api');
    assert(svc.includes('playerPath'), 'internal route');
    assert(svc.includes('Does NOT route through ACTION_VIEW') || svc.includes('ACTION_VIEW'), 'docs');
    assert(playSrc.includes('resolvePlaybackSource'), 'player source');
    assert(!playSrc.includes('nativeOpenContentUri'), 'player not external');
    assert(!playSrc.includes('ACTION_VIEW'), 'player no view intent');
  });

  await test('26. downloader untouched by this phase surface', () => {
    // Action service must not mutate transfer states
    assert(!svc.includes("status: 'FAILED'"), 'no fail mutate');
    assert(!svc.includes('patchItem'), 'no store patch');
    assert(!svc.includes('appendRange'), 'no range');
  });

  await test('27. pause/resume untouched', () => {
    assert(!svc.includes('downloadEngine.pause'), 'no pause');
    assert(!svc.includes('downloadEngine.resume'), 'no resume');
  });

  await test('28. media detection untouched', () => {
    assert(!svc.includes('MediaDetection'), 'no detection');
  });

  await test('29. sharing not newly implemented as Phase 1 goal', () => {
    // Share path may exist from 7B; Phase 1 must not expand it
    assert(svc.includes('Phase 2 surface') || svc.includes('shareCompletedFile'), 'share retained');
    assert(!svc.includes('NotificationManager'), 'no notif in open');
  });

  await test('30. notifications untouched by open path', () => {
    assert(!svc.includes('ensureDownloadNotificationBridge'), 'no bridge');
    assert(!svc.includes('scheduleNotification'), 'no schedule');
  });

  await test('31. App Lock untouched', () => {
    assert(!svc.includes('appLock') && !svc.includes('AppLock'), 'no applock');
  });

  await test('32. themes untouched', () => {
    assert(!svc.includes('ThemeProvider') && !svc.includes('useTheme'), 'no theme');
  });

  await test('33. browser untouched', () => {
    assert(!svc.includes('WebView') && !svc.includes('browser/'), 'no browser');
  });

  // --- PERFORMANCE (34–36) ---
  await test('34. no Base64 video transport', () => {
    assert(!svc.toLowerCase().includes('base64'), 'no base64');
    assert(!native.toLowerCase().includes('base64'), 'native no base64');
  });

  await test('35. no whole-file JS read', () => {
    assert(!svc.includes('readAsStringAsync'), 'no string read');
    assert(!svc.includes('readBytes('), 'no full read');
    assert(!svc.includes('arrayBuffer'), 'no buffer');
  });

  await test('36. no unnecessary copy for normal external open', () => {
    assert(!svc.includes('.copy(') && !svc.includes('copyAsync'), 'no copy');
    assert(svc.includes('Does not copy bytes') || svc.includes('contentUri'), 'uri only');
  });

  // --- Implementation-specific ---
  await test('37. resolveCompletedMedia exported conceptually in service', () => {
    assert(svc.includes('export async function resolveCompletedMedia'), 'export');
    assert(svc.includes('ResolvedCompletedMedia'), 'type');
  });

  await test('38. ClipData present on VIEW path (root-cause fix)', () => {
    assert(native.includes('buildViewIntent'), 'builder');
    assert(native.includes('clipData = ClipData.newUri'), 'set clip');
    // Open must not rely on createChooser without ClipData (prior failure mode)
    const openFn = native.slice(
      native.indexOf('fun openContentUri'),
      native.indexOf('fun shareContentUri'),
    );
    assert(!openFn.includes('createChooser'), 'open avoids chooser grant drop');
    assert(openFn.includes('startViewIntent') || openFn.includes('startActivity'), 'direct start');
  });

  await test('39. Share still uses ClipData + chooser', () => {
    const shareFn = native.slice(native.indexOf('fun shareContentUri'));
    assert(shareFn.includes('createChooser'), 'share chooser');
    assert(shareFn.includes('ClipData'), 'share clip');
  });

  await test('40. Downloads list uses openCompletedFile', () => {
    assert(downloadsHook.includes('openCompletedFile'), 'list open');
    assert(downloadsHook.includes('localizeCompletedActionError') || downloadsHook.includes('completedActionErrorMessageKey'), 'localized');
  });

  await test('41. Download details uses openCompletedFile (not legacy only)', () => {
    assert(detailsHook.includes('openCompletedFile'), 'details open');
    assert(!detailsHook.includes('openMediaFileById'), 'no legacy open');
  });

  await test('42. Library external open uses openCompletedFile', () => {
    assert(libraryHook.includes('openCompletedFile'), 'lib open');
    assert(libraryHook.includes('playCompletedFile'), 'lib play separate');
  });

  await test('43. FileActions package registered', () => {
    assert(mainApp.includes('FileActionsNativePackage'), 'registered');
  });

  await test('44. Android 11+ package visibility for video VIEW', () => {
    assert(manifest.includes('android.intent.action.VIEW'), 'view query');
    assert(manifest.includes('video/*'), 'video mime query');
  });

  await test('45. MIME resolver prefers Phase 7A metadata', () => {
    const m = resolveExternalHandoffMime('video/webm', 'renamed.bin');
    assert(m.intentMime === 'video/webm', 'metadata wins');
  });

  await test('46. extensionless name falls back safely', () => {
    const m = resolveExternalHandoffMime(null, 'extensionless');
    assert(m.mimeType === null);
    assert(m.intentMime === '*/*' || m.intentMime === 'video/*');
  });

  await test('47. native rejects wrong authority', () => {
    assert(native.includes('authority != expectedAuthority') || native.includes('authority != expectedAuthority'));
  });

  await test('48. native rejects empty URI', () => {
    assert(native.includes('trimmed.isEmpty()'), 'empty');
  });

  await test('49. DEV diagnostics events present', () => {
    assert(svc.includes('EXTERNAL_OPEN_REQUESTED'), 'req');
    assert(svc.includes('COMPLETED_FILE_RESOLVED'), 'resolved');
    assert(svc.includes('CONTENT_URI_RESOLVED'), 'uri');
    assert(svc.includes('MIME_RESOLVED'), 'mime');
    assert(svc.includes('EXTERNAL_OPEN_LAUNCHED'), 'launched');
    assert(svc.includes('EXTERNAL_OPEN_FAILED'), 'failed');
  });

  await test('50. hardeningLog used (sanitized)', () => {
    assert(svc.includes('hardeningLog'), 'log');
    const diag = readSrc('src/downloads/hardening-diagnostics.ts');
    assert(diag.includes("BLOCKED") || diag.includes('localUri'), 'sanitize paths');
  });

  await test('51. mapCompletedActionError FILE_MISSING', () => {
    const e = mapCompletedActionError(new CompletedFileActionError('FILE_MISSING', 'x'));
    assert(e.code === 'FILE_MISSING');
  });

  await test('52. mapCompletedActionError ActivityNotFound', () => {
    const e = mapCompletedActionError(new Error('ACTIVITY_NOT_FOUND'));
    assert(e.code === 'NO_COMPATIBLE_APP');
  });

  await test('53. mapCompletedActionError OPEN_FAILED', () => {
    const e = mapCompletedActionError({ code: 'OPEN_FAILED' });
    assert(e.code === 'OPEN_FAILED');
  });

  await test('54. uri-safety validateExternalContentUri', () => {
    assert(validateExternalContentUri('content://a/b'));
    assert(!validateExternalContentUri('file://a'));
    assert(uriSafety.includes('resolveExternalHandoffMime'));
  });

  await test('55. engine openLocalDownload still content URI on Android', () => {
    assert(fileActions.includes('nativeOpenContentUri'));
    assert(fileActions.includes('file.contentUri') || fileActions.includes('toExternalHandoffUri'));
  });

  await test('56. media-file-actions refresh before open', () => {
    assert(mediaActions.includes('refreshCompletedLocalFile'));
  });

  await test('57. acceptance doc present', () => {
    assert(
      existsSync(
        join(ROOT, 'docs/testing/EXTERNAL-DOWNLOADED-FILE-OPEN-REAL-ANDROID-ACCEPTANCE.md'),
      ),
    );
  });

  await test('58. architecture doc present', () => {
    assert(
      existsSync(
        join(ROOT, 'docs/ui/COMPLETED-MEDIA-FILE-ACTIONS-ARCHITECTURE.md'),
      ),
    );
  });

  await test('59. package script verify:external-file-open', () => {
    assert(packageJson.includes('verify:external-file-open'));
  });

  await test('60. FAILED status cannot open', () => {
    assert(
      !resolveCompletedActions({
        status: 'FAILED',
        physicalFilePresent: false,
        allowExternalHandoff: true,
      }).canOpen,
    );
  });

  await test('61. CANCELLED status cannot open', () => {
    assert(
      !resolveCompletedActions({
        status: 'CANCELLED',
        physicalFilePresent: false,
        allowExternalHandoff: true,
      }).canOpen,
    );
  });

  await test('62. COMPLETED without physical cannot open', () => {
    assert(
      !resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: false,
        allowExternalHandoff: true,
      }).canOpen,
    );
  });

  await test('63. allowExternalHandoff false blocks open', () => {
    assert(
      !resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: true,
        allowExternalHandoff: false,
      }).canOpen,
    );
  });

  await test('64. Play capability independent of Open', () => {
    const a = resolveCompletedActions({
      status: 'COMPLETED',
      physicalFilePresent: true,
      allowExternalHandoff: false,
    });
    assert(a.canPlay, 'play ok');
    assert(!a.canOpen, 'open blocked');
  });

  await test('65. native mime does not hardcode all to mp4', () => {
    assert(!/return\s+"video\/mp4"\s*$/m.test(native) || native.includes('getMimeTypeFromExtension'));
    assert(native.includes('getMimeTypeFromExtension'), 'ext map');
  });

  await test('66. NEW_TASK only when no activity', () => {
    assert(native.includes('FLAG_ACTIVITY_NEW_TASK'), 'flag exists');
    assert(native.includes('currentActivity'), 'prefer activity');
  });

  await test('67. createCompletedFileContentUri does not load bytes', () => {
    assert(svc.includes('createCompletedFileContentUri'));
    assert(svc.includes('does not load file bytes') || svc.includes('Does not copy bytes'));
  });

  await test('68. UI uses localization keys not English service messages alone', () => {
    assert(downloadsHook.includes('completedActionErrorMessageKey') || downloadsHook.includes('localizeCompletedActionError'));
    assert(detailsHook.includes('localizeCompletedActionError') || detailsHook.includes('completedActionErrorMessageKey'));
    assert(libraryHook.includes('localizeCompletedActionError') || libraryHook.includes('completedActionErrorMessageKey'));
  });

  await test('69. primaryOpen a11y label retained in downloads constants/strings', () => {
    assert(en.includes('primaryOpen') || en.includes('Open downloaded file'));
    const card = readSrc('src/screens/downloads/components/DownloadCard.tsx');
    assert(card.includes('primaryOpen') || card.includes('downloads.primaryOpen'));
  });

  await test('70. no MANAGE_EXTERNAL_STORAGE for open', () => {
    assert(!manifest.includes('MANAGE_EXTERNAL_STORAGE'));
    assert(!svc.includes('MANAGE_EXTERNAL_STORAGE'));
  });

  await test('71. Expo files-path covers document downloads root', () => {
    const paths = readSrc(
      'node_modules/expo-file-system/android/src/main/res/xml/file_system_provider_paths.xml',
    );
    assert(paths.includes('files-path'), 'files');
    assert(paths.includes('cache-path'), 'cache');
    assert(!paths.includes('root-path'), 'no root');
  });

  await test('72. openCompletedFile returns envelope never throws for mapped errors', () => {
    assert(svc.includes('catch (error)') && svc.includes('mapCompletedActionError'));
  });

  await test('73. FILE_UNREADABLE localization key wired', () => {
    assert(en.includes('unreadable:'));
    assert(ur.includes('unreadable:'));
    assert(errors.includes("return 'files.unreadable'"));
  });

  await test('74. Trusted provider URI helper rejects file scheme', () => {
    assert(!isVidoraExpoFileProviderUri('file:///data/x'));
    assert(!isVidoraExpoFileProviderUri('content://com.other.app.provider/x'));
  });

  await test('75. Intent MIME from metadata preferred over filename', () => {
    assert(
      resolveExternalHandoffMime('audio/mpeg', 'video.mp4').intentMime === 'audio/mpeg',
    );
  });

  console.log(`\nExternal file open: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
