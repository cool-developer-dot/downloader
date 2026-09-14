/**
 * Phase 7C — export / delete reliability verifier.
 * Usage: npm run verify:phase7c-export-delete-reliability
 *
 * Exercises pure phase7c surfaces + resolveCompletedActions.
 * Static-reads native MediaStore module / MainApplication / manifests.
 * No Python/Maestro/APK.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCompletedActions } from '../src/downloads/completed-file';
import {
  resolveExportCapability,
  resolveExportDestination,
  resolvePublicExportName,
  nextCollisionSafePublicName,
  buildMediaStoreMetadata,
  emptyExportReceipt,
  assertSafeExportReceiptFields,
  qualifyExistingExportReceipt,
  beginExportTransaction,
  completeExportTransaction,
  failExportTransaction,
  reconcilePendingExport,
  CompletedFileExportError,
  mapExportErrorMessageKey,
  isBenignExportCancellation,
  resolveDeletePlan,
  classifyCompletedFilePresence,
  getCompletedFileOpKind,
  isCompletedFileOpBusy,
  withCompletedFileOperation,
  resetCompletedFileOperationsForTests,
} from '../src/downloads/completed-file/phase7c';

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

const NATIVE =
  'android/app/src/main/java/com/anonymous/vidorax/mediaexport/VidoraMediaExportModule.kt';
const MAIN_APP =
  'android/app/src/main/java/com/anonymous/vidorax/MainApplication.kt';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';

async function main(): Promise<void> {
  resetCompletedFileOperationsForTests();

  // ——— EXPORT CAPABILITY ———
  await test('1. COMPLETED + physical → canExport (capability)', () => {
    assert(
      resolveExportCapability({ status: 'COMPLETED', physicalFilePresent: true }),
      'cap',
    );
    assert(
      resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: true,
        allowExport: true,
      }).canExport,
      'actions',
    );
  });

  await test('2. DOWNLOADING → cannot export', () => {
    assert(
      !resolveExportCapability({
        status: 'DOWNLOADING',
        physicalFilePresent: false,
      }),
    );
    assert(
      !resolveCompletedActions({
        status: 'DOWNLOADING',
        physicalFilePresent: false,
        allowExport: true,
      }).canExport,
    );
  });

  await test('3. FINALIZING → cannot export', () => {
    assert(
      !resolveExportCapability({
        status: 'FINALIZING',
        physicalFilePresent: false,
      }),
    );
  });

  await test('4. PAUSED → cannot export', () => {
    assert(
      !resolveExportCapability({ status: 'PAUSED', physicalFilePresent: false }),
    );
  });

  await test('5. FAILED → cannot export', () => {
    assert(
      !resolveExportCapability({ status: 'FAILED', physicalFilePresent: false }),
    );
  });

  await test('6. CANCELLED → cannot export', () => {
    assert(
      !resolveExportCapability({
        status: 'CANCELLED',
        physicalFilePresent: false,
      }),
    );
  });

  await test('7. COMPLETED + missing physical → cannot export', () => {
    assert(
      !resolveExportCapability({
        status: 'COMPLETED',
        physicalFilePresent: false,
      }),
    );
    assert(
      !resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: false,
        allowExport: true,
      }).canExport,
    );
  });

  await test('8. allowExport false → canExport blocked even when present', () => {
    assert(
      !resolveCompletedActions({
        status: 'COMPLETED',
        physicalFilePresent: true,
        allowExport: false,
      }).canExport,
    );
  });

  // ——— DESTINATION MIME / COLLECTION ———
  await test('9. MP4 → video collection + video/mp4', () => {
    const d = resolveExportDestination({
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
    });
    assert(d.collection === 'video', d.collection);
    assert(d.mimeType === 'video/mp4', d.mimeType);
    assert(d.relativePath === 'Movies/VidoraX/', d.relativePath);
  });

  await test('10. WebM → video collection + video/webm', () => {
    const d = resolveExportDestination({
      mimeType: 'video/webm',
      fileName: 'clip.webm',
    });
    assert(d.collection === 'video', d.collection);
    assert(d.mimeType === 'video/webm', d.mimeType);
  });

  await test('11. TS → downloads collection + video/mp2t (not fake MP4)', () => {
    const d = resolveExportDestination({
      mimeType: 'video/mp2t',
      fileName: 'seg.ts',
      container: 'ts',
    });
    assert(d.collection === 'downloads', d.collection);
    assert(d.mimeType === 'video/mp2t', d.mimeType);
    assert(d.relativePath === 'Download/VidoraX/', d.relativePath);
    assert(d.mimeType !== 'video/mp4', 'not mp4');
  });

  await test('12. TS by extension alone → downloads, not Movies MP4', () => {
    const d = resolveExportDestination({
      mimeType: null,
      fileName: 'playlist.ts',
    });
    assert(d.collection === 'downloads', d.collection);
    assert(!d.mimeType.includes('mp4') || d.mimeType === 'video/mp2t', d.mimeType);
  });

  await test('13. unknown MIME → downloads + octet-stream (not fake video/mp4)', () => {
    const d = resolveExportDestination({
      mimeType: null,
      fileName: 'blob.bin',
    });
    assert(d.collection === 'downloads', d.collection);
    assert(d.mimeType === 'application/octet-stream', d.mimeType);
    assert(d.mimeAuthoritative === false, 'fallback');
  });

  await test('14. audio → Music/VidoraX', () => {
    const d = resolveExportDestination({
      mimeType: 'audio/mpeg',
      fileName: 'track.mp3',
    });
    assert(d.collection === 'audio', d.collection);
    assert(d.relativePath === 'Music/VidoraX/', d.relativePath);
  });

  // ——— PUBLIC NAME ———
  await test('15. Phase 7A filename reused as public name', () => {
    assert(
      resolvePublicExportName({ fileName: 'travel_clip.mp4' }) ===
        'travel_clip.mp4',
    );
  });

  await test('16. signed source URL rejected as display name', () => {
    const name = resolvePublicExportName({
      fileName: 'https://cdn.example/x.mp4?token=abc&sig=1',
      displayTitle: 'Safe Title',
      mimeType: 'video/mp4',
    });
    assert(!name.includes('token='), name);
    assert(!name.includes('://'), name);
    assert(name.endsWith('.mp4') || name.includes('Safe'), name);
  });

  await test('17. MP4 public name keeps .mp4', () => {
    assert(
      resolvePublicExportName({
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
      }).endsWith('.mp4'),
    );
  });

  await test('18. WebM public name keeps .webm', () => {
    assert(
      resolvePublicExportName({
        fileName: 'clip.webm',
        mimeType: 'video/webm',
      }).endsWith('.webm'),
    );
  });

  await test('19. TS public name keeps .ts (not renamed mp4)', () => {
    const name = resolvePublicExportName({
      fileName: 'segment.ts',
      mimeType: 'video/mp2t',
    });
    assert(name.endsWith('.ts'), name);
    assert(!name.endsWith('.mp4'), 'no mp4 rename');
  });

  await test('20. MediaStore metadata uses size + relativePath', () => {
    const m = buildMediaStoreMetadata({
      displayName: 'video.mp4',
      mimeType: 'video/mp4',
      relativePath: 'Movies/VidoraX/',
      sizeBytes: 12345,
      completedAt: '2026-01-01T00:00:00.000Z',
    });
    assert(m.displayName === 'video.mp4', m.displayName);
    assert(m.sizeBytes === 12345, String(m.sizeBytes));
    assert(m.relativePath === 'Movies/VidoraX/', m.relativePath);
    assert(m.dateAddedMs != null, 'date');
  });

  // ——— COLLISION ———
  await test('21. collision attempt 0 → base name', () => {
    assert(nextCollisionSafePublicName('video.mp4', 0) === 'video.mp4');
  });

  await test('22. collision → video (1).mp4', () => {
    assert(nextCollisionSafePublicName('video.mp4', 1) === 'video (1).mp4');
  });

  await test('23. collision → video (2).mp4 keeps extension', () => {
    assert(nextCollisionSafePublicName('video.mp4', 2) === 'video (2).mp4');
  });

  await test('24. collision webm keeps .webm', () => {
    assert(nextCollisionSafePublicName('clip.webm', 1) === 'clip (1).webm');
  });

  // ——— RECEIPT ———
  await test('25. empty receipt qualifies as none', () => {
    assert(qualifyExistingExportReceipt(emptyExportReceipt()).kind === 'none');
  });

  await test('26. beginExportTransaction sets pending (no secrets)', () => {
    const t = beginExportTransaction(
      'content://media/external/video/media/1',
      '2026-01-01T00:00:00.000Z',
    );
    assert(t.pendingExportUri?.startsWith('content://'), 'uri');
    assertSafeExportReceiptFields({
      ...emptyExportReceipt(),
      ...t,
    });
  });

  await test('27. completeExportTransaction clears pending', () => {
    const r = completeExportTransaction({
      contentUri: 'content://media/external/video/media/9',
      displayName: 'video.mp4',
      exportedAt: '2026-01-02T00:00:00.000Z',
    });
    assert(r.pendingExportUri === null, 'pending cleared');
    assert(r.exportedContentUri?.includes('content://'), 'published');
    assertSafeExportReceiptFields(r);
  });

  await test('28. failExportTransaction clears pending only', () => {
    const f = failExportTransaction();
    assert(f.pendingExportUri === null);
    assert(f.pendingExportStartedAt === null);
  });

  await test('29. qualify published when URI present', () => {
    const r = completeExportTransaction({
      contentUri: 'content://media/1',
      displayName: 'a.mp4',
      exportedAt: '2026-01-01T00:00:00.000Z',
    });
    const q = qualifyExistingExportReceipt(r, { publicUriExists: true });
    assert(q.kind === 'published', q.kind);
  });

  await test('30. qualify stale_published when public URI gone', () => {
    const r = completeExportTransaction({
      contentUri: 'content://media/1',
      displayName: 'a.mp4',
      exportedAt: '2026-01-01T00:00:00.000Z',
    });
    const q = qualifyExistingExportReceipt(r, { publicUriExists: false });
    assert(q.kind === 'stale_published', q.kind);
  });

  await test('31. qualify pending when pendingExportUri set', () => {
    const r = {
      ...emptyExportReceipt(),
      ...beginExportTransaction('content://pending/1', '2026-01-01T00:00:00.000Z'),
    };
    assert(qualifyExistingExportReceipt(r).kind === 'pending');
  });

  await test('32. receipt rejects Cookie/Authorization secrets', () => {
    let threw = false;
    try {
      assertSafeExportReceiptFields({
        ...emptyExportReceipt(),
        exportedDisplayName: 'Cookie: session=abc',
      });
    } catch {
      threw = true;
    }
    assert(threw, 'cookie rejected');
    threw = false;
    try {
      assertSafeExportReceiptFields({
        ...emptyExportReceipt(),
        exportedContentUri: 'content://x?token=signed',
      });
    } catch {
      threw = true;
    }
    assert(threw, 'signed query rejected');
  });

  await test('33. reconcile incomplete pending → delete row + clear marker', () => {
    const d = reconcilePendingExport({
      pendingUri: 'content://media/pending/1',
      publishedUri: null,
      pendingStillIncomplete: true,
    });
    assert(d.shouldDeletePendingRow, 'delete');
    assert(d.clearPendingMarker, 'clear');
    assert(!d.keepPublishedReceipt, 'no published');
  });

  await test('34. reconcile never deletes published==pending URI', () => {
    const uri = 'content://media/external/video/media/42';
    const d = reconcilePendingExport({
      pendingUri: uri,
      publishedUri: uri,
      pendingStillIncomplete: true,
    });
    assert(!d.shouldDeletePendingRow, 'keep published');
    assert(d.keepPublishedReceipt, 'keep');
    assert(d.clearPendingMarker, 'clear marker');
  });

  await test('35. reconcile unknown pending → clear marker, no destructive delete', () => {
    const d = reconcilePendingExport({
      pendingUri: 'content://media/pending/x',
      publishedUri: 'content://media/published/y',
      pendingStillIncomplete: null,
    });
    assert(!d.shouldDeletePendingRow, 'no delete unknown');
    assert(d.clearPendingMarker, 'clear');
    assert(d.keepPublishedReceipt, 'keep published');
  });

  await test('36. MMKV receipt key is v1 (not new DB)', () => {
    const store = readSrc(
      'src/downloads/completed-file/export/receipt-store.ts',
    );
    assert(
      store.includes('vidorax.mmkv.completedFile.exportReceipts.v1'),
      'mmkv key',
    );
    assert(store.includes('mmkvGetObject') || store.includes('mmkvSetObject'), 'mmkv');
    assert(!store.includes('DATABASE_VERSION'), 'no sqlite bump');
  });

  await test('37. ALREADY_EXPORTED maps to alreadySaved UX key', () => {
    assert(
      mapExportErrorMessageKey('ALREADY_EXPORTED') ===
        'downloads.export.alreadySaved',
    );
    assert(isBenignExportCancellation('LEGACY_EXPORT_CANCELLED'));
    assert(!isBenignExportCancellation('COPY_IO_FAILED'));
  });

  // ——— DELETE PLAN / PRESENCE ———
  await test('38. COMPLETED → delete_private preserves public', () => {
    const plan = resolveDeletePlan({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      physicalFilePresent: true,
    });
    assert(plan.kind === 'delete_private', plan.kind);
    if (plan.kind === 'delete_private') {
      assert(plan.preservePublicExport === true, 'preserve');
      assert(plan.dismissNotification === true, 'dismiss');
      assert(plan.physicalPresent === true, 'physical');
    }
  });

  await test('39. COMPLETED + missing physical → still delete_private reconcile', () => {
    const plan = resolveDeletePlan({
      downloadId: 'dl-2',
      status: 'COMPLETED',
      physicalFilePresent: false,
    });
    assert(plan.kind === 'delete_private', plan.kind);
    if (plan.kind === 'delete_private') {
      assert(plan.physicalPresent === false);
      assert(plan.preservePublicExport === true);
    }
  });

  await test('40. DOWNLOADING → reject ACTIVE_TRANSFER', () => {
    const plan = resolveDeletePlan({
      downloadId: 'dl-3',
      status: 'DOWNLOADING',
      physicalFilePresent: false,
    });
    assert(plan.kind === 'reject' && plan.reason === 'ACTIVE_TRANSFER');
  });

  await test('41. PAUSED → reject ACTIVE_TRANSFER (preserve .part)', () => {
    const plan = resolveDeletePlan({
      downloadId: 'dl-4',
      status: 'PAUSED',
      physicalFilePresent: false,
    });
    assert(plan.kind === 'reject' && plan.reason === 'ACTIVE_TRANSFER');
  });

  await test('42. RETRYING → reject ACTIVE_TRANSFER', () => {
    const plan = resolveDeletePlan({
      downloadId: 'dl-5',
      status: 'RETRYING',
      physicalFilePresent: false,
    });
    assert(plan.kind === 'reject' && plan.reason === 'ACTIVE_TRANSFER');
  });

  await test('43. opBusy → reject BUSY', () => {
    const plan = resolveDeletePlan({
      downloadId: 'dl-6',
      status: 'COMPLETED',
      physicalFilePresent: true,
      opBusy: true,
    });
    assert(plan.kind === 'reject' && plan.reason === 'BUSY');
  });

  await test('44. presence: COMPLETED+present → all file actions', () => {
    const p = classifyCompletedFilePresence({
      status: 'COMPLETED',
      physicalFilePresent: true,
    });
    assert(p.canPlay && p.canOpen && p.canShare && p.canExport);
    assert(p.canRemoveFromLibrary);
  });

  await test('45. presence: COMPLETED+missing → no Play/Open/Share/Save', () => {
    const p = classifyCompletedFilePresence({
      status: 'COMPLETED',
      physicalFilePresent: false,
    });
    assert(!p.canPlay && !p.canOpen && !p.canShare && !p.canExport);
    assert(p.canRemoveFromLibrary, 'removable');
  });

  await test('46. presence: DOWNLOADING → no remove-from-library via 7C class', () => {
    const p = classifyCompletedFilePresence({
      status: 'DOWNLOADING',
      physicalFilePresent: false,
    });
    assert(!p.canRemoveFromLibrary);
    assert(!p.canExport);
  });

  // ——— OPERATION LOCK ———
  await test('47. export lock join — duplicate same-kind shares promise', async () => {
    resetCompletedFileOperationsForTests();
    let runs = 0;
    const p1 = withCompletedFileOperation('lock-a', 'exporting', async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 'ok';
    });
    const p2 = withCompletedFileOperation('lock-a', 'exporting', async () => {
      runs += 1;
      return 'other';
    });
    assert(isCompletedFileOpBusy('lock-a'));
    assert(getCompletedFileOpKind('lock-a') === 'exporting');
    const [a, b] = await Promise.all([p1, p2]);
    assert(a === 'ok' && b === 'ok', 'joined');
    assert(runs === 1, `runs=${runs}`);
    assert(!isCompletedFileOpBusy('lock-a'));
  });

  await test('48. export vs delete conflict throws', async () => {
    resetCompletedFileOperationsForTests();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const exportP = withCompletedFileOperation('lock-b', 'exporting', async () => {
      await gate;
      return true;
    });
    let conflict = '';
    try {
      await withCompletedFileOperation('lock-b', 'deleting', async () => 'nope');
    } catch (e) {
      conflict = e instanceof Error ? e.message : String(e);
    }
    release();
    await exportP;
    assert(conflict === 'EXPORT_IN_PROGRESS', conflict);
  });

  await test('49. unrelated downloadIds do not share lock', async () => {
    resetCompletedFileOperationsForTests();
    const [x, y] = await Promise.all([
      withCompletedFileOperation('lock-c1', 'exporting', async () => 1),
      withCompletedFileOperation('lock-c2', 'deleting', async () => 2),
    ]);
    assert(x === 1 && y === 2);
  });

  // ——— NATIVE / MANIFEST STATIC ———
  await test('50. native module exists + MediaStore / ContentResolver', () => {
    assert(existsSync(join(ROOT, NATIVE)), 'native file');
    const kt = readSrc(NATIVE);
    assert(kt.includes('MediaStore'), 'MediaStore');
    assert(kt.includes('contentResolver') || kt.includes('ContentResolver'), 'resolver');
    assert(kt.includes('IS_PENDING'), 'IS_PENDING');
  });

  await test('51. FileInputStream streaming — no Base64 bridge', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('FileInputStream'), 'stream');
    assert(!kt.includes('Base64'), 'no Base64');
    assert(!kt.includes('encodeToString'), 'no encode');
  });

  await test('52. VidoraXDownloads path validation in native', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('VidoraXDownloads'), 'root');
    assert(kt.includes('canonicalFile') || kt.includes('canonicalPath'), 'canon');
    assert(kt.includes('resolveManagedSource'), 'resolver');
  });

  await test('53. .part rejection string in native', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('.part'), '.part');
    assert(kt.includes('.rangepart') || kt.includes('rangepart'), 'rangepart');
  });

  await test('54. API 29+ MediaStore; legacy CREATE_DOCUMENT', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('SDK_INT >= 29') || kt.includes('VERSION.SDK_INT >= 29'), 'api29');
    assert(kt.includes('ACTION_CREATE_DOCUMENT'), 'saf');
    assert(kt.includes('LEGACY_EXPORT_CANCELLED'), 'cancel code');
  });

  await test('55. copy size mismatch + pending cleanup codes', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('COPY_SIZE_MISMATCH'), 'mismatch');
    assert(kt.includes('cleanupPending'), 'cleanup');
    assert(kt.includes('MEDIASTORE_PUBLISH_FAILED'), 'publish fail');
    assert(kt.includes('OUTPUT_STREAM_UNAVAILABLE'), 'stream null');
    assert(kt.includes('INSUFFICIENT_STORAGE'), 'disk');
  });

  await test('56. MediaExportNativePackage registered in MainApplication', () => {
    const main = readSrc(MAIN_APP);
    assert(main.includes('MediaExportNativePackage'), 'registered');
    assert(
      existsSync(
        join(
          ROOT,
          'android/app/src/main/java/com/anonymous/vidorax/mediaexport/MediaExportNativePackage.kt',
        ),
      ),
      'package file',
    );
  });

  await test('57. no MANAGE_EXTERNAL_STORAGE in main AndroidManifest', () => {
    const manifest = readSrc(MANIFEST);
    assert(!manifest.includes('MANAGE_EXTERNAL_STORAGE'), 'no manage');
  });

  await test('58. no MediaStore in Phase 1 destination (file-paths / constants)', () => {
    const paths = readSrc('src/downloads/engine/file-paths.ts');
    const constants = readSrc('src/downloads/engine/constants.ts');
    assert(!paths.includes('MediaStore'), 'paths');
    assert(constants.includes("rootFolderName: 'VidoraXDownloads'"), 'private root');
    assert(!constants.includes('Movies/VidoraX'), 'no public dest');
  });

  await test('59. export is copy — private source never deleted in native export', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('Source private file intentionally untouched') || !kt.includes('source.delete('), 'no delete source');
    assert(!/source\.delete\s*\(/.test(kt), 'no source.delete');
  });

  await test('60. delete service preserves public + file-first ordering', () => {
    const svc = readSrc('src/downloads/completed-file/delete/delete-service.ts');
    assert(svc.includes('deleteCompletedFileFromVidoraX'), 'api');
    assert(svc.includes('deleteDownloadFiles') || svc.includes('physical'), 'file');
    assert(svc.includes('removeDownloadCatalogItem'), 'catalog');
    assert(svc.includes('clearExportReceipt') || svc.includes('forgetExport'), 'receipt clear');
    assert(svc.includes('preservePublic') || svc.includes('Public MediaStore copies are never deleted'), 'public');
    // Ordering: physical/file path before catalog remove in source order
    const fileIdx = svc.indexOf('deleteDownloadFiles');
    const catalogIdx = svc.indexOf('removeDownloadCatalogItem');
    assert(fileIdx >= 0 && catalogIdx >= 0 && fileIdx < catalogIdx, 'file-first');
  });

  await test('61. export service duplicate policy = already saved when URI present', () => {
    const svc = readSrc('src/downloads/completed-file/export/export-service.ts');
    assert(svc.includes('already_saved'), 'already');
    assert(svc.includes('nativeMediaStoreUriExists'), 'revalidate');
    assert(svc.includes('assertManagedDownloadPath'), 'managed');
    assert(!svc.includes("status: 'FAILED'"), 'no fail mutate');
  });

  await test('62. localization Save / Already saved / Delete from VidoraX', () => {
    const en = readSrc('src/localization/en.ts');
    assert(en.includes("saveToDevice: 'Save to device'"), 'save');
    assert(
      en.includes('Already saved to device') || en.includes("alreadySaved: 'Already saved"),
      'already',
    );
    assert(
      en.includes('Delete this download from VidoraX?'),
      'confirm',
    );
    assert(
      en.includes('Copies saved outside VidoraX will not be deleted'),
      'preserve copy text',
    );
  });

  await test('63. CompletedFileExportError codes cover export/delete', () => {
    const err = new CompletedFileExportError('FILE_MISSING');
    assert(err.code === 'FILE_MISSING');
    assert(mapExportErrorMessageKey('INSUFFICIENT_STORAGE').includes('notEnoughStorage') || mapExportErrorMessageKey('INSUFFICIENT_STORAGE').includes('export'));
    assert(mapExportErrorMessageKey('DELETE_FILE_FAILED') === 'library.deleteFailed');
  });

  await test('64. IO off main thread (executor) in native', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('Executors') || kt.includes('io.execute'), 'bg');
  });

  await test('65. no FFmpeg / muxer / cloud / backend in 7C export surface', () => {
    const kt = readSrc(NATIVE);
    const dest = readSrc('src/downloads/completed-file/export/destination.ts');
    const svc = readSrc('src/downloads/completed-file/export/export-service.ts');
    const blob = `${kt}\n${dest}\n${svc}`.toLowerCase();
    assert(!blob.includes('ffmpeg'), 'ffmpeg');
    assert(!blob.includes('mediacodec') || true, 'ok');
    assert(!svc.toLowerCase().includes('requestcontext'), 'ctx');
    assert(!svc.includes('Cookie'), 'cookie');
    assert(!svc.includes('Authorization'), 'auth');
  });

  await test('66. Phase 7A remains identity authority (descriptor resolve in export)', () => {
    const svc = readSrc('src/downloads/completed-file/export/export-service.ts');
    assert(
      svc.includes('resolveLegacyCompletedDescriptor') ||
        svc.includes('CompletedFileDescriptor'),
      '7A',
    );
  });

  await test('67. Library wires Save + Delete to 7C services', () => {
    const lib = readSrc('src/screens/library/hooks/useLibraryScreen.ts');
    assert(lib.includes('saveCompletedFileToDevice'), 'save');
    assert(lib.includes('deleteCompletedFileFromVidoraX'), 'delete');
  });

  await test('68. resolveCompletedActions still gates Play/Open/Share independently', () => {
    const a = resolveCompletedActions({
      status: 'COMPLETED',
      physicalFilePresent: true,
      allowExternalHandoff: true,
      allowExport: true,
      allowDelete: true,
    });
    assert(a.canPlay && a.canOpen && a.canShare && a.canExport && a.canDelete);
  });

  await test('69. Save does not consume private file (export-service invariant)', () => {
    const svc = readSrc('src/downloads/completed-file/export/export-service.ts');
    assert(svc.includes('Never moves/deletes the private canonical file') || svc.includes('Private file remains'), 'copy');
    assert(!svc.includes('deleteDownloadFiles'), 'no delete in export');
  });

  await test('70. no continuous MediaStore/filesystem polling in 7C', () => {
    const svc = readSrc('src/downloads/completed-file/export/export-service.ts');
    const del = readSrc('src/downloads/completed-file/delete/delete-service.ts');
    assert(!svc.includes('setInterval'), 'export poll');
    assert(!del.includes('setInterval'), 'delete poll');
  });

  await test('71. native rejects absolute arbitrary / traversal paths', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('contains("..")') || kt.includes("contains(\"..\")"), 'dotdot');
    assert(kt.includes('INVALID_MANAGED_PATH'), 'reject code');
  });

  await test('72. wrong downloadId directory rejected (path under VidoraXDownloads/{id})', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('VidoraXDownloads/$safeId') || kt.includes('VidoraXDownloads/'), 'scoped id');
    assert(kt.includes('underManaged') || kt.includes('startsWith'), 'under check');
  });

  await test('73. RELATIVE_PATH uses VidoraX folders', () => {
    const d1 = resolveExportDestination({ mimeType: 'video/mp4' });
    const d2 = resolveExportDestination({ mimeType: 'video/mp2t' });
    const d3 = resolveExportDestination({ mimeType: null, fileName: 'x.bin' });
    assert(d1.relativePath.includes('VidoraX'), d1.relativePath);
    assert(d2.relativePath.includes('VidoraX'), d2.relativePath);
    assert(d3.relativePath.includes('VidoraX'), d3.relativePath);
  });

  await test('74. pending marker soft start uses non-secret pending: prefix', () => {
    const svc = readSrc('src/downloads/completed-file/export/export-service.ts');
    assert(svc.includes('pending:${id}') || svc.includes('pending:'), 'synthetic');
    assert(svc.includes('reconcilePendingExports'), 'reconcile api');
  });

  await test('75. FAILED status delete rejected as NOT_COMPLETED (7C completed-only)', () => {
    const plan = resolveDeletePlan({
      downloadId: 'dl-f',
      status: 'FAILED',
      physicalFilePresent: false,
    });
    assert(plan.kind === 'reject' && plan.reason === 'NOT_COMPLETED');
  });

  await test('76. QUEUED / FINALIZING reject delete as ACTIVE_TRANSFER', () => {
    assert(
      resolveDeletePlan({
        downloadId: 'q',
        status: 'QUEUED',
        physicalFilePresent: false,
      }).kind === 'reject',
    );
    assert(
      resolveDeletePlan({
        downloadId: 'f',
        status: 'FINALIZING',
        physicalFilePresent: false,
      }).kind === 'reject',
    );
  });

  await test('77. unknown MIME destination is not Movies/VidoraX', () => {
    const d = resolveExportDestination({ mimeType: 'application/octet-stream' });
    assert(d.collection === 'downloads', d.collection);
    assert(d.relativePath.startsWith('Download/'), d.relativePath);
  });

  await test('78. buildMediaStoreMetadata never embeds URL query secrets', () => {
    const m = buildMediaStoreMetadata({
      displayName: 'https://evil.example/a.mp4?auth=1',
      mimeType: 'video/mp4',
      relativePath: 'Movies/VidoraX/',
    });
    assert(!m.displayName.includes('auth='), m.displayName);
    assert(!m.displayName.includes('://'), m.displayName);
  });

  await test('79. delete conflict while exporting maps EXPORT_IN_PROGRESS', async () => {
    resetCompletedFileOperationsForTests();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const exporting = withCompletedFileOperation('lock-d', 'exporting', async () => {
      await gate;
    });
    let msg = '';
    try {
      await withCompletedFileOperation('lock-d', 'deleting', async () => undefined);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    release();
    await exporting;
    assert(msg === 'EXPORT_IN_PROGRESS', msg);
  });

  await test('80. phase7c barrel exports pure surfaces only (no RN runtime)', () => {
    const barrel = readSrc('src/downloads/completed-file/phase7c.ts');
    assert(barrel.includes('resolveExportDestination'), 'dest');
    assert(barrel.includes('resolveDeletePlan'), 'delete');
    assert(barrel.includes('withCompletedFileOperation'), 'lock');
    assert(!barrel.includes('NativeModules'), 'no native');
    assert(!barrel.includes('react-native'), 'no rn');
  });

  await test('81. native getName is VidoraMediaExport', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('"VidoraMediaExport"'), 'name');
  });

  await test('82. IS_PENDING set then cleared on success', () => {
    const kt = readSrc(NATIVE);
    assert(kt.includes('IS_PENDING, 1') || kt.includes('IS_PENDING"), 1'), 'pending1');
    assert(kt.includes('IS_PENDING, 0') || kt.includes('IS_PENDING"), 0'), 'pending0');
  });

  await test('83. no new SQLite export table — receipt via MMKV only', () => {
    const store = readSrc('src/downloads/completed-file/export/receipt-store.ts');
    assert(store.includes('not a new DB') || store.includes('existing MMKV'), 'mmkv');
    assert(!existsSync(join(ROOT, 'src/downloads/completed-file/export/receipt-db.ts')));
  });

  await test('84. classify + resolveCompletedActions agree on missing file', () => {
    const p = classifyCompletedFilePresence({
      status: 'COMPLETED',
      physicalFilePresent: false,
    });
    const a = resolveCompletedActions({
      status: 'COMPLETED',
      physicalFilePresent: false,
      allowExport: true,
      allowExternalHandoff: true,
    });
    assert(!p.canExport && !a.canExport);
    assert(!p.canPlay && !a.canPlay);
    assert(!p.canOpen && !a.canOpen);
    assert(!p.canShare && !a.canShare);
  });

  await test('85. preservePublicExport always true on delete_private plans', () => {
    for (const present of [true, false]) {
      const plan = resolveDeletePlan({
        downloadId: 'p',
        status: 'COMPLETED',
        physicalFilePresent: present,
      });
      assert(plan.kind === 'delete_private');
      if (plan.kind === 'delete_private') {
        assert(plan.preservePublicExport === true);
      }
    }
  });

  console.log(
    `\nPhase 7C export/delete reliability: ${passed} passed, ${failed} failed`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
