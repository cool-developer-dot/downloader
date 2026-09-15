/**
 * Universal website video detection — production-function verifier.
 * Usage: npm run verify:universal-video-detection
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalizeObservedMediaUrl,
  classifyGeneralNetworkResource,
  nativeNetworkPrefilter,
  urlHasMediaQueryEvidence,
  urlHasPlaybackMediaEvidence,
  urlHasPlaybackPathEvidence,
} from '../src/media-detection/general-media';
import { describePlatformPage } from '../src/media-detection/platform';
import {
  isFragmentedDashManifest,
  parseDashManifest,
  parseProgressiveMediaUrl,
  selectDownloadableStandaloneDash,
} from '../src/media-detection/parsers';
import { isDownloadAffordable } from '../src/media-detection/ui/badges';
import { buildMediaDetectionInjectedScript } from '../src/media-detection/observers';
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
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function makeMedia(
  partial: Partial<DetectedMedia> & { id: string; url: string },
): DetectedMedia {
  return {
    sourceUrl: partial.url,
    finalUrl: partial.url,
    pageUrl: partial.pageUrl ?? 'https://news.example.com/watch/abc12x',
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
    websiteSource: 'news.example.com',
    detectionSource: 'native_network',
    sourceDetector: 'native_network',
    detectedAt: Date.now(),
    confidence: 0.7,
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

const PLAYBACK =
  'https://rr1---sn-abc.googlevideo.example/videoplayback?expire=1&itag=18&mime=video%2Fmp4&clen=5000&range=0-1234';

const STANDALONE_DASH = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="1" bandwidth="1200000" width="1280" height="720" codecs="avc1.4d401f,mp4a.40.2">
        <BaseURL>https://cdn.example.com/pack/movie_720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const FRAGMENTED_DASH = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="1" bandwidth="1200000" width="1280" height="720" codecs="avc1.4d401f">
        <SegmentTemplate media="chunk$Number$.m4s" initialization="init.mp4" startNumber="1"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

async function main(): Promise<void> {
await test('1. videoplayback path is playback evidence', () => {
  assert(urlHasPlaybackPathEvidence(PLAYBACK), 'path');
  assert(urlHasMediaQueryEvidence(PLAYBACK), 'query mime');
  assert(urlHasPlaybackMediaEvidence(PLAYBACK), 'combined');
});

await test('2. videoplayback is ingested as progressive', () => {
  const c = classifyGeneralNetworkResource({
    url: PLAYBACK,
    isForMainFrame: false,
  });
  assert(c.acceptForIngest && c.family === 'progressive', c.family);
  assert(
    nativeNetworkPrefilter({ url: PLAYBACK, isForMainFrame: false }).observe,
    'native observe',
  );
});

await test('3. byte-range query is stripped from playback URLs', () => {
  const next = canonicalizeObservedMediaUrl(PLAYBACK);
  assert(!/[?&]range=/.test(next), next);
  assert(next.includes('itag=18'), 'itag kept');
  assert(next.includes('expire=1'), 'expiry kept');
});

await test('4. arbitrary extensionless still rejected', () => {
  const c = classifyGeneralNetworkResource({
    url: 'https://cdn.example.com/static/app-shell',
    isForMainFrame: true,
  });
  assert(!c.acceptForIngest, 'ingested');
});

await test('5. generic JSON-LD / preload harvested without YouTube targeting', () => {
  const injected = buildMediaDetectionInjectedScript();
  assert(injected.includes('harvestJsonLd'), 'json-ld');
  assert(injected.includes('application/ld+json'), 'ld mime');
  assert(!injected.includes('ytInitialPlayerResponse'), 'no YouTube extractor');
  assert(injected.includes('harvestEmbeddedJsonUrls'), 'embedded json');
  assert(injected.includes('twitter:player:stream'), 'twitter stream');
  assert(injected.includes('og:video:secure_url'), 'og secure');
  assert(injected.includes('rel="preload"'), 'preload');
  assert(injected.includes('looksInstagramCdnMedia'), 'ig cdn');
  assert(injected.includes('looksTikTokCdnMedia'), 'tt cdn kept');
  assert(!injected.includes('Download'), 'no in-page CTA');
});

await test('6. Instagram /reels/{id} is a public content path', () => {
  const page = describePlatformPage('https://www.instagram.com/reels/DcmMB5FAKt6/');
  assert(page.kind === 'instagram' && page.isPublicContentPath, JSON.stringify(page));
  const feed = describePlatformPage('https://www.instagram.com/reels/');
  assert(feed.kind === 'instagram' && !feed.isPublicContentPath, 'feed root');
});

await test('7. generic watch/shorts paths are public content', () => {
  const watch = describePlatformPage('https://video.example.com/watch?v=abcdefghi');
  assert(watch.kind === 'generic' && watch.isPublicContentPath, 'watch');
  const shorts = describePlatformPage('https://video.example.com/shorts/abcdefghi');
  assert(shorts.isPublicContentPath, 'shorts');
  const home = describePlatformPage('https://news.example.com/');
  assert(!home.isPublicContentPath, 'home');
});

await test('8. muxed standalone DASH BaseURL is downloadable; fragmented is not', () => {
  assert(!isFragmentedDashManifest(STANDALONE_DASH), 'standalone not fragmented');
  const parsed = parseDashManifest(STANDALONE_DASH, 'https://cdn.example.com/pack.mpd');
  assert(parsed?.isValid === true, 'parsed');
  const files = selectDownloadableStandaloneDash(parsed!, STANDALONE_DASH);
  assert(files.length === 1, String(files.length));
  assert(files[0]?.baseUrl?.endsWith('movie_720.mp4'), files[0]?.baseUrl ?? '');

  assert(isFragmentedDashManifest(FRAGMENTED_DASH), 'fragmented');
  const frag = parseDashManifest(FRAGMENTED_DASH, 'https://cdn.example.com/frag.mpd');
  assert(selectDownloadableStandaloneDash(frag!, FRAGMENTED_DASH).length === 0, 'no files');
});

await test('9. unknown container with video MIME is affordable', () => {
  const media = makeMedia({
    id: 'u1',
    url: 'https://cdn.example.com/obj/xyz',
    container: 'unknown',
    mimeType: 'video/mp4',
    extension: null,
  });
  assert(isDownloadAffordable(media), 'video mime');
  const dash = makeMedia({
    id: 'd1',
    url: 'https://cdn.example.com/a.mpd',
    container: 'dash',
    streamType: 'DASH',
    category: 'stream',
  });
  assert(!isDownloadAffordable(dash), 'dash still blocked at affordance');
});

await test('10. extensionless playback parses as a candidate', () => {
  const candidate = parseProgressiveMediaUrl({
    url: PLAYBACK,
    pageUrl: 'https://watch.example.com/watch?v=abcde12345',
    mimeType: 'video/mp4',
    detectionSource: 'native_network',
    hasRange: true,
    isForMainFrame: false,
  });
  assert(candidate != null, 'candidate');
  assert(!/[?&]range=/.test(candidate!.url), candidate!.url);
});

await test('11. CTA auto-verify no longer requires downloadable-only', () => {
  const action = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
  assert(action.includes('shouldVerify'), 'shouldVerify');
  assert(action.includes("discovery.media.category === 'stream'"), 'stream verify');
});

await test('12. discovery falls back to HTTP candidates when ownership is empty', () => {
  const discovery = readSrc('src/media-detection/hooks/useMediaDiscovery.ts');
  assert(discovery.includes('http.find'), 'http fallback');
  assert(discovery.includes('usedGeneralCorrelation'), 'correlation still used');
});

await test('13. native bridge observes playback query + Instagram CDN', () => {
  const native = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt',
  );
  assert(native.includes('videoplayback'), 'playback path');
  assert(native.includes('queryLooksMedia'), 'query');
  assert(native.includes('instagramLooksMedia'), 'ig');
  assert(native.includes('tiktokLooksMedia'), 'tt kept');
  assert(native.includes('canonicalizeObservedUrl'), 'canonicalize');
  assert(native.includes('DASH_UNSUPPORTED') === false, 'native is not a downloader');
});

await test('14. fragmented DASH still named DASH_UNSUPPORTED (no mux)', () => {
  const reliability = readSrc(
    'src/media-detection/general-source/general-source-reliability.service.ts',
  );
  assert(reliability.includes('DASH_UNSUPPORTED'), 'kept');
  assert(reliability.includes('tryStandaloneDashAsProgressive'), 'standalone path');
  assert(!reliability.toLowerCase().includes('ffmpeg'), 'no ffmpeg');
});

await test('15. v/t51 Facebook-style object path is family media', () => {
  const url = 'https://cdn.example.net/v/t51.2885-15/12345678_n.mp4';
  const c = classifyGeneralNetworkResource({ url, isForMainFrame: false });
  assert(c.acceptForIngest, c.rejectionReason ?? c.family);
});

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n${passed} passed`);
}

void main();
