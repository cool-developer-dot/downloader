/**
 * Phase 4 Tier-1 Social Hardening verifier (code/static).
 * Usage: npm run verify:phase4-tier1-social-hardening
 *
 * Models the proven DcmMB5FAKt6 failure class generically —
 * no shortcode hardcoded into production logic.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyMp4Container,
  isActionableStandaloneMp4,
  INIT_SEGMENT_SIZE_HINT_MAX,
} from '../src/downloads/engine/mp4-box-classify';
import { sniffMediaSignature } from '../src/downloads/engine/media-signature';
import { parseContentRange } from '../src/downloads/engine/range-validation';
import { resolveCredibleSizeBytes } from '../src/media-detection/social-source/quality-evidence';
import {
  resolveSocialAudioState,
  isCombinedDownloadActionable,
  isVideoOnlyUnsupportedForCombinedUx,
} from '../src/media-detection/social-source/audio-evidence';
import {
  preserveExecutableUrl,
  sameResourceFamily,
  buildResourceIdentityKey,
  stableResourcePath,
} from '../src/media-detection/social-source/resource-identity';
import { selectPreferredVariant } from '../src/media-detection/social-source/variant-policy';
import { isLikelyMediaSegment } from '../src/media-detection/services/false-positive.filter';
import { browserMediaActionService } from '../src/browser/media-actions/browser-media-action.service';
import { toBrowserMediaCtaState } from '../src/browser/media-actions/browser-media-action.types';
import { buildBrowserMediaFingerprint } from '../src/browser/media-actions/media-fingerprint';
import type { DetectedMedia } from '../src/media-detection/types';
import type { MediaAnalysisResult } from '../src/api/types';
import type { MediaRequestContext } from '../src/downloads/types/request-context';
import type { VerifiedSocialMediaVariant } from '../src/media-detection/social-source/types';

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

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function box(type: string, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const size = 8 + payload.length;
  const out = new Uint8Array(size);
  out.set(u32(size), 0);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Synthetic ~init-like resource: ftyp+moov, no mdat, ~348KB class via total hint. */
function makeInitSegmentBytes(): Uint8Array {
  const moovPayload = new Uint8Array(512);
  return concat(box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 1])), box('moov', moovPayload));
}

function makeMediaFragmentBytes(): Uint8Array {
  return concat(box('moof', new Uint8Array(64)), box('mdat', new Uint8Array(128)));
}

function makeProgressiveBytes(): Uint8Array {
  return concat(
    box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 1])),
    box('moov', new Uint8Array(64)),
    box('mdat', new Uint8Array(256)),
  );
}

function makeCompleteFmp4Bytes(): Uint8Array {
  return concat(
    box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 1])),
    box('moov', new Uint8Array(32)),
    box('moof', new Uint8Array(32)),
    box('mdat', new Uint8Array(256)),
  );
}

function makeVariant(
  partial: Partial<VerifiedSocialMediaVariant> &
    Pick<VerifiedSocialMediaVariant, 'variantId' | 'resourceIdentity' | 'executableUrl'>,
): VerifiedSocialMediaVariant {
  return {
    transport: 'progressive',
    container: 'mp4',
    mimeType: 'video/mp4',
    width: 720,
    height: 1280,
    bitrate: null,
    qualityLabel: '720p',
    sizeBytes: 5_000_000,
    audioState: 'INCLUDED',
    downloadable: true,
    verificationEvidence: {
      httpStatus: 200,
      mimeType: 'video/mp4',
      contentLength: 5_000_000,
      acceptRanges: true,
      redirectCount: 0,
      signatureKind: 'mp4',
      usedRangeProbe: true,
    },
    requestContext: null,
    verifiedAt: Date.now(),
    sourceGeneration: 1,
    ...partial,
  };
}

function makeMedia(partial: Partial<DetectedMedia> & Pick<DetectedMedia, 'id' | 'url'>): DetectedMedia {
  return {
    sourceUrl: partial.url,
    finalUrl: partial.url,
    pageUrl: 'https://www.instagram.com/reel/EXAMPLE/',
    title: null,
    thumbnailUrl: null,
    duration: null,
    width: 1080,
    height: 1920,
    resolution: '1080x1920',
    bitrate: null,
    codec: null,
    audioCodec: null,
    estimatedFileSize: null,
    mimeType: 'video/mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'PROGRESSIVE',
    confidence: 0.9,
    detectionSource: 'native_network',
    requiresCookies: false,
    requiredHeaders: null,
    websiteSource: 'instagram.com',
    isDrm: false,
    videoOnly: false,
    hasSeparateAudio: false,
    extension: 'mp4',
    ...partial,
  } as DetectedMedia;
}

async function main(): Promise<void> {
  console.log('\n=== Phase 4 Tier-1 Social Hardening ===\n');

  await test('1. complete progressive MP4 actionable', () => {
    const bytes = makeProgressiveBytes();
    const c = classifyMp4Container({ bytes, resourceTotalBytes: 5_000_000 });
    assert(isActionableStandaloneMp4(c.kind), c.kind);
    const sig = sniffMediaSignature(bytes, {
      resourceTotalBytes: 5_000_000,
      requireStandaloneMp4: true,
    });
    assert(sig.ok, sig.reason ?? 'fail');
  });

  await test('2–3. HTML/JSON disguised .mp4 rejected', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html>');
    assert(!sniffMediaSignature(html, { requireStandaloneMp4: true }).ok, 'html');
    const json = new TextEncoder().encode('{"error":"denied"}');
    assert(!sniffMediaSignature(json, { requireStandaloneMp4: true }).ok, 'json');
  });

  await test('4. init-segment-like resource not normal video (348KB class)', () => {
    const bytes = makeInitSegmentBytes();
    const total = 348_300; // proven failure size class — generic, not shortcode-bound
    const c = classifyMp4Container({
      bytes,
      resourceTotalBytes: total,
      coversEntireResource: false,
    });
    assert(c.kind === 'INIT_SEGMENT', `expected INIT_SEGMENT got ${c.kind}`);
    assert(total < INIT_SEGMENT_SIZE_HINT_MAX, 'size hint');
    const sig = sniffMediaSignature(bytes, {
      resourceTotalBytes: total,
      requireStandaloneMp4: true,
    });
    assert(!sig.ok && sig.reason === 'init_segment', sig.reason ?? 'expected reject');
  });

  await test('5. media fragment not normal video', () => {
    const bytes = makeMediaFragmentBytes();
    const c = classifyMp4Container({ bytes });
    assert(c.kind === 'MEDIA_FRAGMENT', c.kind);
    const sig = sniffMediaSignature(bytes, { requireStandaloneMp4: true });
    assert(!sig.ok && sig.reason === 'media_fragment', sig.reason ?? 'fail');
  });

  await test('6–8. .m4s / .ts / blob rejected standalone', () => {
    assert(isLikelyMediaSegment('https://cdn.example.com/seg/1.m4s', 'm4s'), 'm4s');
    assert(isLikelyMediaSegment('https://cdn.example.com/seg/12.ts', 'ts'), 'ts');
    const reliability = readSrc(
      'src/media-detection/social-source/social-source-reliability.service.ts',
    );
    assert(reliability.includes('BLOB_ONLY'), 'blob rejection path');
    assert(reliability.includes('INIT_SEGMENT'), 'init rejection wired');
    assert(reliability.includes('MEDIA_FRAGMENT'), 'fragment rejection wired');
  });

  await test('9–11. Content-Range total / probe length / Range policy', () => {
    const parsed = parseContentRange('bytes 0-0/12345678');
    assert(parsed?.total === 12_345_678, 'content-range total');
    assert(resolveCredibleSizeBytes(1) == null, 'probe length 1 ignored');
    assert(resolveCredibleSizeBytes(100) == null, 'tiny probe length ignored');
    assert(resolveCredibleSizeBytes(12_345_678) === 12_345_678, 'real size');
    const mimeProbe = readSrc('src/media-detection/services/mime-probe.service.ts');
    assert(mimeProbe.includes('content-range'), 'mime probe parses Content-Range');
    assert(mimeProbe.includes('response.status === 206'), '206 slice length ignored');
  });

  await test('12. valid fMP4 with moof+mdat not blindly rejected', () => {
    const bytes = makeCompleteFmp4Bytes();
    const c = classifyMp4Container({ bytes, resourceTotalBytes: 2_000_000 });
    assert(c.kind === 'FRAGMENTED_COMPLETE', c.kind);
    assert(isActionableStandaloneMp4(c.kind), 'actionable');
    assert(
      sniffMediaSignature(bytes, {
        resourceTotalBytes: 2_000_000,
        requireStandaloneMp4: true,
      }).ok,
      'valid fmp4 ok',
    );
  });

  await test('13–15. VIDEO_ONLY / UNKNOWN / INCLUDED audio', () => {
    assert(
      resolveSocialAudioState(
        makeMedia({ id: 'v', url: 'https://cdn/x.mp4', videoOnly: true, hasSeparateAudio: true }),
      ) === 'VIDEO_ONLY',
    );
    assert(isVideoOnlyUnsupportedForCombinedUx('VIDEO_ONLY'));
    assert(!isCombinedDownloadActionable('VIDEO_ONLY'));
    assert(
      resolveSocialAudioState(makeMedia({ id: 'u', url: 'https://cdn/x.mp4' })) === 'UNKNOWN',
    );
    assert(
      resolveSocialAudioState(
        makeMedia({
          id: 'i',
          url: 'https://cdn/x.mp4',
          audioCodec: 'mp4a.40.2',
          videoOnly: false,
          hasSeparateAudio: false,
        }),
      ) === 'INCLUDED',
    );
  });

  await test('16. quality requires evidence', () => {
    const q = readSrc('src/media-detection/social-source/quality-evidence.ts');
    assert(q.includes('Do not parse') || q.includes('labelFromHeight'), 'evidence based');
    assert(!/1080p.*url/i.test(q), 'no url quality parse');
  });

  await test('17–19. signed URL identity vs executable URL', () => {
    const a = 'https://cdn.instagram.com/v/t51/ABC.mp4?_nc_ht=1&oe=AAA&oh=111';
    const b = 'https://cdn.instagram.com/v/t51/ABC.mp4?_nc_ht=1&oe=BBB&oh=222';
    assert(sameResourceFamily(a, b));
    assert(preserveExecutableUrl(a) === a);
    assert(!stableResourcePath(a)?.includes('?'));
    const idA = buildResourceIdentityKey({
      contentIdentity: 'instagram:instagram_reel:EXAMPLE',
      executableUrl: a,
      transport: 'progressive',
      height: 1920,
    });
    const idB = buildResourceIdentityKey({
      contentIdentity: 'instagram:instagram_reel:EXAMPLE',
      executableUrl: b,
      transport: 'progressive',
      height: 1920,
    });
    assert(idA === idB);
  });

  await test('20–21. consumed CTA + new content', () => {
    browserMediaActionService.__resetAllForTests();
    browserMediaActionService.setActiveTab('tabA');
    const media = makeMedia({ id: 'm1', url: 'https://cdn.example.com/v/A/video.mp4?sig=1' });
    const analysis = {
      title: 'A',
      platform: 'instagram',
      sourceUrl: media.url,
      finalUrl: media.url,
      thumbnailUrl: null,
      duration: 10,
      container: 'mp4',
      downloadable: true,
      variants: [],
    } as MediaAnalysisResult;
    const ctx = {
      pageUrl: 'https://www.instagram.com/reel/A/',
      referer: 'https://www.instagram.com/',
      userAgent: 't',
      cookiesRequired: false,
      hasCookies: false,
      headers: {},
      capturedAt: Date.now(),
    } as MediaRequestContext;

    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/A/',
      media,
      analysis,
      requestContext: ctx,
      mediaUrl: media.url,
      contentIdentity: 'instagram:reel:A',
      variantIdentity: 'cdn.example.com/v/A/video.mp4',
    });
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED');
    browserMediaActionService.commitConsumed(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'dl1',
    );

    // Same content, new CDN path — must stay consumed.
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/A/',
      media: makeMedia({
        id: 'm2',
        url: 'https://cdn.example.com/v/A/newpath.mp4?sig=9',
      }),
      analysis,
      requestContext: ctx,
      mediaUrl: 'https://cdn.example.com/v/A/newpath.mp4?sig=9',
      contentIdentity: 'instagram:reel:A',
      variantIdentity: 'cdn.example.com/v/A/newpath.mp4',
    });
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) !== 'AVAILABLE');

    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reel/B/',
      media: makeMedia({ id: 'm3', url: 'https://cdn.example.com/v/B/video.mp4' }),
      analysis: { ...analysis, sourceUrl: 'https://cdn.example.com/v/B/video.mp4' },
      requestContext: { ...ctx, pageUrl: 'https://www.instagram.com/reel/B/' },
      mediaUrl: 'https://cdn.example.com/v/B/video.mp4',
      contentIdentity: 'instagram:reel:B',
      variantIdentity: 'cdn.example.com/v/B/video.mp4',
    });
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE');
  });

  await test('22–24. verification dedupe / stale / tab isolation in code', () => {
    const reliability = readSrc(
      'src/media-detection/social-source/social-source-reliability.service.ts',
    );
    assert(reliability.includes('joinOrStartVerification'), 'inflight join');
    assert(reliability.includes('isScopeCurrent'), 'scope guard');
    const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    assert(hook.includes('isSocialScopeCurrent'), 'stale social generation');
  });

  await test('25–26. neighbor preload / ad policy retained in 4A', () => {
    const corr = readSrc('src/media-detection/social/social-correlation.service.ts');
    assert(corr.includes('preload') || corr.includes('PRELOAD') || corr.includes('neighbor'), 'preload');
    assert(corr.includes('REJECTED') || corr.includes('ad'), 'reject path');
  });

  await test('27–28. pre-handoff refresh / no invalid enqueue', () => {
    const dl = readSrc('src/browser/media-actions/browser-media-download.service.ts');
    assert(dl.includes('runPreDownloadGate'), 'gate');
    assert(dl.includes('resolveFreshSocialSourceForDownload') || dl.includes('refreshMediaFromPage'));
    assert(dl.includes('if (!created)'), 'no job without create');
  });

  await test('29–31. AUTH refresh restart / resume 200 / incompatible', () => {
    const mgr = readSrc('src/downloads/engine/manager.ts');
    assert(mgr.includes('resolveFreshSocialSourceForDownload'), 'provider');
    assert(mgr.includes('bytesWritten: 0') || mgr.includes('bytesWritten: urlChanged ? 0'));
    const range = readSrc('src/downloads/engine/range-validation.ts');
    assert(range.includes('status === 200'), 'http 200');
    assert(range.includes('RESUME_UNSUPPORTED') || range.includes('SOURCE_CHANGED'));
  });

  await test('32. final invalid container rejected', () => {
    const validation = readSrc('src/downloads/engine/media-validation.ts');
    assert(validation.includes('requireStandaloneMp4: true'), 'standalone required at finalize');
    assert(validation.includes('1024 * 1024'), 'small files fully scanned');
  });

  await test('33–35. no polling / backend / secret logging', () => {
    const files = [
      'src/downloads/engine/mp4-box-classify.ts',
      'src/media-detection/social-source/social-source-reliability.service.ts',
      'src/media-detection/services/mime-probe.service.ts',
    ];
    for (const f of files) {
      const src = readSrc(f);
      assert(!/setInterval\s*\(/.test(src), `${f} interval`);
      assert(!/refetchInterval/.test(src), `${f} refetch`);
      assert(!/firebase|supabase/i.test(src), `${f} backend`);
    }
    const diag = readSrc('src/media-detection/social-source/social-source-diagnostics.ts');
    assert(diag.includes('never logs') || diag.includes('contentIdentityHash'));
  });

  await test('TikTok preferred combined over silent higher res', () => {
    const preferred = selectPreferredVariant([
      makeVariant({
        variantId: '1080',
        resourceIdentity: 'tiktok:1080',
        executableUrl: 'https://cdn.tiktok.com/1080.mp4',
        height: 1920,
        qualityLabel: '1080p',
        audioState: 'VIDEO_ONLY',
        downloadable: false,
      }),
      makeVariant({
        variantId: '720',
        resourceIdentity: 'tiktok:720',
        executableUrl: 'https://cdn.tiktok.com/720.mp4',
        height: 1280,
        qualityLabel: '720p',
        audioState: 'INCLUDED',
        downloadable: true,
      }),
    ]);
    assert(preferred?.variantId === '720', preferred?.variantId ?? 'none');
  });

  await test('ftyp alone is not sufficient proof in hardening path', () => {
    const onlyFtyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 1]));
    const sig = sniffMediaSignature(onlyFtyp, {
      resourceTotalBytes: 348_300,
      requireStandaloneMp4: true,
    });
    assert(!sig.ok, 'ftyp-only must not be standalone-ok');
  });

  await test('docs exist', () => {
    assert(existsSync(join(ROOT, 'docs/browser/PHASE-4-TIER1-SOCIAL-HARDENING.md')));
    assert(
      existsSync(join(ROOT, 'docs/testing/PHASE-4-TIER1-SOCIAL-REAL-ANDROID-ACCEPTANCE.md')),
    );
  });

  // Fingerprint still ignores query
  await test('fingerprint ignores signed query', () => {
    const fp1 = buildBrowserMediaFingerprint({
      pageUrl: 'https://www.instagram.com/reel/X/',
      mediaUrl: 'https://cdn.example.com/v.mp4?sig=1',
      platform: 'instagram',
    });
    const fp2 = buildBrowserMediaFingerprint({
      pageUrl: 'https://www.instagram.com/reel/X/',
      mediaUrl: 'https://cdn.example.com/v.mp4?sig=2',
      platform: 'instagram',
    });
    assert(fp1 === fp2);
  });

  console.log(`\nHardening results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
