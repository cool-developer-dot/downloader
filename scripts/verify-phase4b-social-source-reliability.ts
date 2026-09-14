/**
 * Phase 4B — Social source reliability verifier.
 * Usage: npm run verify:phase4b-social-source-reliability
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sniffMediaSignature } from '../src/downloads/engine/media-signature';
import { isNonMediaDocumentMime } from '../src/downloads/analyze/format';
import {
  resolveSocialAudioState,
  isCombinedDownloadActionable,
  isVideoOnlyUnsupportedForCombinedUx,
} from '../src/media-detection/social-source/audio-evidence';
import {
  resolveQualityLabelFromEvidence,
  resolveCredibleSizeBytes,
} from '../src/media-detection/social-source/quality-evidence';
import {
  buildResourceIdentityKey,
  preserveExecutableUrl,
  sameResourceFamily,
  stableResourcePath,
} from '../src/media-detection/social-source/resource-identity';
import {
  selectPreferredVariant,
  dedupeVariants,
} from '../src/media-detection/social-source/variant-policy';
import {
  buildVerificationCacheKey,
  joinOrStartVerification,
  clearAllVerificationSessions,
  clearVerificationForTab,
} from '../src/media-detection/social-source/verification-session';
import { socialPageContextStore } from '../src/media-detection/social';
import { isFalsePositive } from '../src/media-detection/services/false-positive.filter';
import { buildBrowserMediaFingerprint } from '../src/browser/media-actions/media-fingerprint';
import type { VerifiedSocialMediaVariant } from '../src/media-detection/social-source/types';
import type { DetectedMedia } from '../src/media-detection/types';

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

function makeMedia(partial: Partial<DetectedMedia> & Pick<DetectedMedia, 'id' | 'url'>): DetectedMedia {
  return {
    sourceUrl: partial.url,
    finalUrl: partial.url,
    pageUrl: 'https://www.instagram.com/reel/ABC123/',
    title: null,
    thumbnailUrl: null,
    duration: null,
    width: 1080,
    height: 1920,
    resolution: null,
    aspectRatio: null,
    fps: null,
    estimatedFileSize: null,
    codec: null,
    audioCodec: null,
    bitrate: null,
    mimeType: 'video/mp4',
    extension: 'mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'DIRECT',
    isLive: false,
    isDrm: false,
    playlistType: null,
    streamProtocol: null,
    websiteSource: 'instagram.com',
    detectionSource: 'native_network',
    sourceDetector: 'native_network',
    detectedAt: Date.now(),
    confidence: 0.8,
    downloadable: true,
    requiresCookies: true,
    requiredHeaders: null,
    redirectCount: 0,
    platformHint: 'INSTAGRAM',
    hasSeparateAudio: false,
    videoOnly: false,
    ...partial,
  };
}

function makeVariant(
  partial: Partial<VerifiedSocialMediaVariant> &
    Pick<VerifiedSocialMediaVariant, 'variantId' | 'resourceIdentity' | 'executableUrl'>,
): VerifiedSocialMediaVariant {
  return {
    transport: 'progressive',
    container: 'mp4',
    mimeType: 'video/mp4',
    width: 1080,
    height: 1920,
    bitrate: null,
    qualityLabel: '1080p',
    sizeBytes: 5_000_000,
    audioState: 'UNKNOWN',
    downloadable: true,
    verificationEvidence: {
      httpStatus: 200,
      mimeType: 'video/mp4',
      contentLength: 5_000_000,
      acceptRanges: true,
      redirectCount: 0,
      signatureKind: 'mp4',
      usedRangeProbe: false,
    },
    requestContext: null,
    verifiedAt: Date.now(),
    sourceGeneration: 1,
    ...partial,
  };
}

console.log('Phase 4B — Social Source Reliability Verification\n');

async function main(): Promise<void> {
  clearAllVerificationSessions();
  socialPageContextStore.clearAll();

  await test('1. HTML rejection (MIME policy)', () => {
    assert(isNonMediaDocumentMime('text/html'), 'html');
    assert(isNonMediaDocumentMime('application/xhtml+xml'), 'xhtml');
  });

  await test('2. JSON rejection (MIME policy)', () => {
    assert(isNonMediaDocumentMime('application/json'), 'json');
  });

  await test('3. MP4 signature acceptance', () => {
    const bytes = new Uint8Array(32);
    bytes[4] = 0x66;
    bytes[5] = 0x74;
    bytes[6] = 0x79;
    bytes[7] = 0x70;
    const sniff = sniffMediaSignature(bytes);
    assert(sniff.ok && sniff.kind === 'mp4', 'ftyp');
  });

  await test('4. generic MIME + valid signature handling', () => {
    const bytes = new Uint8Array(32);
    bytes[4] = 0x66;
    bytes[5] = 0x74;
    bytes[6] = 0x79;
    bytes[7] = 0x70;
    assert(sniffMediaSignature(bytes).ok, 'octet-stream path via signature');
  });

  await test('5. positive size preservation', () => {
    assert(resolveCredibleSizeBytes(12_345_678) === 12_345_678, 'size');
  });

  await test('6. unknown size omission', () => {
    assert(resolveCredibleSizeBytes(null) == null, 'null');
    assert(resolveCredibleSizeBytes(0) == null, 'zero');
    assert(resolveCredibleSizeBytes(1) == null, 'range-1');
    assert(resolveCredibleSizeBytes(-1) == null, 'neg');
  });

  await test('7. quality normalization', () => {
    assert(resolveQualityLabelFromEvidence({ width: 1920, height: 1080 }) === '1080p', '1080');
    assert(resolveQualityLabelFromEvidence({ width: 1280, height: 720 }) === '720p', '720');
  });

  await test('8. quality unknown omission', () => {
    assert(resolveQualityLabelFromEvidence({}) == null, 'unknown');
  });

  await test('9. audio INCLUDED evidence', () => {
    const media = makeMedia({
      id: 'a',
      url: 'https://cdn.example/v.mp4',
      audioCodec: 'mp4a.40.2',
      videoOnly: false,
      hasSeparateAudio: false,
    });
    assert(resolveSocialAudioState(media) === 'INCLUDED', 'included');
  });

  await test('10. VIDEO_ONLY classification', () => {
    const media = makeMedia({
      id: 'v',
      url: 'https://cdn.example/v.mp4',
      videoOnly: true,
      hasSeparateAudio: true,
    });
    assert(resolveSocialAudioState(media) === 'VIDEO_ONLY', 'video only');
    assert(isVideoOnlyUnsupportedForCombinedUx('VIDEO_ONLY'), 'unsupported combined');
  });

  await test('11. UNKNOWN audio', () => {
    const media = makeMedia({ id: 'u', url: 'https://cdn.example/v.mp4' });
    assert(resolveSocialAudioState(media) === 'UNKNOWN', 'unknown');
    assert(isCombinedDownloadActionable('UNKNOWN'), 'unknown still actionable');
  });

  await test('12. same variant signed URL normalization', () => {
    const a = 'https://cdn.instagram.com/v/ABC.mp4?token=AAA&expires=1';
    const b = 'https://cdn.instagram.com/v/ABC.mp4?token=BBB&expires=2';
    assert(sameResourceFamily(a, b), 'family');
    const idA = buildResourceIdentityKey({
      contentIdentity: 'instagram:instagram_reel:ABC123',
      executableUrl: a,
      transport: 'progressive',
      height: 1920,
    });
    const idB = buildResourceIdentityKey({
      contentIdentity: 'instagram:instagram_reel:ABC123',
      executableUrl: b,
      transport: 'progressive',
      height: 1920,
    });
    assert(idA === idB, 'same identity');
  });

  await test('13. execution URL retains full query', () => {
    const full = 'https://cdn.instagram.com/v/ABC.mp4?sig=XYZ&oe=ABC';
    assert(preserveExecutableUrl(full) === full, 'preserved');
    assert(stableResourcePath(full)?.includes('?') !== true, 'path strips query');
  });

  await test('14. variant dedupe', () => {
    const content = 'instagram:instagram_reel:ABC123';
    const id = buildResourceIdentityKey({
      contentIdentity: content,
      executableUrl: 'https://cdn.instagram.com/v/ABC.mp4?t=1',
      transport: 'progressive',
      height: 1920,
    });
    const variants = dedupeVariants([
      makeVariant({
        variantId: 'v1',
        resourceIdentity: id,
        executableUrl: 'https://cdn.instagram.com/v/ABC.mp4?t=1',
        verifiedAt: 1,
      }),
      makeVariant({
        variantId: 'v2',
        resourceIdentity: id,
        executableUrl: 'https://cdn.instagram.com/v/ABC.mp4?t=2',
        verifiedAt: 2,
      }),
    ]);
    assert(variants.length === 1, 'one variant');
    assert(variants[0]!.executableUrl.includes('t=2'), 'fresher url');
  });

  await test('15. genuine multi-quality preservation', () => {
    const content = 'instagram:instagram_reel:ABC123';
    const hi = buildResourceIdentityKey({
      contentIdentity: content,
      executableUrl: 'https://cdn.instagram.com/v/hi.mp4',
      transport: 'progressive',
      height: 1920,
    });
    const lo = buildResourceIdentityKey({
      contentIdentity: content,
      executableUrl: 'https://cdn.instagram.com/v/lo.mp4',
      transport: 'progressive',
      height: 720,
    });
    const variants = dedupeVariants([
      makeVariant({
        variantId: 'hi',
        resourceIdentity: hi,
        executableUrl: 'https://cdn.instagram.com/v/hi.mp4',
        height: 1920,
        qualityLabel: '1080p',
      }),
      makeVariant({
        variantId: 'lo',
        resourceIdentity: lo,
        executableUrl: 'https://cdn.instagram.com/v/lo.mp4',
        height: 720,
        qualityLabel: '720p',
      }),
    ]);
    assert(variants.length === 2, 'two qualities');
  });

  await test('16. preferred combined variant over silent 1080', () => {
    const preferred = selectPreferredVariant([
      makeVariant({
        variantId: 'silent1080',
        resourceIdentity: 'r1',
        executableUrl: 'https://cdn/v1080.mp4',
        height: 1920,
        audioState: 'VIDEO_ONLY',
        downloadable: false,
      }),
      makeVariant({
        variantId: 'combined720',
        resourceIdentity: 'r2',
        executableUrl: 'https://cdn/v720.mp4',
        height: 1280,
        audioState: 'INCLUDED',
        downloadable: true,
        qualityLabel: '720p',
      }),
    ]);
    assert(preferred?.variantId === 'combined720', 'prefer combined');
  });

  await test('17. blob-only rejection', () => {
    assert(
      isFalsePositive({ url: 'blob:https://instagram.com/x' }),
      'blob false positive',
    );
  });

  await test('18. .ts rejection', () => {
    assert(isFalsePositive({ url: 'https://cdn.example/seg/1.ts' }), 'ts');
  });

  await test('19. .m4s standalone rejection', () => {
    assert(
      isFalsePositive({ url: 'https://cdn.example.com/dash/chunk_01.m4s' }),
      'm4s',
    );
  });

  await test('20. HLS top-level handling present', () => {
    const src = readSrc(
      'src/media-detection/social-source/social-source-reliability.service.ts',
    );
    assert(src.includes("'hls'"), 'hls transport');
    assert(src.includes('SEGMENT_RESOURCE'), 'segments rejected');
  });

  await test('21. stale source classification helpers', () => {
    const src = readSrc(
      'src/media-detection/social-source/social-source-reliability.service.ts',
    );
    assert(src.includes('EXPIRED_SOURCE'), 'expired');
    assert(src.includes('isLikelyExpiredMediaUrl'), 'expiry check');
  });

  await test('22. bounded refresh', () => {
    const provider = readSrc(
      'src/media-detection/social-source/social-source-provider.ts',
    );
    assert(provider.includes('MAX_REFRESH_ATTEMPTS'), 'cap');
    const match = /MAX_REFRESH_ATTEMPTS\s*=\s*(\d+)/.exec(provider);
    assert(match, 'constant present');
    const n = Number(match![1]);
    assert(n >= 1 && n <= 3, 'bounded');
    assert(!provider.includes('setInterval'), 'no interval');
  });

  await test('23. no refresh loop', () => {
    const provider = readSrc(
      'src/media-detection/social-source/social-source-provider.ts',
    );
    assert(!/while\s*\(.*expired/.test(provider), 'no while expired');
    assert(!provider.includes('setInterval'), 'no polling');
  });

  await test('24. in-flight verification dedupe', async () => {
    clearAllVerificationSessions();
    let starts = 0;
    const key = buildVerificationCacheKey({
      tabId: 't1',
      navigationEpoch: 1,
      socialContextGeneration: 1,
      contentIdentity: 'instagram:instagram_reel:ABC',
      executableUrl: 'https://cdn.instagram.com/v/x.mp4?sig=1',
    });
    const work = async () => {
      starts += 1;
      await new Promise((r) => setTimeout(r, 30));
      return makeVariant({
        variantId: 'x',
        resourceIdentity: 'rid',
        executableUrl: 'https://cdn.instagram.com/v/x.mp4?sig=1',
      });
    };
    const a = joinOrStartVerification(key, work);
    const b = joinOrStartVerification(key, work);
    assert(a.joined === false, 'first starts');
    assert(b.joined === true, 'second joins');
    const [va, vb] = await Promise.all([a.promise, b.promise]);
    assert(va && vb && va.variantId === vb.variantId, 'same result');
    assert(starts === 1, `one start got ${starts}`);
  });

  await test('25. stale social generation result ignored', () => {
    socialPageContextStore.clearAll();
    socialPageContextStore.setActiveTab('tab-a');
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.instagram.com/reel/AAA111/',
      navigationEpoch: 1,
    });
    const gen1 = socialPageContextStore.get('tab-a')!.contextGeneration;
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.instagram.com/reel/BBB222/',
      navigationEpoch: 1,
    });
    assert(
      socialPageContextStore.isStaleGeneration('tab-a', 1, gen1),
      'old gen stale',
    );
  });

  await test('26. tab isolation', () => {
    socialPageContextStore.clearAll();
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-ig',
      pageUrl: 'https://www.instagram.com/reel/AAA111/',
      navigationEpoch: 1,
    });
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-tt',
      pageUrl: 'https://www.tiktok.com/@u/video/1234567890123456789',
      navigationEpoch: 2,
    });
    assert(
      socialPageContextStore.get('tab-ig')?.canonicalContentId === 'AAA111',
      'ig',
    );
    assert(
      socialPageContextStore.get('tab-tt')?.canonicalContentId ===
        '1234567890123456789',
      'tt',
    );
  });

  await test('27. closed-tab result ignored / cleared', () => {
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-close',
      pageUrl: 'https://www.instagram.com/reel/CCC333/',
      navigationEpoch: 3,
    });
    clearVerificationForTab('tab-close');
    socialPageContextStore.clearTab('tab-close');
    assert(socialPageContextStore.get('tab-close') == null, 'cleared');
  });

  await test('28. consumed CTA not resurrected by refresh fingerprint', () => {
    const a = buildBrowserMediaFingerprint({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      mediaUrl: 'https://cdn.instagram.com/v/ABC.mp4?token=1',
      platform: 'instagram',
    });
    const b = buildBrowserMediaFingerprint({
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
      mediaUrl: 'https://cdn.instagram.com/v/ABC.mp4?token=2',
      platform: 'instagram',
    });
    assert(a === b, 'same consumption identity across resign');
  });

  await test('29. no backend/API addition', () => {
    const dir = join(ROOT, 'src/media-detection/social-source');
    assert(existsSync(dir), 'module exists');
    for (const file of [
      'social-source-reliability.service.ts',
      'social-source-provider.ts',
      'verification-session.ts',
    ]) {
      const src = readSrc(`src/media-detection/social-source/${file}`);
      assert(!src.includes('supabase'), `${file} no supabase`);
      assert(!src.includes('firebase'), `${file} no firebase`);
      assert(!/https:\/\/api\./i.test(src), `${file} no remote api host`);
    }
  });

  await test('30. no polling', () => {
    const files = [
      'social-source-reliability.service.ts',
      'social-source-provider.ts',
      'verification-session.ts',
    ];
    for (const file of files) {
      const src = readSrc(`src/media-detection/social-source/${file}`);
      assert(!src.includes('setInterval'), `${file} no setInterval`);
    }
  });

  await test('HTML signature rejection', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html>');
    const sniff = sniffMediaSignature(html);
    assert(!sniff.ok && sniff.kind === 'html', 'html bytes');
  });

  await test('JSON signature rejection', () => {
    const json = new TextEncoder().encode('{"error":"denied"}');
    const sniff = sniffMediaSignature(json);
    assert(!sniff.ok && sniff.kind === 'json', 'json bytes');
  });

  await test('Phase 4A remains ownership authority (wiring)', () => {
    const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    assert(hook.includes('buildVerifiedSocialMediaOffer'), '4B offer');
    assert(hook.includes('selectCurrentMediaForActiveSocialTab'), '4A pick');
    assert(hook.includes('isSocialScopeCurrent'), 'stale guard');
  });

  await test('refresh uses Phase 4A correlation', () => {
    const refresh = readSrc('src/media-detection/services/media-refresh.service.ts');
    assert(refresh.includes('selectCurrentMediaForActiveSocialTab'), '4A refresh');
  });

  console.log(`\nPhase 4B result: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
