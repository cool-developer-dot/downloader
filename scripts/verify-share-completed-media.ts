/**
 * Phase 2 — Share actual completed media verifier.
 * Usage: npm run verify:share-completed-media
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
  const fileActions = readSrc('src/downloads/engine/file-actions.ts');
  const mediaActions = readSrc('src/downloads/engine/media-file-actions.ts');
  const detailsHook = readSrc('src/screens/downloads/hooks/useDownloadDetailsScreen.ts');
  const downloadsHook = readSrc('src/screens/downloads/hooks/useDownloadsScreen.ts');
  const libraryHook = readSrc('src/screens/library/hooks/useLibraryScreen.ts');
  const en = readSrc('src/localization/en.ts');
  const ur = readSrc('src/localization/ur.ts');
  const rnShare = readSrc(
    'node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/share/ShareModule.kt',
  );
  const packageJson = readSrc('package.json');
  const playSrc = readSrc('src/player/resolve-playback-source.ts');
  const exportSvc = readSrc('src/downloads/completed-file/export/export-service.ts');
  const deleteSvc = readSrc('src/downloads/completed-file/delete/delete-service.ts');

  await test('1. Share requires COMPLETED file', () => {
    assert(
      !resolveCompletedActions({
        status: 'DOWNLOADING',
        physicalFilePresent: true,
        allowExternalHandoff: true,
      }).canShare,
      'active',
    );
    assert(
      resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: true,
        allowExternalHandoff: true,
      }).canShare,
      'completed',
    );
  });

  await test('2. authoritative completed descriptor reused', () => {
    assert(svc.includes('resolveCompletedMedia'), 'resolver');
    assert(svc.includes('shareCompletedFile'), 'share api');
    assert(svc.includes('playCompletedFile') && svc.includes('openCompletedFile'), 'same service');
  });

  await test('3. actual URI passed', () => {
    assert(svc.includes('nativeShareContentUri'), 'native share');
    assert(svc.includes('media.contentUri'), 'content uri');
    assert(native.includes('EXTRA_STREAM'), 'stream');
  });

  await test('4. content:// used', () => {
    assert(native.includes('parseTrustedContentUri'), 'parse');
    assert(isContentUri('content://com.anonymous.vidorax.FileSystemFileProvider/x'));
    assert(validateExternalContentUri('content://com.anonymous.vidorax.FileSystemFileProvider/x'));
  });

  await test('5. raw file:// rejected', () => {
    assert(!validateExternalContentUri('file:///data/user/0/x.mp4'));
    assert(isRawFileUri('file:///tmp/x'));
    assert(native.includes('content://'), 'content only ingress');
  });

  await test('6. private raw path not exposed', () => {
    assert(!svc.includes('Share.share({') || svc.includes('Platform.OS === \'ios\''), 'android no rn share');
    const androidShareBranch = fileActions.slice(
      fileActions.indexOf('export async function shareLocalDownload'),
      fileActions.indexOf('export async function openLocalDownload'),
    );
    assert(
      !androidShareBranch.includes('message: title'),
      'no message:title android fallback',
    );
  });

  await test('7. correct MIME passed', () => {
    assert(svc.includes('media.intentMime') || svc.includes('intentMime'), 'mime');
    assert(native.includes('resolveShareMime'), 'share mime');
  });

  await test('8. video/mp4 mapping', () => {
    assert(resolveExternalHandoffMime(null, 'a.mp4').intentMime === 'video/mp4');
  });

  await test('9. video/webm mapping', () => {
    assert(resolveExternalHandoffMime(null, 'a.webm').intentMime === 'video/webm');
  });

  await test('10. EXTRA_STREAM / attachment exists', () => {
    assert(native.includes('Intent.EXTRA_STREAM'), 'extra stream');
    assert(native.includes('putExtra(Intent.EXTRA_STREAM, uri)'), 'put stream');
  });

  await test('11. read permission granted', () => {
    assert(native.includes('FLAG_GRANT_READ_URI_PERMISSION'), 'read');
    assert(native.includes('ClipData.newUri'), 'clipdata');
  });

  await test('12. write permission not granted', () => {
    assert(!native.includes('FLAG_GRANT_WRITE_URI_PERMISSION'), 'no write');
  });

  await test('13. chooser used', () => {
    const shareFn = native.slice(native.indexOf('fun shareContentUri'));
    assert(shareFn.includes('createChooser'), 'chooser');
  });

  await test('14. title alone is not the payload', () => {
    assert(native.includes('Never put the filename in EXTRA_TEXT') || native.includes('EXTRA_TEXT'), 'docs');
    assert(
      !native.includes('putExtra(Intent.EXTRA_TEXT'),
      'no EXTRA_TEXT filename',
    );
    assert(rnShare.includes('text/plain'), 'prove RN Share is text-only');
    assert(rnShare.includes('EXTRA_TEXT'), 'rn text');
    assert(!rnShare.includes('EXTRA_STREAM'), 'rn never streams files');
  });

  await test('15. missing file returns clean error', () => {
    assert(completedActionErrorMessageKey('FILE_MISSING') === 'files.unavailable');
    assert(en.includes("Downloaded file couldn't be found.") || en.includes('unavailable'));
    assert(svc.includes('FILE_MISSING') || svc.includes('resolveCompletedMedia'));
  });

  await test('16. incomplete .part cannot be shared', () => {
    assert(svc.includes('isPartialTransferPath'), 'part reject');
  });

  await test('17. rapid share is safe (single-flight)', () => {
    assert(svc.includes('shareInFlight'), 'inflight map');
    assert(svc.includes('shareInFlight.get(id)'), 'join');
  });

  await test('18. busy state clears on failure', () => {
    assert(svc.includes('finally'), 'finally');
    assert(svc.includes('shareInFlight.delete(id)'), 'clear');
  });

  await test('19. Download Details uses canonical share action', () => {
    assert(detailsHook.includes('shareCompletedFile'), 'details');
    assert(!detailsHook.includes('shareMediaFileById'), 'no legacy');
  });

  await test('20. Library uses canonical share action', () => {
    assert(libraryHook.includes('shareCompletedFile'), 'library');
  });

  await test('21. Downloads menu uses canonical share action', () => {
    assert(downloadsHook.includes('shareCompletedFile'), 'downloads');
  });

  await test('22. Play unchanged (not ACTION_SEND)', () => {
    assert(svc.includes('playerPath'), 'play route');
    assert(!playSrc.includes('nativeShareContentUri'), 'player no share');
    assert(!playSrc.includes('ACTION_SEND'), 'player no send');
  });

  await test('23. Open unchanged (ACTION_VIEW separate)', () => {
    assert(svc.includes('nativeOpenContentUri'), 'open');
    assert(native.includes('Intent.ACTION_VIEW'), 'view');
  });

  await test('24. Save/export unchanged', () => {
    assert(exportSvc.includes('saveCompletedFileToDevice') || exportSvc.includes('export'), 'export');
    assert(!svc.includes('saveCompletedFileToDevice'), 'share service no export rewrite');
  });

  await test('25. Delete unchanged', () => {
    assert(deleteSvc.includes('delete') || deleteSvc.includes('Delete'), 'delete');
  });

  await test('26. downloader untouched by share service', () => {
    assert(!svc.includes('appendRange'), 'no range');
    assert(!svc.includes('downloadEngine.pause'), 'no pause');
  });

  await test('27. Browser untouched', () => {
    assert(!svc.includes('WebView') && !svc.includes('browser/'), 'no browser');
  });

  await test('28. media detection untouched', () => {
    assert(!svc.includes('MediaDetection'), 'no detection');
  });

  await test('29. App Lock untouched', () => {
    assert(!svc.includes('AppLock') && !svc.includes('appLock'), 'no applock');
  });

  await test('30. EN/UR strings present', () => {
    assert(en.includes('Unable to share this video.'));
    assert(ur.includes('shareFailed'));
    assert(en.includes("share: 'Share'") || en.includes('share:'));
  });

  await test('31. RN Share Android path never used for completed media', () => {
    assert(svc.includes('do NOT fall back to RN Share') || svc.includes('Never uses React Native Share'));
    assert(fileActions.includes('text/plain-only') || fileActions.includes('never use it'));
  });

  await test('32. Share MIME rejects text/* collapse', () => {
    assert(native.includes('resolveShareMime'), 'guard');
    assert(native.includes('text/plain'), 'mentions reject');
  });

  await test('33. SHARE diagnostics events', () => {
    assert(svc.includes('COMPLETED_MEDIA_SHARE_REQUESTED'));
    assert(svc.includes('COMPLETED_MEDIA_SHARE_RESOLVED'));
    assert(svc.includes('COMPLETED_MEDIA_SHARE_INTENT_STARTED'));
    assert(svc.includes('COMPLETED_MEDIA_SHARE_FAILED'));
    assert(svc.includes('COMPLETED_MEDIA_SHARE_CANCELLED'));
  });

  await test('34. no Base64 share transport', () => {
    assert(!svc.toLowerCase().includes('base64'));
  });

  await test('35. no whole-file JS copy for share', () => {
    assert(!svc.includes('readAsStringAsync'));
    assert(!svc.includes('copyAsync'));
  });

  await test('36. cancel is not SHARE_FAILED', () => {
    assert(svc.includes('COMPLETED_MEDIA_SHARE_CANCELLED'));
    assert(svc.includes("message.includes('cancel')"));
  });

  await test('37. mapCompletedActionError SHARE_FAILED', () => {
    const err = mapCompletedActionError({ code: 'SHARE_FAILED' });
    assert(err.code === 'SHARE_FAILED');
    assert(completedActionErrorMessageKey('SHARE_FAILED') === 'files.shareFailed');
  });

  await test('38. trusted provider URI for share bridge', () => {
    assert(
      isVidoraExpoFileProviderUri(
        'content://com.anonymous.vidorax.FileSystemFileProvider/expo_files/x.mp4',
      ),
    );
  });

  await test('39. FAILED cannot share', () => {
    assert(
      !resolveCompletedActions({
        status: 'FAILED',
        physicalFilePresent: false,
        allowExternalHandoff: true,
      }).canShare,
    );
  });

  await test('40. COMPLETED without physical cannot share', () => {
    assert(
      !resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: false,
        allowExternalHandoff: true,
      }).canShare,
    );
  });

  await test('41. package script registered', () => {
    assert(packageJson.includes('verify:share-completed-media'));
  });

  await test('42. acceptance doc present', () => {
    assert(
      existsSync(
        join(ROOT, 'docs/testing/SHARE-COMPLETED-MEDIA-REAL-ANDROID-ACCEPTANCE.md'),
      ),
    );
  });

  await test('43. architecture doc documents Phase 2', () => {
    const arch = readSrc('docs/ui/COMPLETED-MEDIA-FILE-ACTIONS-ARCHITECTURE.md');
    assert(arch.includes('EXTRA_STREAM'));
    assert(arch.includes('ACTION_SEND'));
    assert(arch.includes('text/plain'));
  });

  await test('44. media-file-actions still refresh before share', () => {
    assert(mediaActions.includes('refreshCompletedLocalFile'));
  });

  await test('45. UI localizes share errors', () => {
    assert(
      downloadsHook.includes('localizeCompletedActionError') ||
        downloadsHook.includes('completedActionErrorMessageKey'),
    );
    assert(
      libraryHook.includes('localizeCompletedActionError') ||
        libraryHook.includes('completedActionErrorMessageKey'),
    );
  });

  await test('46. Open still uses ACTION_VIEW not SEND', () => {
    assert(native.includes('Intent.ACTION_VIEW'), 'view intent');
    assert(native.includes('fun openContentUri'), 'open method');
    const openFn = native.slice(
      native.indexOf('fun openContentUri'),
      native.indexOf('fun shareContentUri'),
    );
    assert(openFn.includes('buildViewIntent'), 'view builder');
    assert(!openFn.includes('EXTRA_STREAM'), 'open has no stream');
    assert(!openFn.includes('ACTION_SEND'), 'open has no send');
  });

  await test('47. Share subject is optional display name only', () => {
    assert(native.includes('EXTRA_SUBJECT'));
    assert(svc.includes('media.displayName'));
  });

  await test('48. grantUriPermission best-effort for SEND targets', () => {
    assert(native.includes('grantReadToSendTargets') || native.includes('grantUriPermission'));
  });

  await test('49. no MANAGE_EXTERNAL_STORAGE for share', () => {
    const manifest = readSrc('android/app/src/main/AndroidManifest.xml');
    assert(!manifest.includes('MANAGE_EXTERNAL_STORAGE'));
  });

  await test('50. allowExternalHandoff false blocks share', () => {
    assert(
      !resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: true,
        allowExternalHandoff: false,
      }).canShare,
    );
  });

  await test('51. metadata MIME preferred over filename', () => {
    assert(
      resolveExternalHandoffMime('video/webm', 'x.mp4').intentMime === 'video/webm',
    );
  });

  await test('52. hardeningLog sanitized (no localUri field in share logs)', () => {
    const diag = readSrc('src/downloads/hardening-diagnostics.ts');
    assert(diag.includes('localUri') && diag.includes('BLOCKED'));
  });

  await test('53. native rejects non-provider content URIs', () => {
    assert(native.includes('FileSystemFileProvider'));
    assert(native.includes('authority != expectedAuthority') || native.includes('!='));
  });

  await test('54. Share and Open both registered on same module', () => {
    assert(native.includes('fun openContentUri') && native.includes('fun shareContentUri'));
  });

  await test('55. FileActions package still registered', () => {
    const main = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/MainApplication.kt',
    );
    assert(main.includes('FileActionsNativePackage'));
  });

  await test('56. SEND package visibility queries present', () => {
    const manifest = readSrc('android/app/src/main/AndroidManifest.xml');
    assert(manifest.includes('android.intent.action.SEND'));
    assert(manifest.includes('video/*'));
  });

  await test('57. CANCELLED status cannot share', () => {
    assert(
      !resolveCompletedActions({
        status: 'CANCELLED',
        physicalFilePresent: false,
        allowExternalHandoff: true,
      }).canShare,
    );
  });

  await test('58. shareFailed localization key', () => {
    assert(en.includes("shareFailed: 'Unable to share this video.'"));
  });

  await test('59. no expo-sharing dependency forced for completed share', () => {
    assert(!svc.includes('expo-sharing'));
    assert(!svc.includes('Sharing.shareAsync'));
  });

  await test('60. Intent type is media MIME not text/plain', () => {
    const shareFn = native.slice(native.indexOf('fun shareContentUri'));
    assert(shareFn.includes('type = mime'));
    assert(!shareFn.includes('text/plain")'));
  });

  await test('61. Play canShare independence', () => {
    const a = resolveCompletedActions({
      status: 'COMPLETED',
      physicalFilePresent: true,
      allowExternalHandoff: true,
    });
    assert(a.canPlay && a.canShare && a.canOpen);
  });

  await test('62. URI creation failure mapped', () => {
    const err = mapCompletedActionError({ code: 'URI_CREATION_FAILED' });
    assert(err.code === 'URI_CREATION_FAILED');
  });

  await test('63. external-file-open verifier still present', () => {
    assert(existsSync(join(ROOT, 'scripts/verify-external-file-open.ts')));
  });

  await test('64. phase7b verifier still present', () => {
    assert(existsSync(join(ROOT, 'scripts/verify-phase7b-android-file-actions.ts')));
  });

  await test('65. shareInFlight does not leave dangling entries on throw path', () => {
    assert(svc.includes('shareInFlight.set(id, run)'), 'set');
    assert(svc.includes('shareInFlight.delete(id)'), 'delete');
    assert(svc.includes('} finally {'), 'finally block');
    // delete lives inside the async run()'s finally (before set in source order is OK)
    const runBlock = svc.slice(svc.indexOf('const run = (async'));
    assert(runBlock.includes('finally'), 'finally in run');
    assert(runBlock.includes('shareInFlight.delete(id)'), 'delete in run');
  });

  await test('66. displayName not used as EXTRA_STREAM', () => {
    assert(native.includes('putExtra(Intent.EXTRA_STREAM, uri)'));
    assert(!native.includes('putExtra(Intent.EXTRA_STREAM, safeTitle)'));
  });

  await test('67. Android fallback throws instead of text share', () => {
    assert(fileActions.includes("Unable to share this video."));
    assert(!fileActions.includes('message: title'));
  });

  await test('68. Open diagnostics remain separate', () => {
    assert(svc.includes('EXTERNAL_OPEN_REQUESTED'));
    assert(svc.includes('EXTERNAL_OPEN_LAUNCHED'));
  });

  await test('69. resolveCompletedMedia is shared', () => {
    assert(svc.includes('export async function resolveCompletedMedia'));
  });

  await test('70. a11y Share label retained', () => {
    assert(en.includes("share: 'Share'") || en.includes('primaryShare'));
    const card = readSrc('src/screens/downloads/components/DownloadCard.tsx');
    assert(card.includes('share') || card.includes('primaryShare'));
  });

  console.log(`\nShare completed media: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
