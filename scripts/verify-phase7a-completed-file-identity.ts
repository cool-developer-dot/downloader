/**
 * Phase 7A — Completed file identity verifier.
 * Usage: npm run verify:phase7a-completed-file-identity
 *
 * Exercises exported identity functions directly (not string-grep only).
 * No Python, Maestro, Appium, emulator loops, or APK builds.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sanitizeCompletedFileName,
  resolveCompletedExtension,
  resolveCompletedMimeType,
  resolveCompletedContainer,
  resolveCompletedFileName,
  resolveCompletedDescriptor,
  resolveLegacyCompletedDescriptor,
  classifyLibraryDownloadState,
  resolveCompletedActions,
  isNonFinalMediaExtension,
  formatContainerLabel,
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

function assertNoSubstring(haystack: string, needle: string, label: string): void {
  assert(!haystack.includes(needle), `${label} must not contain ${needle}`);
}

async function main(): Promise<void> {
  // ——— FILENAME ———
  await test('1. trusted title → useful sanitized filename', () => {
    const name = resolveCompletedFileName({
      downloadId: 'a1b2c3d4',
      displayTitle: 'Big Buck Bunny',
      evidence: { signatureKind: 'mp4' },
      preserveExistingBaseName: false,
      now: new Date('2026-09-08T12:00:00Z'),
    });
    assert(name === 'Big_Buck_Bunny.mp4' || name.toLowerCase().startsWith('big_buck_bunny'), `got ${name}`);
    assert(name.endsWith('.mp4'), name);
  });

  await test('2. social identity fallback', () => {
    const name = resolveCompletedFileName({
      downloadId: 'abc123',
      displayTitle: '',
      platform: 'INSTAGRAM',
      evidence: { signatureKind: 'mp4' },
      preserveExistingBaseName: false,
      completedAt: '2026-09-08T12:00:00.000Z',
    });
    assert(name.startsWith('instagram_reel_2026-09-08'), `got ${name}`);
    assert(name.endsWith('.mp4'), name);
  });

  await test('3. general website fallback', () => {
    const name = resolveCompletedFileName({
      downloadId: 'abc123',
      displayTitle: null,
      platform: 'WEB',
      sourceHost: 'example.com',
      qualityLabel: '720p',
      evidence: { signatureKind: 'mp4' },
      preserveExistingBaseName: false,
    });
    assert(name.includes('example_com'), `got ${name}`);
    assert(name.includes('720p'), `got ${name}`);
    assert(name.endsWith('.mp4'), name);
  });

  await test('4. empty title fallback', () => {
    const name = resolveCompletedFileName({
      downloadId: 'a1b2c3d4-eeee',
      displayTitle: '',
      evidence: { signatureKind: 'mp4' },
      preserveExistingBaseName: false,
      completedAt: '2026-09-08T00:00:00.000Z',
    });
    assert(name.includes('video_2026-09-08'), `got ${name}`);
    assert(name.includes('a1b2c3'), `got ${name}`);
  });

  await test('5. whitespace-only title fallback', () => {
    const name = resolveCompletedFileName({
      downloadId: 'zzzzzz',
      displayTitle: '   \t  ',
      evidence: { signatureKind: 'mp4' },
      preserveExistingBaseName: false,
      completedAt: '2026-09-08T00:00:00.000Z',
    });
    assert(!name.includes('   '), name);
    assert(name.endsWith('.mp4'), name);
  });

  await test('6. slash removed', () => {
    assert(!sanitizeCompletedFileName('a/b/c').includes('/'), 'slash');
  });

  await test('7. backslash removed', () => {
    assert(!sanitizeCompletedFileName('a\\b').includes('\\'), 'backslash');
  });

  await test('8. colon removed', () => {
    assert(!sanitizeCompletedFileName('a:b').includes(':'), 'colon');
  });

  await test('9. wildcard removed', () => {
    const s = sanitizeCompletedFileName('a*b?c');
    assert(!s.includes('*') && !s.includes('?'), s);
  });

  await test('10. quote removed', () => {
    assert(!sanitizeCompletedFileName('a"b').includes('"'), 'quote');
  });

  await test('11. angle brackets removed', () => {
    const s = sanitizeCompletedFileName('a<b>c');
    assert(!s.includes('<') && !s.includes('>'), s);
  });

  await test('12. pipe removed', () => {
    assert(!sanitizeCompletedFileName('a|b').includes('|'), 'pipe');
  });

  await test('13. control characters removed', () => {
    const s = sanitizeCompletedFileName('a\u0000b\u0001c');
    assert(!/[\u0000-\u001f]/.test(s), s);
  });

  await test('14. newline removed', () => {
    const s = sanitizeCompletedFileName('a\nb\rc');
    assert(!s.includes('\n') && !s.includes('\r'), s);
  });

  await test('15. traversal ../../ cannot escape', () => {
    const s = sanitizeCompletedFileName('../../evil.mp4');
    assert(!s.includes('..'), s);
    assert(!s.startsWith('/'), s);
  });

  await test('16. leading path separator removed', () => {
    const s = sanitizeCompletedFileName('/foo/bar.mp4');
    assert(!s.startsWith('/'), s);
  });

  await test('17. extreme name length bounded', () => {
    const s = sanitizeCompletedFileName(`${'x'.repeat(500)}.mp4`);
    assert(s.length <= 120, `length ${s.length}`);
  });

  await test('18. repeated whitespace normalized', () => {
    const s = sanitizeCompletedFileName('Big   Buck    Bunny');
    assert(!/\s{2,}/.test(s), s);
  });

  await test('19. signed query never appears in filename', () => {
    const name = resolveCompletedFileName({
      downloadId: 'abc123',
      displayTitle: null,
      sourceUrl: 'https://cdn.example/video.mp4?token=SECRET&expires=999',
      evidence: { signatureKind: 'mp4', urlExtension: 'mp4' },
      preserveExistingBaseName: false,
      completedAt: '2026-09-08T00:00:00.000Z',
    });
    assert(!name.toLowerCase().includes('token'), name);
    assert(!name.includes('SECRET'), name);
    assert(!name.includes('expires'), name);
    assert(!name.includes('?'), name);
  });

  await test('20. auth/request data cannot become filename', () => {
    const name = resolveCompletedFileName({
      downloadId: 'abc123',
      displayTitle: 'Cookie: session=abc Authorization: Bearer xyz',
      evidence: { signatureKind: 'mp4' },
      preserveExistingBaseName: false,
    });
    // Sanitized — may keep words but not path/query secrets from URL.
    assert(!name.includes('Bearer'), name);
    assert(!name.includes(':'), name);
  });

  // ——— EXTENSION / MIME ———
  await test('21. verified MP4 → .mp4 + video/mp4', () => {
    const evidence = { signatureKind: 'mp4' };
    assert(resolveCompletedExtension(evidence) === 'mp4', 'ext');
    assert(resolveCompletedMimeType(evidence) === 'video/mp4', 'mime');
    assert(resolveCompletedContainer(evidence) === 'mp4', 'container');
  });

  await test('22. verified WebM → .webm + video/webm', () => {
    const evidence = { signatureKind: 'webm' };
    assert(resolveCompletedExtension(evidence) === 'webm', 'ext');
    assert(resolveCompletedMimeType(evidence) === 'video/webm', 'mime');
  });

  await test('23. URL with no extension + MP4 evidence → .mp4', () => {
    assert(
      resolveCompletedExtension({
        signatureKind: 'mp4',
        urlExtension: '',
      }) === 'mp4',
      'ext',
    );
  });

  await test('24. URL .mp4 cannot override WebM evidence', () => {
    assert(
      resolveCompletedExtension({
        signatureKind: 'webm',
        urlExtension: 'mp4',
      }) === 'webm',
      'ext',
    );
  });

  await test('25. Content-Disposition bad extension corrected by container', () => {
    const name = resolveCompletedFileName({
      downloadId: 'abc123',
      displayTitle: null,
      evidence: {
        signatureKind: 'mp4',
        contentDispositionFileName: '../../evil.exe',
      },
      preserveExistingBaseName: false,
    });
    assert(name.endsWith('.mp4'), name);
    assert(!name.includes('..'), name);
    assert(!name.endsWith('.exe'), name);
  });

  await test('26. application/octet-stream does not override known MP4', () => {
    assert(
      resolveCompletedMimeType({
        signatureKind: 'mp4',
        responseMimeType: 'application/octet-stream',
      }) === 'video/mp4',
      'mime',
    );
  });

  await test('27. unknown container handled without fabricated MIME', () => {
    assert(
      resolveCompletedMimeType({
        signatureKind: 'unknown',
      }) === null,
      'mime',
    );
    assert(resolveCompletedContainer({ signatureKind: 'unknown' }) === 'unknown', 'c');
  });

  await test('28. supported HLS final artifact uses actual output evidence', () => {
    assert(resolveCompletedExtension({ signatureKind: 'ts' }) === 'ts', 'ts');
    assert(resolveCompletedMimeType({ signatureKind: 'ts' }) === 'video/mp2t', 'mime');
    assert(
      resolveCompletedExtension({ signatureKind: 'mp4', containerHint: 'fmp4' }) ===
        'mp4',
      'fmp4',
    );
  });

  await test('29. .m3u8 is not blindly used as completed artifact extension', () => {
    assert(isNonFinalMediaExtension('m3u8'), 'nonfinal');
    assert(
      resolveCompletedExtension({
        urlExtension: 'm3u8',
        containerHint: 'hls',
      }) !== 'm3u8',
      'ext',
    );
  });

  await test('30. transport segment extension is not treated as final without evidence', () => {
    // Bare URL .ts without signature still may map via URL — with signatureKind absent
    // and only playlist hint, must not invent mp4.
    assert(
      resolveCompletedContainer({
        containerHint: 'hls',
        urlExtension: 'm3u8',
      }) === 'unknown',
      'container',
    );
  });

  // ——— DESCRIPTOR ———
  await test('31. COMPLETED descriptor has downloadId', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      validationSucceeded: true,
      physicalFilePresent: true,
      fileSizeBytes: 1024,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.downloadId === 'dl-1', 'id');
  });

  await test('32. canonical path is stable', () => {
    const path = 'file:///data/VidoraXDownloads/dl-1/clip.mp4';
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      canonicalPath: path,
      validationSucceeded: true,
      physicalFilePresent: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.canonicalPath === path, 'path');
  });

  await test('33. final file size uses actual stat', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      validationSucceeded: true,
      physicalFilePresent: true,
      fileSizeBytes: 24600000,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.fileSize === '24600000', d?.fileSize);
  });

  await test('34. completedAt stable', () => {
    const at = '2026-09-08T12:00:00.000Z';
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      completedAt: at,
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.completedAt === at, d?.completedAt);
  });

  await test('35. displayTitle separate from physical filename', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      displayTitle: 'Big Buck Bunny',
      fileName: 'download.bin',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
      preserveExistingBaseName: false,
    });
    assert(d?.displayTitle === 'Big Buck Bunny', d?.displayTitle);
    assert(d?.fileName.endsWith('.mp4'), d?.fileName);
    assert(d?.fileName !== d?.displayTitle, 'distinct');
  });

  await test('36. optional thumbnail remains optional', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.thumbnailUri === null, 'thumb');
  });

  await test('37. mediaIdentity preserved when safe', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      mediaIdentity: 'ig:media:123',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.mediaIdentity === 'ig:media:123', d?.mediaIdentity);
  });

  await test('38. secret requestContext absent', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      mediaIdentity: 'Cookie: abc',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.mediaIdentity === null, 'secret identity dropped');
    assert(!('requestContext' in (d ?? {})), 'no requestContext field');
  });

  await test('39. Cookie absent', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      thumbnailUri: 'https://cdn.example/thumb.jpg?Cookie=1',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    // Thumbnail URL with Cookie query word is still http — looksSecret checks value.
    // Force identity-like secret:
    const d2 = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      mediaIdentity: 'Cookie=abc',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d2?.mediaIdentity === null, 'cookie identity');
    void d;
  });

  await test('40. Authorization absent', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      mediaIdentity: 'Authorization: Bearer tok',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.mediaIdentity === null, 'auth');
  });

  // ——— LIFECYCLE ———
  await test('41. descriptor not finalized before Phase 1 validation', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      validationSucceeded: false,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d === null, 'null');
  });

  await test('42. failed validation never produces completed descriptor', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'DOWNLOADING',
      fileName: 'clip.mp4',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d === null, 'null');
  });

  await test('43. COMPLETED maps to completed UI group', () => {
    assert(classifyLibraryDownloadState('COMPLETED') === 'completed', 'group');
  });

  await test('44. FAILED does not map to completed', () => {
    assert(classifyLibraryDownloadState('FAILED') === 'failed', 'group');
  });

  await test('45. CANCELLED does not map to completed', () => {
    assert(classifyLibraryDownloadState('CANCELLED') === 'cancelled', 'group');
  });

  await test('46. FINALIZING remains active/transitional', () => {
    assert(
      classifyLibraryDownloadState('DOWNLOADING', 'VERIFYING') ===
        'active_transitional',
      'group',
    );
  });

  await test('47. PAUSED remains non-completed', () => {
    assert(classifyLibraryDownloadState('PAUSED') === 'active_transitional', 'group');
  });

  // ——— LEGACY ———
  await test('48. legacy record missing MIME does not crash', () => {
    const d = resolveLegacyCompletedDescriptor({
      downloadId: 'legacy-1',
      status: 'COMPLETED',
      fileName: 'download_173923983.bin',
      physicalFilePresent: true,
    });
    assert(d != null, 'descriptor');
    assert(d?.mimeType === null || typeof d?.mimeType === 'string', 'mime');
  });

  await test('49. legacy record missing container does not crash', () => {
    const d = resolveLegacyCompletedDescriptor({
      downloadId: 'legacy-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
    });
    assert(d?.container === 'mp4' || d?.container === 'unknown', d?.container);
  });

  await test('50. legacy record missing displayTitle gets safe fallback', () => {
    const d = resolveLegacyCompletedDescriptor({
      downloadId: 'legacy-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      displayTitle: null,
    });
    assert(typeof d?.displayTitle === 'string' && d.displayTitle.length > 0, 'title');
  });

  await test('51. legacy record missing thumbnail works', () => {
    const d = resolveLegacyCompletedDescriptor({
      downloadId: 'legacy-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
    });
    assert(d?.thumbnailUri === null, 'thumb');
  });

  await test('52. legacy missing physical file cannot claim Play capability', () => {
    const actions = resolveCompletedActions({
      status: 'COMPLETED',
      physicalFilePresent: false,
      allowExternalHandoff: false,
      allowDelete: true,
    });
    assert(actions.canPlay === false, 'play');
    assert(actions.canOpen === false, 'open');
    assert(actions.canShare === false, 'share');
  });

  // ——— LIBRARY ———
  await test('53. completed card uses normalized title', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      displayTitle: '  Big Buck Bunny  ',
      fileName: 'clip.mp4',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.displayTitle === 'Big Buck Bunny', d?.displayTitle);
  });

  await test('54. known size formats correctly (descriptor retains bytes)', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      fileSizeBytes: 12_800_000,
      physicalFilePresent: true,
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.fileSize === '12800000', d?.fileSize);
  });

  await test('55. unknown size does not fabricate value', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      fileSizeBytes: null,
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.fileSize === null, 'size');
  });

  await test('56. known quality displayed when provided', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      qualityLabel: '720p',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.qualityLabel === '720p', d?.qualityLabel);
  });

  await test('57. unknown quality not fabricated', () => {
    const d = resolveCompletedDescriptor({
      downloadId: 'dl-1',
      status: 'COMPLETED',
      fileName: 'clip.mp4',
      validationSucceeded: true,
      evidence: { signatureKind: 'mp4' },
    });
    assert(d?.qualityLabel === null, 'quality');
  });

  await test('58. completed card does not show active progress semantics', () => {
    const card = readSrc('src/screens/downloads/components/DownloadCard.tsx');
    assert(
      card.includes("item.status === 'QUEUED' && progressValue > 0)") ||
        card.includes('showCompletedBadge'),
      'completed progress gated',
    );
    assert(
      !card.includes(
        "(item.status === 'QUEUED' && progressValue > 0) ||\n    item.status === 'COMPLETED'",
      ),
      'completed no longer forces progress bar',
    );
  });

  await test('59. long title safely truncates/ellipsizes (UI numberOfLines)', () => {
    const card = readSrc('src/screens/library/components/LibraryCard.tsx');
    assert(card.includes('numberOfLines={2}'), 'title ellipsis');
    assert(card.includes('numberOfLines={1}'), 'filename ellipsis');
  });

  await test('60. action capability derived from completed + physical file state', () => {
    const ok = resolveCompletedActions({
      status: 'COMPLETED',
      physicalFilePresent: true,
      allowExternalHandoff: false,
      allowDelete: true,
    });
    assert(ok.canPlay === true, 'play');
    assert(ok.canOpen === false, 'open gated for library');
    assert(ok.canShare === false, 'share gated');
    assert(ok.canExport === false, 'export gated');
    assert(ok.canDelete === true, 'delete');
  });

  // ——— BOUNDARIES ———
  await test('61-73. phase boundaries and non-goals', () => {
    const apply = readSrc('src/downloads/completed-file/apply-identity.ts');
    const identityIndex = readSrc('src/downloads/completed-file/index.ts');
    const docs = existsSync(join(ROOT, 'docs/library/PHASE-7A-COMPLETED-FILE-IDENTITY.md'))
      ? readSrc('docs/library/PHASE-7A-COMPLETED-FILE-IDENTITY.md')
      : '';

    assertNoSubstring(apply, 'MediaStore', 'apply-identity');
    assertNoSubstring(apply, 'FileProvider', 'apply-identity');
    assertNoSubstring(identityIndex, 'content://', 'index');
    assertNoSubstring(apply, 'ffmpeg', 'apply-identity');
    assertNoSubstring(apply, 'setInterval', 'apply-identity');
    assert(formatContainerLabel('mp4') === 'MP4', 'label');

    // Pre-existing Downloads open/share may use contentUri — 7A must not add new
    // MediaStore/public Downloads destination logic in completed-file module.
    assertNoSubstring(apply, 'DOWNLOADS', 'apply-identity');
    assertNoSubstring(docs, 'PHASE_7A_IMPLEMENTS_SHARE', 'docs');

    const worker = readSrc('src/downloads/engine/worker.ts');
    assert(worker.includes('applyCompletedFileIdentity'), 'wired progressive');
    const hls = readSrc('src/downloads/engine/hls/worker.ts');
    assert(hls.includes('applyCompletedFileIdentity'), 'wired hls');

    // Phase 1 validation still required before identity.
    const finalize = readSrc('src/downloads/engine/finalize-download.ts');
    assert(finalize.includes('verifyDownloadedMediaContent'), 'validation intact');
    assert(finalize.includes('signatureKind'), 'signature exported');
  });

  console.log(`\nPhase 7A completed-file identity: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
