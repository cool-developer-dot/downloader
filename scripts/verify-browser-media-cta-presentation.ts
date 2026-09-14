/**
 * Phase 3E — Browser Download CTA presentation verifier.
 * Usage (from mobile/): npm run verify:browser-media-cta-presentation
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import { initialBrowserMediaActionState } from '../src/browser/media-actions/browser-media-action.types';
import type { BrowserMediaActionState } from '../src/browser/media-actions/browser-media-action.types';
import {
  buildBrowserDownloadPresentation,
  buildMetadataLine,
  formatDownloadAudioLabel,
  formatDownloadFormatLabel,
  formatDownloadQualityLabel,
  formatDownloadSizeLabel,
  isBrowserDownloadCtaEligible,
  isRejectedDownloadTarget,
  resolveDownloadPlatformTitle,
  resolveVerifiedSizeBytes,
} from '../src/browser/media-actions/browser-download-presentation';
import type { MediaAnalysisResult } from '../src/api/types';
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

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function makeMedia(overrides: Partial<DetectedMedia> = {}): DetectedMedia {
  return {
    id: 'md_cta',
    url: 'https://cdn.example.com/video.mp4',
    finalUrl: null,
    sourceUrl: null,
    pageUrl: 'https://www.instagram.com/reel/abc123/',
    title: 'Ignored raw title that must not leak',
    mimeType: 'video/mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'DIRECT',
    confidence: 0.8,
    detectionSource: 'native_network',
    requiresCookies: true,
    requiredHeaders: null,
    thumbnailUrl: null,
    duration: 12,
    width: 1080,
    height: 1920,
    resolution: '1080x1920',
    bitrate: null,
    codec: null,
    audioCodec: 'aac',
    estimatedFileSize: 18_400_000,
    websiteSource: 'instagram.com',
    isDrm: false,
    videoOnly: false,
    hasSeparateAudio: false,
    aspectRatio: null,
    fps: null,
    extension: 'mp4',
    isLive: false,
    playlistType: null,
    streamProtocol: null,
    sourceDetector: 'native_network',
    detectedAt: Date.now(),
    downloadable: true,
    redirectCount: 0,
    platformHint: 'INSTAGRAM',
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<MediaAnalysisResult> = {}): MediaAnalysisResult {
  return {
    title: 'Should not become CTA title',
    sourceUrl: 'https://cdn.example.com/video.mp4',
    finalUrl: 'https://cdn.example.com/video.mp4',
    thumbnailUrl: null,
    mediaType: 'video',
    mimeType: 'video/mp4',
    container: 'mp4',
    duration: 12,
    width: 1080,
    height: 1920,
    resolution: '1080x1920',
    bitrate: null,
    fps: null,
    fileSize: '18400000',
    platform: 'INSTAGRAM',
    downloadable: true,
    unsupportedReason: null,
    variants: [],
    ...overrides,
  };
}

function makeVerifiedState(
  overrides: Partial<BrowserMediaActionState> = {},
): BrowserMediaActionState {
  const media = makeMedia();
  const analysis = makeAnalysis();
  return {
    ...initialBrowserMediaActionState,
    status: 'verified',
    pageUrl: media.pageUrl,
    media,
    analysis,
    requestContext: {
      referer: media.pageUrl,
      userAgent: 'test',
      cookiesRequired: true,
      hasCookies: true,
      capturedAt: Date.now(),
    },
    mediaUrl: analysis.finalUrl,
    mediaFingerprint: 'fp_test',
    ...overrides,
  };
}

// --- Static architecture guards ---
const barSrc = read('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
const hookSrc = read('src/browser/media-actions/useBrowserMediaAction.ts');
const presentationSrc = read('src/browser/media-actions/browser-download-presentation.ts');
const browserScreen = read('src/browser/BrowserScreen.tsx');
const downloadService = read('src/browser/media-actions/browser-media-download.service.ts');
const packageJson = read('package.json');

assert(
  presentationSrc.includes('buildBrowserDownloadPresentation'),
  'presentation module exists',
);
assert(
  hookSrc.includes('buildBrowserDownloadPresentation'),
  'hook derives presentation model',
);
assert(
  barSrc.includes('presentation.showCard') || barSrc.includes('action.presentation'),
  'CTA bar consumes presentation model',
);
assert(
  !barSrc.includes('.includes(".mp4")') && !barSrc.includes("includes('.mp4')"),
  'CTA bar has no raw .mp4 eligibility heuristic',
);
assert(
  !presentationSrc.includes('Size: Calculating'),
  'presentation never fabricates calculating size',
);
assert(
  hookSrc.includes('enqueueBrowserMediaDownload'),
  'CTA still uses existing Phase 1 handoff',
);
assert(
  downloadService.includes('useDownloadsStore') || downloadService.includes('createDownload'),
  'Phase 1 download service preserved',
);
assert(
  browserScreen.includes('overlayBlocking={tabSwitcherVisible}'),
  'tab switcher suppresses CTA overlay',
);
assert(
  !presentationSrc.includes('supabase') && !presentationSrc.includes('firebase'),
  'presentation introduces no backend',
);
assert(
  !barSrc.includes('{action.mediaUrl}') && !barSrc.includes('mediaUrl}'),
  'bar does not render raw media URLs as visible copy',
);
assert(
  packageJson.includes('verify:browser-media-cta-presentation'),
  'npm script registered',
);

// --- Size formatting ---
assert(formatDownloadSizeLabel(18_400_000)?.endsWith('MB') === true, 'size formats MB');
assert(formatDownloadSizeLabel(0) === null, 'zero bytes omitted');
assert(formatDownloadSizeLabel(-1) === null, 'negative bytes omitted');
assert(formatDownloadSizeLabel(Number.NaN) === null, 'NaN bytes omitted');
assert(formatDownloadSizeLabel(512)?.includes('B') === true, 'small sizes format');
assert(resolveVerifiedSizeBytes(makeAnalysis({ fileSize: '0' })) === null, '0 fileSize omitted');
assert(resolveVerifiedSizeBytes(makeAnalysis({ fileSize: null })) === null, 'null fileSize omitted');
assert(resolveVerifiedSizeBytes(makeAnalysis({ fileSize: '18400000' })) === 18_400_000, 'digit fileSize parsed');
assert(
  resolveVerifiedSizeBytes(
    makeAnalysis({
      fileSize: null,
      variants: [
        {
          id: 'v1',
          sourceUrl: 'u',
          streamType: 'PROGRESSIVE',
          label: null,
          resolution: null,
          width: null,
          height: null,
          bitrate: null,
          averageBitrate: null,
          videoBitrate: null,
          audioBitrate: null,
          codecs: null,
          videoCodec: null,
          audioCodec: null,
          container: 'mp4',
          mimeType: 'video/mp4',
          estimatedFileSize: 0,
          frameRate: null,
          downloadable: true,
          unsupportedReason: null,
        },
      ],
    }),
  ) === null,
  'zero variant estimate omitted',
);

// --- Format / quality / metadata omission ---
assert(formatDownloadFormatLabel(makeAnalysis(), null) === 'MP4', 'mp4 format mapped');
assert(formatDownloadFormatLabel(makeAnalysis({ mimeType: 'video/webm', container: 'webm' }), null) === 'WEBM', 'webm format mapped');
assert(formatDownloadFormatLabel(makeAnalysis({ mimeType: 'application/vnd.apple.mpegurl', container: 'hls' }), null) === 'HLS', 'hls format mapped');
assert(formatDownloadFormatLabel(makeAnalysis({ mimeType: null, container: 'unknown' }), null) === null, 'unknown format omitted');
assert(formatDownloadQualityLabel(makeAnalysis({ width: 1920, height: 1080, resolution: '1920x1080' }), null) === '1080p', '1920x1080 → 1080p');
assert(formatDownloadQualityLabel(makeAnalysis({ width: 1080, height: 1920, resolution: '1080x1920' }), null) === '1080p', 'portrait 1080x1920 → 1080p');
assert(formatDownloadQualityLabel(makeAnalysis({ width: null, height: null, resolution: null }), null) === null, 'unknown quality omitted');
assert(buildMetadataLine(['MP4', null, '1080p']) === 'MP4 • 1080p', 'metadata separators skip nulls');
assert(buildMetadataLine([null, null]) === null, 'empty metadata omitted');

// --- Audio policy ---
assert(
  formatDownloadAudioLabel(makeAnalysis(), makeMedia({ audioCodec: 'aac', videoOnly: false })) === 'Audio Included',
  'audioCodec evidence → Audio Included',
);
assert(
  formatDownloadAudioLabel(makeAnalysis(), makeMedia({ audioCodec: null, videoOnly: false })) === null,
  'unknown audio omitted (no invent from MP4)',
);
assert(
  formatDownloadAudioLabel(makeAnalysis(), makeMedia({ videoOnly: true, hasSeparateAudio: false, audioCodec: null })) === 'Video Only',
  'verified video-only label',
);
assert(
  formatDownloadAudioLabel(makeAnalysis(), makeMedia({ videoOnly: true, hasSeparateAudio: true, audioCodec: null })) === null,
  'separate A/V never claims Audio Included',
);

// --- Platform titles ---
assert(
  resolveDownloadPlatformTitle(makeAnalysis({ platform: 'INSTAGRAM' }), 'https://www.instagram.com/reel/abc/', null) === 'Instagram Reel',
  'Instagram Reel only on /reel/ path',
);
assert(
  resolveDownloadPlatformTitle(makeAnalysis({ platform: 'INSTAGRAM' }), 'https://www.instagram.com/p/abc/', null) === 'Instagram Video',
  'Instagram generic post is Video not Reel',
);
assert(
  resolveDownloadPlatformTitle(makeAnalysis({ platform: 'TIKTOK' }), 'https://www.tiktok.com/@u/video/1', null) === 'TikTok Video',
  'TikTok Video title',
);
assert(
  resolveDownloadPlatformTitle(makeAnalysis({ platform: 'OTHER' }), 'https://example.com/watch', null) === 'Video',
  'generic platform fallback',
);
assert(
  resolveDownloadPlatformTitle(makeAnalysis({ platform: 'OTHER' }), 'https://www.reddit.com/r/x/comments/1', null) === 'Reddit Video',
  'Reddit host mapping',
);

// --- Segment / blob rejection ---
assert(isRejectedDownloadTarget('blob:https://x/y') === true, 'blob rejected');
assert(isRejectedDownloadTarget('data:video/mp4;base64,xxx') === true, 'data URL rejected');
assert(isRejectedDownloadTarget('https://cdn.example.com/seg001.ts') === true, '.ts rejected');
assert(isRejectedDownloadTarget('https://cdn.example.com/frag.m4s') === true, '.m4s rejected');
assert(isRejectedDownloadTarget('https://cdn.example.com/video.mp4') === false, 'mp4 accepted');
assert(isRejectedDownloadTarget('https://cdn.example.com/master.m3u8') === false, 'm3u8 accepted');

// --- Eligibility / isolation ---
const verified = makeVerifiedState();
assert(
  isBrowserDownloadCtaEligible({
    actionState: verified,
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: verified.pageUrl,
    hasDownloadableOptions: true,
  }),
  'verified active-page candidate eligible',
);

assert(
  !isBrowserDownloadCtaEligible({
    actionState: { ...verified, status: 'detecting' },
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: verified.pageUrl,
    hasDownloadableOptions: true,
  }),
  'raw detecting state not eligible',
);

assert(
  !isBrowserDownloadCtaEligible({
    actionState: { ...verified, status: 'idle', analysis: null, media: null },
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: verified.pageUrl,
    hasDownloadableOptions: false,
  }),
  'no media → not eligible',
);

assert(
  !isBrowserDownloadCtaEligible({
    actionState: verified,
    activeTabId: 'tab-a',
    isHome: true,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: 'vidorax://home',
    hasDownloadableOptions: true,
  }),
  'Home suppresses CTA',
);

assert(
  !isBrowserDownloadCtaEligible({
    actionState: verified,
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: true,
    overlayBlocking: false,
    currentPageUrl: verified.pageUrl,
    hasDownloadableOptions: true,
  }),
  'BrowserFailure suppresses CTA',
);

assert(
  !isBrowserDownloadCtaEligible({
    actionState: verified,
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: true,
    currentPageUrl: verified.pageUrl,
    hasDownloadableOptions: true,
  }),
  'overlay/tab switcher suppresses CTA',
);

assert(
  !isBrowserDownloadCtaEligible({
    actionState: verified,
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: 'https://www.google.com/',
    hasDownloadableOptions: true,
  }),
  'stale navigation epoch / different page not eligible',
);

assert(
  !isBrowserDownloadCtaEligible({
    actionState: {
      ...verified,
      mediaUrl: 'https://cdn.example.com/seg.ts',
      analysis: makeAnalysis({ finalUrl: 'https://cdn.example.com/seg.ts', sourceUrl: 'https://cdn.example.com/seg.ts' }),
    },
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: verified.pageUrl,
    hasDownloadableOptions: true,
  }),
  '.ts candidate not eligible for CTA',
);

assert(
  !isBrowserDownloadCtaEligible({
    actionState: {
      ...verified,
      mediaUrl: 'blob:https://instagram.com/x',
      analysis: makeAnalysis({ finalUrl: 'blob:https://instagram.com/x', sourceUrl: 'blob:https://instagram.com/x' }),
    },
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: verified.pageUrl,
    hasDownloadableOptions: true,
  }),
  'blob-only candidate not eligible',
);

assert(
  !isBrowserDownloadCtaEligible({
    actionState: { ...verified, status: 'consumed', analysis: null, media: null, mediaUrl: null },
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: verified.pageUrl,
    hasDownloadableOptions: false,
  }),
  'consumed state not eligible',
);

// --- Full presentation shape ---
const igPresentation = buildBrowserDownloadPresentation({
  actionState: verified,
  activeTabId: 'tab-a',
  isHome: false,
  hasBrowserError: false,
  overlayBlocking: false,
  currentPageUrl: verified.pageUrl,
  hasDownloadableOptions: true,
});
assert(igPresentation.isEligible === true, 'IG reel presentation eligible');
assert(igPresentation.eyebrow === 'Video available', 'eyebrow Video available');
assert(igPresentation.title === 'Instagram Reel', 'title Instagram Reel');
assert(igPresentation.format === 'MP4', 'format MP4');
assert(igPresentation.sizeLabel != null && igPresentation.sizeLabel.includes('MB'), 'size present when known');
assert(igPresentation.qualityLabel === '1080p', 'quality 1080p');
assert(igPresentation.audioLabel === 'Audio Included', 'audio when codec known');
assert(igPresentation.buttonLabel === 'Video available', 'button Video available');
assert(igPresentation.metaLine === `${igPresentation.format} • ${igPresentation.sizeLabel} • ${igPresentation.qualityLabel}`, 'meta line joins known parts');
assert(!igPresentation.metaLine?.includes('undefined'), 'meta line has no undefined');
assert(!JSON.stringify(igPresentation).includes('cdn.example.com/video.mp4?'), 'presentation JSON omits query URL noise check');

const unknownMeta = buildBrowserDownloadPresentation({
  actionState: makeVerifiedState({
    analysis: makeAnalysis({
      fileSize: null,
      width: null,
      height: null,
      resolution: null,
      mimeType: 'video/mp4',
      container: 'mp4',
    }),
    media: makeMedia({ audioCodec: null, width: null, height: null, resolution: null }),
  }),
  activeTabId: 'tab-a',
  isHome: false,
  hasBrowserError: false,
  overlayBlocking: false,
  currentPageUrl: 'https://www.instagram.com/reel/abc123/',
  hasDownloadableOptions: true,
});
assert(unknownMeta.sizeLabel === null, 'unknown size omitted in presentation');
assert(unknownMeta.qualityLabel === null, 'unknown quality omitted in presentation');
assert(unknownMeta.audioLabel === null, 'unknown audio omitted in presentation');
assert(unknownMeta.metaLine === 'MP4', 'meta line is format-only when others unknown');
assert(unknownMeta.buttonLabel === 'Video available', 'button remains with partial metadata');

const tiktok = buildBrowserDownloadPresentation({
  actionState: makeVerifiedState({
    pageUrl: 'https://www.tiktok.com/@user/video/123',
    media: makeMedia({
      pageUrl: 'https://www.tiktok.com/@user/video/123',
      audioCodec: null,
      width: 720,
      height: 1280,
      resolution: '720x1280',
    }),
    analysis: makeAnalysis({
      platform: 'TIKTOK',
      fileSize: null,
      width: 720,
      height: 1280,
      resolution: '720x1280',
    }),
    mediaUrl: 'https://v16.tiktokcdn.com/video.mp4',
  }),
  activeTabId: 'tab-b',
  isHome: false,
  hasBrowserError: false,
  overlayBlocking: false,
  currentPageUrl: 'https://www.tiktok.com/@user/video/123',
  hasDownloadableOptions: true,
});
assert(tiktok.title === 'TikTok Video', 'TikTok presentation title');
assert(tiktok.sizeLabel === null, 'TikTok unknown size omitted');
assert(tiktok.qualityLabel === '720p', 'TikTok quality when known');
assert(tiktok.audioLabel === null, 'TikTok unknown audio omitted');

const preparing = buildBrowserDownloadPresentation({
  actionState: makeVerifiedState({ status: 'preparing' }),
  activeTabId: 'tab-a',
  isHome: false,
  hasBrowserError: false,
  overlayBlocking: false,
  currentPageUrl: verified.pageUrl,
  hasDownloadableOptions: true,
});
assert(preparing.buttonLabel === 'Preparing download…', 'preparing button label');
assert(preparing.buttonDisabled === true, 'preparing disables button');

console.log(`\nBrowser media CTA presentation: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
