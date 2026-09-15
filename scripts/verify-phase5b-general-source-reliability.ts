/**
 * Phase 5B — General source reliability verifier.
 * Usage: npm run verify:phase5b-general-source-reliability
 *
 * Deterministic TypeScript checks — no Maestro / Appium / Python / live CDN.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sniffMediaSignature } from '../src/downloads/engine/media-signature';
import { classifyMp4Container } from '../src/downloads/engine/mp4-box-classify';
import { parseHlsManifest } from '../src/media-detection/parsers/hls.parser';
import {
  resolveSocialAudioState,
  isCombinedDownloadActionable,
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
} from '../src/media-detection/social-source/verification-session';
import { isLikelyMediaSegment } from '../src/media-detection/services/false-positive.filter';
import { generalPageMediaContextStore } from '../src/media-detection/general-media';
import {
  resolveHlsAudioState,
  resolveSizeFromHttpHeaders,
  hlsSizeBytesAlwaysOmitted,
  looksLikeHlsCandidate,
  isHlsDrmOrUnsupportedEncryption,
} from '../src/media-detection/general-source/hls-evidence';
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

function ftypBox(): Uint8Array {
  // size(4) + 'ftyp' + 'isom' + minor
  const b = new Uint8Array(24);
  b[0] = 0;
  b[1] = 0;
  b[2] = 0;
  b[3] = 24;
  b.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
  b.set([0x69, 0x73, 0x6f, 0x6d], 8); // isom
  return b;
}

function appendBox(type: string, payloadLen: number): Uint8Array {
  const size = 8 + payloadLen;
  const b = new Uint8Array(size);
  b[0] = (size >>> 24) & 0xff;
  b[1] = (size >>> 16) & 0xff;
  b[2] = (size >>> 8) & 0xff;
  b[3] = size & 0xff;
  b[4] = type.charCodeAt(0);
  b[5] = type.charCodeAt(1);
  b[6] = type.charCodeAt(2);
  b[7] = type.charCodeAt(3);
  return b;
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

function makeVariant(
  partial: Partial<VerifiedSocialMediaVariant> & {
    variantId: string;
    resourceIdentity: string;
  },
): VerifiedSocialMediaVariant {
  return {
    executableUrl: 'https://cdn.example.com/v.mp4?sig=1',
    transport: 'progressive',
    container: 'mp4',
    mimeType: 'video/mp4',
    width: 1280,
    height: 720,
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

function makeMedia(
  partial: Partial<DetectedMedia> & { id: string; url: string },
): DetectedMedia {
  return {
    sourceUrl: partial.url,
    finalUrl: partial.url,
    pageUrl: 'https://example.com/watch',
    title: null,
    thumbnailUrl: null,
    duration: null,
    width: 1280,
    height: 720,
    resolution: '720p',
    aspectRatio: 16 / 9,
    fps: null,
    estimatedFileSize: 5_000_000,
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
    websiteSource: 'example.com',
    detectionSource: 'dom_video',
    sourceDetector: 'dom_video',
    detectedAt: Date.now(),
    confidence: 0.8,
    downloadable: true,
    requiresCookies: false,
    requiredHeaders: null,
    redirectCount: 0,
    platformHint: 'GENERIC',
    hasSeparateAudio: false,
    videoOnly: false,
    ...partial,
  };
}

console.log('Phase 5B — General Source Reliability Verification\n');

async function main(): Promise<void> {
  clearAllVerificationSessions();
  generalPageMediaContextStore.clearAll();

  await test('1. valid progressive MP4', () => {
    const bytes = concat(ftypBox(), appendBox('mdat', 64));
    const sniff = sniffMediaSignature(bytes, {
      resourceTotalBytes: 5_000_000,
      requireStandaloneMp4: true,
    });
    assert(sniff.ok, 'ok');
    assert(sniff.kind === 'mp4', 'mp4');
    assert(
      sniff.mp4Kind === 'PROGRESSIVE_OR_COMPLETE' ||
        sniff.mp4Kind === 'FRAGMENTED_COMPLETE',
      `kind ${sniff.mp4Kind}`,
    );
  });

  await test('2. valid complete fragmented MP4', () => {
    const bytes = concat(
      ftypBox(),
      appendBox('moov', 32),
      appendBox('moof', 32),
      appendBox('mdat', 64),
    );
    const classified = classifyMp4Container({
      bytes,
      resourceTotalBytes: 2_000_000,
    });
    assert(classified.kind === 'FRAGMENTED_COMPLETE', classified.kind);
    const sniff = sniffMediaSignature(bytes, {
      resourceTotalBytes: 2_000_000,
      requireStandaloneMp4: true,
    });
    assert(sniff.ok, 'fmp4 complete ok');
  });

  await test('3. init segment rejection', () => {
    const bytes = concat(ftypBox(), appendBox('moov', 32));
    const sniff = sniffMediaSignature(bytes, {
      resourceTotalBytes: 500,
      coversEntireResource: true,
      requireStandaloneMp4: true,
    });
    assert(!sniff.ok, 'reject init');
    assert(sniff.reason === 'init_segment', sniff.reason ?? '');
  });

  await test('4. media fragment rejection', () => {
    const bytes = concat(appendBox('moof', 32), appendBox('mdat', 32));
    const sniff = sniffMediaSignature(bytes, { requireStandaloneMp4: true });
    assert(!sniff.ok, 'reject fragment');
    assert(sniff.reason === 'media_fragment', sniff.reason ?? '');
  });

  await test('5. HTML masquerading as MP4', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html>');
    const sniff = sniffMediaSignature(html, { requireStandaloneMp4: true });
    assert(!sniff.ok, 'reject html');
    assert(sniff.kind === 'html', sniff.kind);
  });

  await test('6. JSON masquerading as MP4', () => {
    const json = new TextEncoder().encode('{"error":"denied"}');
    const sniff = sniffMediaSignature(json, { requireStandaloneMp4: true });
    assert(!sniff.ok, 'reject json');
    assert(sniff.kind === 'json', sniff.kind);
  });

  await test('7. generic MIME + valid MP4', () => {
    const bytes = concat(ftypBox(), appendBox('mdat', 64));
    const sniff = sniffMediaSignature(bytes, {
      resourceTotalBytes: 8_000_000,
      requireStandaloneMp4: true,
    });
    assert(sniff.ok, 'structure beats generic MIME');
  });

  await test('8. WebM EBML verify', () => {
    const ebml = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
    const sniff = sniffMediaSignature(ebml);
    assert(sniff.ok, 'webm ok');
    assert(sniff.kind === 'webm', sniff.kind);
  });

  await test('9. fake .webm HTML reject', () => {
    const html = new TextEncoder().encode('<html><body>not webm</body></html>');
    const sniff = sniffMediaSignature(html);
    assert(!sniff.ok, 'fake webm rejected');
    assert(sniff.kind === 'html', sniff.kind);
  });

  await test('10. valid HLS master', () => {
    const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720
mid.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080
hi.m3u8
`;
    const parsed = parseHlsManifest(master, 'https://cdn.example.com/master.m3u8');
    assert(parsed?.isMaster === true, 'master');
    assert(parsed!.variants.length === 3, '3 variants');
  });

  await test('11. valid HLS media playlist', () => {
    const media = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
seg0.ts
#EXT-X-ENDLIST
`;
    const parsed = parseHlsManifest(media, 'https://cdn.example.com/media.m3u8');
    assert(parsed?.isMedia === true, 'media');
    assert(parsed!.segmentUris.length >= 1, 'segments collected not exposed');
  });

  await test('12. individual .ts rejected', () => {
    assert(
      isLikelyMediaSegment('https://cdn.example.com/hls/segment001.ts', 'ts'),
      'ts segment',
    );
  });

  await test('13. individual .m4s rejected', () => {
    assert(
      isLikelyMediaSegment('https://cdn.example.com/dash/chunk-1.m4s', 'm4s'),
      'm4s segment',
    );
  });

  await test('14. HLS variants grouped', () => {
    const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42e01e,mp4a.40.2"
a.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
b.m3u8
`;
    const parsed = parseHlsManifest(master, 'https://cdn.example.com/master.m3u8');
    assert(parsed!.variants.length === 2, 'grouped under parse');
    const labels = parsed!.variants.map((v) =>
      resolveQualityLabelFromEvidence({ width: v.width, height: v.height }),
    );
    assert(labels.includes('360p'), '360p');
    assert(labels.includes('1080p'), '1080p');
  });

  await test('15. unsupported DRM rejected', () => {
    const enc = `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key",KEYFORMAT="com.apple.streamingkeydelivery"
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
seg.ts
`;
    const parsed = parseHlsManifest(enc, 'https://cdn.example.com/enc.m3u8');
    assert(parsed != null, 'parsed');
    assert(isHlsDrmOrUnsupportedEncryption(parsed!), 'drm flagged');
  });

  await test('16. HLS quality from RESOLUTION', () => {
    const label = resolveQualityLabelFromEvidence({ width: 1920, height: 1080 });
    assert(label === '1080p', label ?? '');
  });

  await test('17. HLS unknown size omitted', () => {
    assert(hlsSizeBytesAlwaysOmitted() === null, 'omit size');
  });

  await test('18. Content-Range total sizing', () => {
    const size = resolveSizeFromHttpHeaders({
      contentLength: 1,
      contentRange: 'bytes 0-0/5242880',
    });
    assert(size === 5_242_880, String(size));
  });

  await test('19. probe Content-Length not total size', () => {
    const size = resolveSizeFromHttpHeaders({
      contentLength: 1,
      contentRange: null,
    });
    assert(size === null, 'tiny CL ignored');
    assert(resolveCredibleSizeBytes(1, null) === null, 'credible rejects tiny');
  });

  await test('20. audio INCLUDED only with evidence', () => {
    const media = makeMedia({
      id: 'a',
      url: 'https://cdn.example.com/a.mp4',
      audioCodec: 'aac',
      videoOnly: false,
    });
    assert(resolveSocialAudioState(media) === 'INCLUDED', 'included');
  });

  await test('21. VIDEO_ONLY classification', () => {
    const media = makeMedia({
      id: 'v',
      url: 'https://cdn.example.com/v.mp4',
      videoOnly: true,
      hasSeparateAudio: true,
    });
    assert(resolveSocialAudioState(media) === 'VIDEO_ONLY', 'video only');
    assert(!isCombinedDownloadActionable('VIDEO_ONLY'), 'not combined');
  });

  await test('22. UNKNOWN audio', () => {
    const media = makeMedia({
      id: 'u',
      url: 'https://cdn.example.com/u.mp4',
      audioCodec: null,
      videoOnly: false,
    });
    assert(resolveSocialAudioState(media) === 'UNKNOWN', 'unknown');
    assert(resolveHlsAudioState({ codecs: null }) === 'UNKNOWN', 'hls unknown');
  });

  await test('23. quality unknown', () => {
    assert(
      resolveQualityLabelFromEvidence({ width: null, height: null }) === null,
      'omit',
    );
  });

  await test('24. signed query same resource identity', () => {
    const a = buildResourceIdentityKey({
      contentIdentity: 'general:page',
      executableUrl: 'https://cdn.example.com/v.mp4?token=A',
      transport: 'progressive',
      height: 720,
    });
    const b = buildResourceIdentityKey({
      contentIdentity: 'general:page',
      executableUrl: 'https://cdn.example.com/v.mp4?token=B',
      transport: 'progressive',
      height: 720,
    });
    assert(a === b, 'same identity');
    assert(
      sameResourceFamily(
        'https://cdn.example.com/v.mp4?token=A',
        'https://cdn.example.com/v.mp4?token=B',
      ),
      'same family',
    );
  });

  await test('25. executable URL retains full query', () => {
    const url = 'https://cdn.example.com/v.mp4?token=SECRET&exp=1';
    assert(preserveExecutableUrl(url) === url, 'preserve');
    assert(stableResourcePath(url)?.includes('token') !== true, 'identity strips query');
  });

  await test('26. duplicate observer source deduped', () => {
    const v1 = makeVariant({
      variantId: '1',
      resourceIdentity: 'id|progressive|cdn/v.mp4|mp4|1280|720|',
      verifiedAt: 1,
    });
    const v2 = makeVariant({
      variantId: '2',
      resourceIdentity: 'id|progressive|cdn/v.mp4|mp4|1280|720|',
      verifiedAt: 2,
    });
    const deduped = dedupeVariants([v1, v2]);
    assert(deduped.length === 1, 'deduped');
  });

  await test('27. different qualities preserved', () => {
    const low = makeVariant({
      variantId: 'low',
      resourceIdentity: 'id|hls|cdn/low|hls|640|360|',
      height: 360,
      qualityLabel: '360p',
    });
    const hi = makeVariant({
      variantId: 'hi',
      resourceIdentity: 'id|hls|cdn/hi|hls|1920|1080|',
      height: 1080,
      qualityLabel: '1080p',
    });
    assert(dedupeVariants([low, hi]).length === 2, 'qualities kept');
  });

  await test('28. 1080 VIDEO_ONLY does not beat 720 INCLUDED normal video', () => {
    const vo = makeVariant({
      variantId: 'vo1080',
      resourceIdentity: 'vo',
      height: 1080,
      qualityLabel: '1080p',
      audioState: 'VIDEO_ONLY',
      downloadable: false,
    });
    const included = makeVariant({
      variantId: 'inc720',
      resourceIdentity: 'inc',
      height: 720,
      qualityLabel: '720p',
      audioState: 'INCLUDED',
      downloadable: true,
    });
    const preferred = selectPreferredVariant([vo, included]);
    assert(preferred?.variantId === 'inc720', preferred?.variantId ?? 'null');
  });

  await test('29. 5A rejected ownership cannot be resurrected by ranking', () => {
    const svc = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(svc.includes("ownershipConfidence === 'REJECTED'"), 'reject gate');
    assert(svc.includes('ownership_rejected_not_resurrected'), 'diag');
    assert(svc.includes('WEAK_OWNERSHIP'), 'reason');
  });

  await test('30. in-flight verification join', async () => {
    clearAllVerificationSessions();
    let starts = 0;
    const key = buildVerificationCacheKey({
      tabId: 't1',
      navigationEpoch: 1,
      socialContextGeneration: 2,
      contentIdentity: 'media-a',
      executableUrl: 'https://cdn.example.com/v.mp4?x=1',
    });
    const start = () => {
      starts += 1;
      return new Promise<VerifiedSocialMediaVariant | null>((resolve) => {
        setTimeout(() => resolve(makeVariant({ variantId: 'j', resourceIdentity: 'r' })), 20);
      });
    };
    const a = joinOrStartVerification(key, start);
    const b = joinOrStartVerification(key, start);
    assert(a.joined === false, 'first starts');
    assert(b.joined === true, 'second joins');
    await Promise.all([a.promise, b.promise]);
    assert(starts === 1, `starts=${starts}`);
  });

  await test('31. stale page generation ignored', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-g');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-g',
      pageUrl: 'https://example.com/a',
      navigationEpoch: 3,
    });
    const cur = generalPageMediaContextStore.get('tab-g');
    assert(cur != null, 'ctx');
    assert(
      generalPageMediaContextStore.isStaleGeneration(
        'tab-g',
        3,
        (cur?.pageGeneration ?? 0) + 99,
      ),
      'stale gen',
    );
    const svc = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(svc.includes('STALE_PAGE_GENERATION'), 'stale reason');
  });

  await test('32. no polling', () => {
    for (const rel of [
      'src/media-detection/general-source/general-source-reliability.service.ts',
      'src/media-detection/general-source/hls-evidence.ts',
      'src/media-detection/general-source/general-source-diagnostics.ts',
    ]) {
      assert(!/setInterval\s*\(/.test(readSrc(rel)), `${rel} no poll`);
    }
  });

  await test('33. no backend', () => {
    const svc = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(!/supabase/i.test(svc), 'no supabase');
    assert(!/firebase/i.test(svc), 'no firebase');
    assert(!/axios\.create/.test(svc), 'no remote api client');
  });

  await test('34. no FFmpeg', () => {
    const svc = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(!/ffmpeg/i.test(svc), 'no ffmpeg');
    assert(!/muxer/i.test(svc), 'no muxer');
  });

  await test('35. safe logs', () => {
    const diag = readSrc(
      'src/media-detection/general-source/general-source-diagnostics.ts',
    );
    assert(diag.includes('[GeneralSource]'), 'tag');
    assert(diag.includes('mediaIdentityHash'), 'hashed id');
    assert(diag.includes('Never logs'), 'policy comment');
    // Must not interpolate Authorization / cookie values into console payloads.
    assert(!/console\.log\([\s\S]*Authorization/.test(diag), 'no auth header log');
    assert(!/console\.log\([\s\S]*cookie/i.test(diag), 'no cookie log');
    assert(!/fields\.executableUrl/.test(diag), 'no full URL field');
  });

  await test('architecture: reuses 4B / CTA wired / no parallel detector', () => {
    assert(
      existsSync(
        join(ROOT, 'src/media-detection/general-source/general-source-reliability.service.ts'),
      ),
      'module exists',
    );
    const svc = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(svc.includes('verifySocialSourceCandidate'), 'reuses 4B verify');
    assert(svc.includes('selectPreferredVariant'), 'reuses ranking');
    const cta = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    assert(cta.includes('buildVerifiedGeneralMediaOffer'), 'CTA general path');
    assert(cta.includes('generalScope'), 'general scope capture');
    assert(looksLikeHlsCandidate({ url: 'https://x/a.m3u8' }), 'hls helper');
  });

  console.log(`\nPhase 5B results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
