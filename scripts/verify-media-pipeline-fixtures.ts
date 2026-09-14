/**
 * Deterministic media pipeline fixture tests — no live Instagram/TikTok URLs.
 * Run: npx tsx scripts/verify-media-pipeline-fixtures.ts
 */
import { buildDownloadHeaders } from '../src/downloads/engine/download-headers';
import {
  MIN_VALID_MEDIA_BYTES,
  sniffMediaSignature,
} from '../src/downloads/engine/media-signature';
import type { MediaRequestContext } from '../src/downloads/types/request-context';
import {
  markMsePlayback,
  clearMsePlayback,
  getMsePlaybackContext,
} from '../src/media-detection/engine/mse-playback-context';
import {
  assessExpiringMediaUrl,
  isLikelyExpiredMediaUrl,
} from '../src/media-detection/services/expiring-url.service';
import { instagramPlatformAdapter } from '../src/media-detection/platform/instagram.adapter';
import { tiktokPlatformAdapter } from '../src/media-detection/platform/tiktok.adapter';
import { isShareOrShortLink } from '../src/media-detection/services/page-url.resolver';
import {
  filterCorrelatedCandidates,
  scoreMediaCorrelation,
} from '../src/media-detection/services/media-correlation.service';
import type { DetectedMedia } from '../src/media-detection/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  passed += 1;
  console.log(`PASS: ${message}`);
}

function makeMedia(overrides: Partial<DetectedMedia>): DetectedMedia {
  const url =
    overrides.url ?? 'https://v16-webapp-prime.tiktok.com/video/tos/abc.mp4';
  return {
    id: 'test-id',
    url,
    sourceUrl: url,
    finalUrl: url,
    pageUrl: 'https://www.tiktok.com/@user/video/123',
    title: null,
    thumbnailUrl: null,
    duration: null,
    width: null,
    height: null,
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
    websiteSource: null,
    detectionSource: 'native_network',
    sourceDetector: 'native_network',
    detectedAt: Date.now(),
    confidence: 0.55,
    downloadable: true,
    requiresCookies: false,
    requiredHeaders: null,
    redirectCount: 0,
    platformHint: 'tiktok',
    hasSeparateAudio: false,
    videoOnly: false,
    ...overrides,
  };
}

assert(
  isShareOrShortLink('https://vt.tiktok.com/ZSVtTrHh5/'),
  'detects TikTok short link',
);
assert(
  isShareOrShortLink('https://www.instagram.com/reel/DcmMB5FAKt6/'),
  'detects Instagram host',
);

const ig = instagramPlatformAdapter.describePage(
  'https://www.instagram.com/reel/DcmMB5FAKt6/?igsi=test',
);
assert(ig.kind === 'instagram' && ig.isPublicContentPath, 'Instagram reel page recognized');

const tt = tiktokPlatformAdapter.describePage(
  'https://www.tiktok.com/@user/video/1234567890',
);
assert(tt.kind === 'tiktok' && tt.isPublicContentPath, 'TikTok video page recognized');

const ctx: MediaRequestContext = {
  pageUrl: 'https://www.instagram.com/reel/abc/',
  referer: 'https://www.instagram.com/reel/abc/',
  userAgent: 'Mozilla/5.0 VidoraXBrowser/1.0 Mobile',
  cookiesRequired: true,
  hasCookies: true,
  headers: {
    Referer: 'https://www.instagram.com/reel/abc/',
    'User-Agent': 'Mozilla/5.0 VidoraXBrowser/1.0 Mobile',
    Cookie: 'session=secret',
    Accept: '*/*',
  },
  capturedAt: Date.now(),
};

const headers = buildDownloadHeaders(ctx);
assert(Boolean(headers.Referer), 'download headers include Referer');
assert(Boolean(headers['User-Agent']), 'download headers include User-Agent');
assert(Boolean(headers.Cookie), 'download headers include Cookie when present');
assert(
  headers.Referer === ctx.referer && headers['User-Agent'] === ctx.userAgent,
  'HLS segment headers match session context',
);

const expiring = assessExpiringMediaUrl(
  'https://cdn.example.com/v.mp4?expires=1000&sig=abc',
);
assert(expiring.likelyExpiring && expiring.isExpired, 'expired signed URL detected');

assert(
  isLikelyExpiredMediaUrl('https://cdn.example.com/v.mp4?token=abc', Date.now() - 130_000),
  'stale signed URL without explicit expiry',
);

const mp4Head = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
assert(sniffMediaSignature(mp4Head).ok, 'recognizes MP4 ftyp signature');

const htmlHead = new TextEncoder().encode('<!doctype html><html>');
assert(!sniffMediaSignature(htmlHead).ok, 'rejects HTML saved as media');

const jsonHead = new TextEncoder().encode('{"error":"denied"}');
assert(!sniffMediaSignature(jsonHead).ok, 'rejects JSON error payload');

assert(MIN_VALID_MEDIA_BYTES >= 16_384, 'minimum valid media size threshold');

const blobScore = scoreMediaCorrelation(
  makeMedia({ url: 'blob:https://www.tiktok.com/abc', category: 'stream' }),
  { pageUrl: 'https://www.tiktok.com/@user/video/123' },
);
assert(blobScore.reject, 'rejects blob URLs for download');

const thumbScore = scoreMediaCorrelation(
  makeMedia({
    url: 'https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/thumbnail.jpg',
    mimeType: 'image/jpeg',
  }),
  { pageUrl: 'https://www.tiktok.com/@user/video/123' },
);
assert(thumbScore.reject, 'rejects TikTok thumbnail image');

const igCdn = makeMedia({
  url: 'https://scontent.cdninstagram.com/v/t51.2885-15/video.mp4',
  pageUrl: 'https://www.instagram.com/reel/abc/',
  mimeType: 'video/mp4',
  detectionSource: 'js_fetch',
});
const igFiltered = filterCorrelatedCandidates([igCdn], {
  pageUrl: 'https://www.instagram.com/reel/abc/',
});
assert(igFiltered.length === 1, 'keeps correlated Instagram CDN video');

clearMsePlayback();
markMsePlayback('https://www.instagram.com/reel/abc/');
const mse = getMsePlaybackContext('https://www.instagram.com/reel/abc/');
assert(mse.msePlaybackActive, 'MSE playback window active after blob indicator');
const mseBoost = scoreMediaCorrelation(igCdn, {
  pageUrl: 'https://www.instagram.com/reel/abc/',
  msePlaybackActive: mse.msePlaybackActive,
  msePlaybackAgeMs: mse.msePlaybackAgeMs,
});
assert(mseBoost.score > igCdn.confidence, 'MSE window boosts network candidate score');
clearMsePlayback();

const silentAdaptive = scoreMediaCorrelation(
  makeMedia({
    videoOnly: true,
    hasSeparateAudio: true,
    streamType: 'DASH',
    container: 'dash',
  }),
  { pageUrl: 'https://www.youtube.com/watch?v=abc' },
);
assert(silentAdaptive.score < 0.42 || silentAdaptive.reject, 'penalizes silent adaptive video-only');

import { isSameDocumentUrl } from '../src/media-detection/utils';
import {
  classifyPasteInput,
  requiresPageMediaResolution,
} from '../src/media-detection/services/platform-page-url';
import { pendingMediaResolutionService } from '../src/media-detection/services/pending-media-resolution.service';

assert(
  !requiresPageMediaResolution('https://cdn.example.com/video.mp4'),
  'direct MP4 skips page resolution',
);
assert(
  classifyPasteInput('https://cdn.example.com/video.mp4') === 'direct',
  'direct MP4 uses direct analyzer path',
);
assert(
  classifyPasteInput('https://vt.tiktok.com/ZSVtTrHh5/') === 'page',
  'TikTok short link uses page-resolution path',
);
assert(
  classifyPasteInput('https://www.instagram.com/reel/DcmMB5FAKt6/') === 'page',
  'Instagram Reel uses page-resolution path',
);

const igCanonical = 'https://www.instagram.com/reel/DcmMB5FAKt6/';
const igWithTracking =
  'https://www.instagram.com/reel/DcmMB5FAKt6/?igsi=eHllbXF4azBpa29u';
assert(
  isSameDocumentUrl(igCanonical, igWithTracking),
  'Instagram reel with igsi matches canonical document',
);
assert(
  !isSameDocumentUrl(igCanonical, 'https://www.instagram.com/reel/OTHERID/'),
  'different Instagram reel IDs do not match',
);

const session = pendingMediaResolutionService.start({
  originalUrl: 'https://vt.tiktok.com/ZSVtTrHh5/',
  canonicalUrl: 'https://www.tiktok.com/@user/video/123',
  platform: 'tiktok',
});
assert(session.platform === 'tiktok', 'pending resolution stores platform');
assert(
  pendingMediaResolutionService.matchesPageUrl(
    'https://www.tiktok.com/@user/video/123',
  ),
  'pending resolution matches canonical browser page',
);
pendingMediaResolutionService.clear();
assert(pendingMediaResolutionService.get() === null, 'pending resolution clears');

const igSession = pendingMediaResolutionService.start({
  originalUrl: igWithTracking,
  canonicalUrl: igCanonical,
  platform: 'instagram',
});
assert(
  pendingMediaResolutionService.matchesPageUrl(igWithTracking),
  'pending resolution matches Instagram page with tracking query',
);
pendingMediaResolutionService.clear();

markMsePlayback(igWithTracking);
const mseIg = getMsePlaybackContext(igCanonical);
assert(
  mseIg.msePlaybackActive,
  'MSE playback window matches reel across tracking query',
);
clearMsePlayback();

console.log(`\nMedia pipeline fixtures: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
