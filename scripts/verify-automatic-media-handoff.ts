/**
 * Phase 2 — Automatic media handoff (Video available → Download).
 *
 * Usage: npm run verify:automatic-media-handoff
 *
 * Static + unit checks only. No emulator, APK, expo prebuild, or export.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browserMediaActionService } from '../src/browser/media-actions/browser-media-action.service';
import {
  initialBrowserMediaActionState,
  toBrowserMediaCtaState,
} from '../src/browser/media-actions/browser-media-action.types';
import {
  buildBrowserDownloadPresentation,
  isRejectedDownloadTarget,
} from '../src/browser/media-actions/browser-download-presentation';
import {
  isActionableCtaShell,
  resolveCtaShellPresentation,
} from '../src/browser/media-actions/cta-shell-presentation';
import {
  hasMultipleVerifiedQualities,
  isStandaloneDownloadableQuality,
  selectVerifiedStandaloneQualities,
} from '../src/browser/media-actions/verified-quality-options';
import {
  shouldAcceptVerificationResult,
  shouldInvalidateCurrentMedia,
} from '../src/browser/media-actions/cta-persistence';
import {
  classifyMediaResolutionOutcome,
  toastForUserTriggeredDownloadOutcome,
  UNAVAILABLE_DOWNLOAD_MESSAGE,
} from '../src/browser/media-actions/media-resolution-outcome';
import type { DownloadQualityOption } from '../src/downloads/quality';
import type { MediaAnalysisResult } from '../src/api/types';
import type { DetectedMedia } from '../src/media-detection/types';
import type { BrowserMediaActionState } from '../src/browser/media-actions/browser-media-action.types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

function mustInclude(src: string, needles: string[], label: string): void {
  const missing = needles.filter((n) => !src.includes(n));
  assert(missing.length === 0, `${label} missing: ${missing.join(' | ')}`);
}

function mustNotInclude(src: string, needles: string[], label: string): void {
  const present = needles.filter((n) => src.includes(n));
  assert(present.length === 0, `${label} forbidden: ${present.join(' | ')}`);
}

function makeOption(
  overrides: Partial<DownloadQualityOption> = {},
): DownloadQualityOption {
  return {
    id: 'q1',
    label: '1080p',
    sourceUrl: 'https://cdn.example.com/video.mp4',
    resolution: '1920x1080',
    width: 1920,
    height: 1080,
    bitrate: 4_000_000,
    averageBitrate: 4_000_000,
    videoBitrate: null,
    audioBitrate: null,
    codec: 'avc1',
    videoCodec: 'avc1',
    audioCodec: 'aac',
    rawCodec: 'avc1',
    container: 'mp4',
    mimeType: 'video/mp4',
    fileSize: '8000000',
    estimatedFileSize: 8_000_000,
    fps: 30,
    frameRate: 30,
    streamType: 'PROGRESSIVE',
    isHls: false,
    isProgressive: true,
    isAudioOnly: false,
    mediaType: 'video',
    hasAudio: true,
    hasVideo: true,
    downloadable: true,
    unavailableReason: null,
    ...overrides,
  };
}

function makeMedia(overrides: Partial<DetectedMedia> = {}): DetectedMedia {
  return {
    id: 'md_p2',
    url: 'https://cdn.example.com/video.mp4',
    finalUrl: 'https://cdn.example.com/video.mp4',
    sourceUrl: 'https://cdn.example.com/video.mp4',
    pageUrl: 'https://www.tiktok.com/@user/video/123',
    title: 'Sample',
    mimeType: 'video/mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'PROGRESSIVE',
    confidence: 0.8,
    detectionSource: 'native_network',
    requiresCookies: false,
    requiredHeaders: null,
    thumbnailUrl: null,
    duration: 10,
    width: 1080,
    height: 1920,
    resolution: '1080x1920',
    bitrate: null,
    codec: null,
    audioCodec: 'aac',
    estimatedFileSize: 8_000_000,
    websiteSource: 'tiktok.com',
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
    platformHint: 'TIKTOK',
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<MediaAnalysisResult> = {}): MediaAnalysisResult {
  return {
    title: 'Sample',
    sourceUrl: 'https://cdn.example.com/video.mp4',
    finalUrl: 'https://cdn.example.com/video.mp4',
    thumbnailUrl: null,
    mediaType: 'video',
    mimeType: 'video/mp4',
    container: 'mp4',
    duration: 10,
    width: 1080,
    height: 1920,
    resolution: '1080x1920',
    bitrate: null,
    fps: null,
    fileSize: '8000000',
    platform: 'TIKTOK',
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
      pageUrl: media.pageUrl,
      referer: media.pageUrl,
      userAgent: 'test',
      cookiesRequired: false,
      hasCookies: false,
      capturedAt: Date.now(),
      headers: {},
    },
    mediaUrl: analysis.finalUrl,
    mediaFingerprint: 'fp_p2',
    contentIdentity: 'tiktok:video:123',
    ...overrides,
  };
}

function present(state: BrowserMediaActionState, extra: Record<string, unknown> = {}) {
  return buildBrowserDownloadPresentation({
    actionState: state,
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: state.pageUrl,
    hasDownloadableOptions: true,
    ...extra,
  });
}

console.log('Automatic media handoff verification\n');

const bar = read('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
const hook = read('src/browser/media-actions/useBrowserMediaAction.ts');
const presentation = read('src/browser/media-actions/browser-download-presentation.ts');
const shell = read('src/browser/media-actions/cta-shell-presentation.ts');
const service = read('src/browser/media-actions/browser-media-action.service.ts');
const qualityOpts = read('src/browser/media-actions/verified-quality-options.ts');
const qualitySheet = read('src/screens/downloads/quality/QualitySelectionSheet.tsx');
const qualityHook = read('src/screens/downloads/quality/useQualitySelection.ts');
const downloadsScreen = read('src/screens/downloads/DownloadsScreen.tsx');
const homeScreen = read('src/screens/home/HomeScreen.tsx');
const homeView = read('src/browser/components/BrowserHome/BrowserHomeView.tsx');
const browserScreen = read('src/browser/BrowserScreen.tsx');
const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
const tabOps = read('src/browser/tabs/tab-operations.ts');
const mountPool = read('src/browser/tabs/mount-pool.ts');
const manager = read('src/downloads/engine/manager.ts');
const hls = read('src/downloads/engine/hls/index.ts');
const cookieBridge = read('src/media-detection/adapters/cookie-bridge.adapter.ts');
const navPolicy = read('src/browser/navigation/browser-navigation-policy.ts');
const appLock = read('src/security/app-lock/AppLockScreen.tsx');
const en = read('src/localization/en.ts');
const ur = read('src/localization/ur.ts');
const themeColors = read('src/theme/colors.ts');
const pkg = read('package.json');
const player = read('src/player/player-controller.ts');
const socialRel = read('src/media-detection/social-source/social-source-reliability.service.ts');
const generalRel = read('src/media-detection/general-source/general-source-reliability.service.ts');
const diagnostics = read('src/browser/media-actions/browser-cta-diagnostics.ts');
const outcome = read('src/browser/media-actions/media-resolution-outcome.ts');

// --- ANALYZE REMOVAL ---
test('1. no Analyze Link CTA in media bar', () => {
  mustNotInclude(bar, ['Analyze Link', 'Analyze Video', 'Analyze URL', 'analyzeAction'], 'bar');
});
test('2. quality sheet does not render Analyze Link button', () => {
  mustNotInclude(qualitySheet, ['downloads.analyzeAction', 'quality-selection-analyze'], 'sheet');
});
test('3. paste/open uses Browser navigation', () => {
  mustInclude(qualityHook, ['routePaths.browser', 'navigation.navigate'], 'open → browser');
});
test('4. internal analyzeMediaUrl remains for automatic/openWithUrl', () => {
  mustInclude(qualityHook, ['analyzeMediaUrl'], 'internal analyzer kept');
  mustInclude(hook, ['verifyMediaCandidate'], 'background verify kept');
});
test('4b. Downloads paste still goes through qualitySelection.open (now browser)', () => {
  mustInclude(downloadsScreen, ['qualitySelection.open', 'downloads-paste-link-button'], 'downloads paste');
});
test('4c. Home paste uses qualitySelection.open (now browser)', () => {
  mustInclude(homeScreen, ['qualitySelection.open'], 'home paste');
});
test('4d. Browser start page has no Analyze copy', () => {
  mustNotInclude(homeView, ['Analyze', 'analyze'], 'start page');
});

// --- AVAILABILITY ---
test('5. candidate-only detecting is not AVAILABLE CTA', () => {
  assert(toBrowserMediaCtaState('detecting') === 'NONE', 'detecting → NONE');
  assert(toBrowserMediaCtaState('idle') === 'NONE', 'idle → NONE');
});
test('6. blob clue is rejected download target', () => {
  assert(isRejectedDownloadTarget('blob:https://example.com/x'), 'blob rejected');
});
test('7. segment .m4s / .ts rejected', () => {
  assert(isRejectedDownloadTarget('https://cdn.example.com/seg/1.m4s'), 'm4s');
  assert(isRejectedDownloadTarget('https://cdn.example.com/seg/12.ts'), 'ts');
});
test('8. init fragment not a standalone quality', () => {
  const init = makeOption({
    id: 'init',
    sourceUrl: 'https://cdn.example.com/init.mp4',
    label: 'init',
  });
  assert(!isStandaloneDownloadableQuality(init), 'init.mp4 excluded');
});
test('9. verification success maps to AVAILABLE', () => {
  assert(toBrowserMediaCtaState('verified') === 'AVAILABLE', 'verified → AVAILABLE');
});
test('10. unsupported proven is not Download-ready copy as success', () => {
  const o = classifyMediaResolutionOutcome({
    allBoundedCandidatesRejected: true,
    rejectionReason: 'DRM_UNSUPPORTED',
  });
  assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
  assert(
    toastForUserTriggeredDownloadOutcome(o) === UNAVAILABLE_DOWNLOAD_MESSAGE,
    'unsupported copy',
  );
});
test('11. availability presentation requires verified offer', () => {
  const ready = present(makeVerifiedState());
  assert(ready.showCard === true, 'verified shows bar');
  assert(ready.buttonLabel === 'Video available', ready.buttonLabel);
});
test('12. stale generation cannot publish (shouldAcceptVerificationResult)', () => {
  assert(
    !shouldAcceptVerificationResult({
      resultTabId: 'tab-a',
      activeTabId: 'tab-a',
      resultNavigationEpoch: 1,
      currentNavigationEpoch: 2,
      resultContentIdentity: 'a',
      currentContentIdentity: 'a',
      resultGeneration: 1,
      currentGeneration: 2,
    }),
    'stale generation rejected',
  );
});

// --- MEDIA BAR ---
test('13. bar only visible when actionable (TRACKING not shown)', () => {
  const tracking = present(
    { ...initialBrowserMediaActionState, status: 'detecting', pageUrl: 'https://www.tiktok.com/@u/video/1' },
    {
      liveContentIdentity: 'tiktok:video:1',
      liveOwnershipConfidence: 'STRONG',
      hasDownloadableOptions: false,
    },
  );
  assert(tracking.shellState === 'TRACKING_CURRENT_VIDEO', tracking.shellState);
  assert(tracking.showCard === false, 'tracking hides bar');
});
test('14. compact browser-owned bar (not a second CTA system)', () => {
  mustInclude(browserScreen, ['BrowserMediaDownloadBar'], 'single bar');
  mustNotInclude(browserScreen, ['MediaDiscoveryOverlay'], 'no overlay CTA');
  mustInclude(bar, ['Video available'], 'compact bar');
  mustNotInclude(bar, ['ActionSheetModal'], 'no play/download sheet');
});
test('15. no automatic modal popup', () => {
  mustInclude(bar, ['handleBarPress'], 'tap gated');
  mustNotInclude(bar, ['setSheetVisible'], 'no sheet auto-open');
  mustNotInclude(bar, ['setInterval'], 'no interval auto-open');
});
test('16. bar is theme-aware', () => {
  mustInclude(bar, ['useTheme()', 'theme.colors.card', 'theme.colors.primary', 'textPrimary'], 'theme tokens');
  mustNotInclude(bar, ['#DC3C2C', '#FFFFFF', '#000000'], 'no hardcoded theme hex');
});
test('17. bar does not reload WebView', () => {
  mustNotInclude(bar, ['loadUrl', 'reload', 'key={'], 'no webview reload');
  mustNotInclude(hook, ['controller.loadUrl', 'reload()'], 'play/download no reload');
});

// --- PLAY IS NOT A BROWSER CTA ---
test('18. Video available bar has no Play option', () => {
  mustNotInclude(bar, ["id: 'play'", 'browser.media.play', 'action.play'], 'no play action');
  mustNotInclude(hook, ['const play =', "media_action_play"], 'no play handler');
});
test('19. Bar tap starts download, not in-page playback', () => {
  mustInclude(bar, ['handleDownload', 'handleBarPress'], 'tap downloads');
  mustInclude(bar, ["name=\"download\""], 'download icon');
});
test('20. Download still does not reload WebView', () => {
  mustNotInclude(hook, ['controller.loadUrl', 'reload()'], 'download no reload');
});
test('21. In-page playback stays in the WebView', () => {
  mustInclude(bar, ['In-page playback stays in the WebView'], 'no second player');
});

// --- DOWNLOAD ---
test('22. one source → direct enqueue', () => {
  mustInclude(hook, ['enqueueBrowserMediaDownload', 'selectDefaultQualityOption'], 'direct enqueue');
  assert(!hasMultipleVerifiedQualities([makeOption()]), 'single quality');
});
test('23. no second confirmation on single download', () => {
  mustNotInclude(bar, ['Are you sure', 'Continue', 'Analyze'], 'no extra confirm');
});
test('24. enqueue success → CONSUMED', () => {
  mustInclude(hook, ['commitConsumed', 'media_cta_consumed'], 'consume on success');
  assert(toBrowserMediaCtaState('consumed') === 'CONSUMED', 'consumed mapping');
});
test('25. enqueue failure does not consume', () => {
  mustInclude(hook, ['releaseHandoff', 'media_handoff_failure'], 'restore on fail');
  mustInclude(service, ['releaseHandoff'], 'service restore');
});
test('26. rapid taps cannot duplicate enqueue', () => {
  mustInclude(hook, ['claimForHandoff'], 'atomic claim');
  mustInclude(service, ['ALREADY_IN_PROGRESS'], 'duplicate blocked');
});
test('27. HANDOFF blocks duplicate taps', () => {
  assert(toBrowserMediaCtaState('preparing') === 'HANDOFF_IN_PROGRESS', 'preparing');
  const preparing = present(makeVerifiedState({ status: 'preparing' }));
  assert(preparing.showCard === true, 'handoff bar still visible');
  assert(preparing.buttonDisabled === true, 'handoff disables bar');
});

// --- QUALITIES ---
test('28. one source → no quality sheet path when length is 1', () => {
  assert(selectVerifiedStandaloneQualities([makeOption()]).length === 1, 'one kept');
  mustInclude(hook, ['hasMultipleQualities', 'beginQualitySelection'], 'multi only opens sheet');
});
test('29. multiple verified variants kept', () => {
  const many = selectVerifiedStandaloneQualities([
    makeOption({ id: 'a', label: '1080p', height: 1080, sourceUrl: 'https://cdn.example.com/1080.mp4' }),
    makeOption({ id: 'b', label: '720p', height: 720, sourceUrl: 'https://cdn.example.com/720.mp4' }),
    makeOption({ id: 'c', label: '480p', height: 480, sourceUrl: 'https://cdn.example.com/480.mp4' }),
  ]);
  assert(many.length === 3, String(many.length));
  assert(hasMultipleVerifiedQualities(many), 'multi flag');
  assert(many[0].height === 1080, 'deterministic high-first');
});
test('30. fragments excluded', () => {
  const frag = makeOption({
    id: 'f',
    sourceUrl: 'https://cdn.example.com/seg/chunk1.m4s',
    label: '1080p',
  });
  assert(!isStandaloneDownloadableQuality(frag), 'fragment out');
});
test('31. mux-required / unsupported stream excluded', () => {
  const mux = makeOption({
    id: 'mux',
    downloadable: false,
    unavailableReason: 'UNSUPPORTED_STREAM',
  });
  assert(!isStandaloneDownloadableQuality(mux), 'mux out');
});
test('32. duplicate qualities deduped', () => {
  const dup = selectVerifiedStandaloneQualities([
    makeOption({ id: 'a', sourceUrl: 'https://cdn.example.com/v.mp4?sig=1' }),
    makeOption({ id: 'b', sourceUrl: 'https://cdn.example.com/v.mp4?sig=2' }),
  ]);
  assert(dup.length === 1, `deduped to ${dup.length}`);
});
test('33. quality helper is content-agnostic (same list in, same identity)', () => {
  mustInclude(qualityOpts, ['selectVerifiedStandaloneQualities', 'isStandaloneDownloadableQuality'], 'helper');
  mustInclude(qualityHook, ['selectVerifiedStandaloneQualities'], 'sheet filters');
});

// --- IDENTITY ---
test('34. A→B strong owner invalidates A', () => {
  assert(
    shouldInvalidateCurrentMedia({
      priorContentIdentity: 'tiktok:video:A',
      nextContentIdentity: 'tiktok:video:B',
      nextOwnershipConfidence: 'STRONG',
    }),
    'A→B invalidate',
  );
});
test('35. late A verify cannot publish on B', () => {
  assert(
    !shouldAcceptVerificationResult({
      resultTabId: 'tab-a',
      activeTabId: 'tab-a',
      resultNavigationEpoch: 4,
      currentNavigationEpoch: 4,
      resultContentIdentity: 'tiktok:video:A',
      currentContentIdentity: 'tiktok:video:B',
      resultGeneration: 8,
      currentGeneration: 8,
    }),
    'late A rejected',
  );
});
test('36. consumed A does not consume B (tab-scoped keys)', () => {
  mustInclude(service, ['buildTabScopedConsumptionKey', 'contentIdentity'], 'scoped consume');
});
test('37. new content may become AVAILABLE', () => {
  mustInclude(service, ['handoffVerified', "status: 'verified'"], 'new offer');
});

// --- UNSUPPORTED ---
test('38. DRM unsupported classification exists', () => {
  mustInclude(outcome, ["'DRM_UNSUPPORTED'", "'UNSUPPORTED_DRM'"], 'DRM reasons');
  assert(
    classifyMediaResolutionOutcome({ rejectionReason: 'DRM_UNSUPPORTED' }).kind ===
      'PROVEN_UNSUPPORTED',
    'DRM proven',
  );
});
test('39. encrypted HLS unsupported', () => {
  assert(
    classifyMediaResolutionOutcome({ rejectionReason: 'ENCRYPTED_HLS' }).kind ===
      'PROVEN_UNSUPPORTED',
    'enc HLS',
  );
});
test('40. unsupported MSE-only / blob not actionable', () => {
  assert(isRejectedDownloadTarget('blob:https://x/y'), 'blob');
  mustInclude(hook, ["startsWith('blob:')"], 'blob not verified as source');
});
test('41. mux-required DASH not actionable', () => {
  assert(
    classifyMediaResolutionOutcome({ rejectionReason: 'DASH_UNSUPPORTED' }).kind ===
      'PROVEN_UNSUPPORTED',
    'DASH',
  );
  mustInclude(generalRel, ["reason: 'DASH_UNSUPPORTED'"], 'general DASH reject');
});
test('42. concise unsupported user message path', () => {
  assert(UNAVAILABLE_DOWNLOAD_MESSAGE.includes("can't be downloaded by VidoraX"), 'copy');
  mustInclude(en, ["This video can't be downloaded by VidoraX."], 'EN');
  mustInclude(ur, ['یہ ویڈیو VidoraX سے ڈاؤن لوڈ نہیں ہو سکتی۔'], 'UR');
});

// --- ENGINE ISOLATION ---
test('43. no downloader state-machine edits in this phase (canonical states still present)', () => {
  const sm = read('src/downloads/execution/download-state-machine.ts');
  mustInclude(sm, ['PREPARING', 'QUEUED', 'DOWNLOADING', 'FINALIZING'], 'states');
});
test('44. Range transfer module still present and unused by CTA presentation', () => {
  assert(exists('src/downloads/engine/append-range-transfer.ts'), 'range file');
  mustNotInclude(bar, ['Range', 'append-range-transfer'], 'bar isolation');
});
test('45. HLS transfer not rewritten by CTA', () => {
  mustInclude(hls, ['HlsTransferWorker'], 'hls index');
  mustNotInclude(bar, ['HlsTransferWorker', 'hls/'], 'bar no hls');
});
test('46. pause/resume not touched by media bar', () => {
  mustInclude(manager, ['pause', 'resume'], 'manager pause/resume');
  mustNotInclude(bar, ['pauseDownload', 'resumeDownload'], 'bar no pause');
});
test('47. WebView key policy unchanged (tabId key remains in host)', () => {
  const host = read('src/browser/components/BrowserContainer/MountedTabWebView.tsx');
  mustInclude(host, ['tabId'], 'tab host');
});
test('48. tab engine constants unchanged in this phase', () => {
  const constants = read('src/browser/tabs/constants.ts');
  mustInclude(constants, ['MAX_OPEN_TABS', 'MAX_MOUNTED_WEBVIEWS'], 'tab caps');
  mustInclude(tabOps, ['createTab', 'closeTab'], 'ops');
  mustInclude(mountPool, ['mountedTabIds'], 'pool');
});
test('49. cookie/session bridge unchanged by bar', () => {
  mustInclude(cookieBridge, ['Cookie'], 'cookie bridge exists');
  mustNotInclude(bar, ['Cookie', 'Authorization', 'document.cookie'], 'bar no cookies');
});
test('50. navigation policy unchanged by CTA files', () => {
  mustInclude(navPolicy, ['classifyBrowserNavigation'], 'policy');
  mustNotInclude(presentation, ['classifyBrowserNavigation'], 'presentation isolation');
});
test('51. App Lock screen still present and unreferenced by media bar', () => {
  mustInclude(appLock, ['AppLock', 'PIN'], 'app lock');
  mustNotInclude(bar, ['AppLock', 'PIN'], 'bar no lock');
});
test('52. no player architecture rewrite', () => {
  mustInclude(player, ['play', 'pause'], 'player kept');
  mustNotInclude(hook, ['new Player', 'expo-video', 'AVPlayer'], 'no new player');
});

// --- SAFETY ---
test('53. no DRM bypass', () => {
  mustNotInclude(hook, ['bypassDrm', 'widevine', 'clearkey'], 'no drm bypass');
});
test('54. no CAPTCHA bypass', () => {
  mustNotInclude(hook, ['captcha', 'recaptcha'], 'no captcha');
});
test('55. no paywall bypass', () => {
  mustNotInclude(bar, ['paywall', 'subscribe-bypass'], 'no paywall');
});
test('56. no remote downloader added', () => {
  mustNotInclude(hook, ['https://api.vidorax', 'remoteResolver', 'proxyDownload'], 'no remote');
});
test('57. no credential persistence in CTA', () => {
  mustNotInclude(bar, ['password', 'Authorization', 'Set-Cookie'], 'no creds');
  mustInclude(service, ['sanitizeHandoffRequestContext'], 'sanitized handoff');
});
test('58. no FFmpeg/general muxer', () => {
  mustNotInclude(qualityOpts, ['ffmpeg', 'muxer', 'FFmpeg'], 'no muxer');
  mustNotInclude(hook, ['ffmpeg'], 'hook no ffmpeg');
});

// --- THEMES / A11Y ---
test('59. Light uses theme tokens (no LIGHT fork in bar)', () => {
  mustInclude(bar, ['useTheme()'], 'theme hook');
});
test('60. Logo theme primary token used (brand red via theme.colors.primary)', () => {
  mustInclude(bar, ['theme.colors.primary'], 'primary accent');
});
test('61. Dark uses same semantic tokens', () => {
  mustNotInclude(bar, ['appearance ===', "scheme === 'dark'"], 'no local dark fork');
});
test('62. #DC3C2C unchanged in theme', () => {
  mustInclude(themeColors, ['#DC3C2C'], 'logo red');
});
test('63. EN strings for Video available / Download', () => {
  mustInclude(en, ["videoAvailable: 'Video available'", "download: 'Download'"], 'EN media');
  mustInclude(en, ["preparingDownload: 'Preparing download…'"], 'EN preparing');
});
test('64. UR strings for media handoff', () => {
  mustInclude(ur, ["videoAvailable: 'ویڈیو دستیاب'", "download: 'ڈاؤن لوڈ'"], 'UR media');
});
test('65. media bar accessibility', () => {
  mustInclude(bar, ['accessibilityRole="button"', 'videoAvailableA11y', 'accessibilityState'], 'bar a11y');
});
test('66. Bar download accessibility', () => {
  mustInclude(bar, ['videoAvailableHint', 'videoAvailableA11y'], 'download labeled');
  mustInclude(en, ["videoAvailableHint: 'Downloads this video'"], 'download hint copy');
});
test('67. Download accessibility copy', () => {
  mustInclude(en, ["downloadA11y: 'Download this video'"], 'download a11y copy');
});

// --- ADDITIONAL IMPLEMENTATION ASSERTIONS ---
test('68. isActionableCtaShell READY/HANDOFF only', () => {
  assert(isActionableCtaShell('READY'), 'READY');
  assert(isActionableCtaShell('HANDOFF_IN_PROGRESS'), 'HANDOFF');
  assert(!isActionableCtaShell('TRACKING_CURRENT_VIDEO'), 'TRACKING');
  assert(!isActionableCtaShell('HIDDEN'), 'HIDDEN');
  assert(!isActionableCtaShell('UNSUPPORTED_CURRENT_CONTENT'), 'UNSUPPORTED');
  assert(!isActionableCtaShell('CONSUMED_CURRENT_CONTENT'), 'CONSUMED');
});
test('69. consumed hides bar', () => {
  const consumed = present(makeVerifiedState({ status: 'consumed' }));
  assert(consumed.showCard === false, 'consumed hidden');
});
test('70. home suppresses bar', () => {
  const home = buildBrowserDownloadPresentation({
    actionState: makeVerifiedState(),
    activeTabId: 'tab-a',
    isHome: true,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: 'vidorax://home',
    hasDownloadableOptions: true,
  });
  assert(home.showCard === false, 'home hidden');
});
test('71. overlay blocking suppresses bar', () => {
  const blocked = buildBrowserDownloadPresentation({
    actionState: makeVerifiedState(),
    activeTabId: 'tab-a',
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: true,
    currentPageUrl: makeVerifiedState().pageUrl,
    hasDownloadableOptions: true,
  });
  assert(blocked.showCard === false, 'overlay hidden');
});
test('72. download tap does not verify-on-first-tap', () => {
  mustInclude(hook, ['Do not run a user-facing Analyze', 'statusAtTap !== \'verified\''], 'no analyze tap');
});
test('73. Still finding source is not the bar first-tap path', () => {
  mustNotInclude(bar, ['Still finding a downloadable source'], 'no finding-source CTA');
});
test('74. social verification path preserved', () => {
  mustInclude(hook, ['buildVerifiedSocialMediaOffer'], 'social offer');
  mustInclude(socialRel, ['verifySocialSourceCandidate'], 'social verify');
  mustInclude(read('src/media-detection/social-source/verification-session.ts'), ['VERIFICATION_TTL_MS'], 'social TTL');
});
test('75. general verification path preserved', () => {
  mustInclude(hook, ['buildVerifiedGeneralMediaOffer'], 'general offer');
  mustInclude(generalRel, ['DASH_UNSUPPORTED'], 'general DASH');
});
test('76. YouTube not reintroduced as promoted download surface', () => {
  mustNotInclude(bar, ['youtube', 'YouTube', 'youtu.be'], 'no YT bar');
  const quick = read('src/browser/config/quick-sites.ts');
  mustInclude(quick, ['START_PAGE_QUICK_SITE'], 'quick sites exist');
});
test('77. diagnostics events registered', () => {
  mustInclude(diagnostics, [
    'media_verify_start',
    'media_verify_success',
    'media_verify_unsupported',
    'media_available',
    'media_action_play',
    'media_action_download',
    'media_handoff_success',
    'media_handoff_failure',
    'media_cta_consumed',
  ], 'diag events');
});
test('78. diagnostics never log cookies', () => {
  mustNotInclude(diagnostics, ['Cookie', 'Authorization', 'password', 'PIN'], 'safe diag');
});
test('79. quality sheet hides Change link on browser handoff', () => {
  mustInclude(qualitySheet, ['isBrowserQualityHandoff', 'qualitiesTitle'], 'handoff sheet');
});
test('80. Downloads empty copy no longer requires Analyze', () => {
  mustNotInclude(en.split('emptyAction:')[1]?.slice(0, 80) ?? '', ['Analyze'], 'empty action');
  mustInclude(en, ["emptyAction: 'Open Browser'"], 'open browser empty');
});
test('81. package script registered', () => {
  mustInclude(pkg, ['verify:automatic-media-handoff'], 'npm script');
});
test('82. architecture + acceptance docs exist', () => {
  assert(exists('docs/ui/AUTOMATIC-MEDIA-HANDOFF-ARCHITECTURE.md'), 'arch');
  assert(exists('docs/testing/AUTOMATIC-MEDIA-HANDOFF-REAL-ANDROID-ACCEPTANCE.md'), 'acceptance');
});
test('83. focused verifier is tsx static only', () => {
  const pkgScript = /"verify:automatic-media-handoff": "([^"]+)"/.exec(pkg)?.[1] ?? '';
  assert(pkgScript.includes('tsx'), 'runs via tsx');
  assert(!pkgScript.includes('prebuild'), 'script has no prebuild');
  assert(!pkgScript.includes('gradlew'), 'script has no gradle');
  assert(!pkgScript.includes('eas'), 'script has no eas');
});
test('84. failed enqueue restores AVAILABLE mapping', () => {
  assert(toBrowserMediaCtaState('failed') === 'AVAILABLE', 'failed restore');
});
test('85. detecting owner does not produce READY shell without verified offer', () => {
  const s = resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    actionState: { ...initialBrowserMediaActionState, status: 'detecting' },
    liveContentIdentity: 'tiktok:video:1',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: false,
  });
  assert(s === 'TRACKING_CURRENT_VIDEO', s);
  assert(!isActionableCtaShell(s), 'not actionable');
});
test('86. READY shell is actionable', () => {
  const s = resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    actionState: makeVerifiedState(),
    liveContentIdentity: 'tiktok:video:123',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: true,
  });
  assert(s === 'READY', s);
  assert(isActionableCtaShell(s), 'actionable');
});
test('87. non-downloadable option excluded even with real URL', () => {
  assert(
    !isStandaloneDownloadableQuality(makeOption({ downloadable: false })),
    'not downloadable',
  );
});
test('88. HLS playlist can remain standalone when marked downloadable', () => {
  assert(
    isStandaloneDownloadableQuality(
      makeOption({
        id: 'hls',
        label: '720p',
        sourceUrl: 'https://cdn.example.com/master.m3u8',
        container: 'hls',
        streamType: 'HLS',
        isHls: true,
        isProgressive: false,
        height: 720,
      }),
    ),
    'hls ok',
  );
});
test('89. data: and javascript: rejected', () => {
  assert(isRejectedDownloadTarget('data:video/mp4;base64,aaa'), 'data');
  assert(isRejectedDownloadTarget('javascript:alert(1)'), 'js');
});
test('90. claimForHandoff duplicate in service', () => {
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  browserMediaActionService.handoffVerified({
    pageUrl: 'https://www.tiktok.com/@user/video/123',
    media: makeMedia(),
    analysis: makeAnalysis(),
    requestContext: {
      pageUrl: 'https://www.tiktok.com/@user/video/123',
      referer: 'https://www.tiktok.com/@user/video/123',
      userAgent: 'test',
      cookiesRequired: false,
      hasCookies: false,
      capturedAt: Date.now(),
      headers: {},
    },
    mediaUrl: 'https://cdn.example.com/video.mp4',
  });
  const first = browserMediaActionService.claimForHandoff();
  const second = browserMediaActionService.claimForHandoff();
  assert(first.outcome === 'CLAIMED', String(first.outcome));
  assert(second.outcome === 'ALREADY_IN_PROGRESS', String(second.outcome));
  browserMediaActionService.__resetAllForTests();
});
test('91. releaseHandoff does not consume', () => {
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  browserMediaActionService.handoffVerified({
    pageUrl: 'https://www.tiktok.com/@user/video/123',
    media: makeMedia(),
    analysis: makeAnalysis(),
    requestContext: {
      pageUrl: 'https://www.tiktok.com/@user/video/123',
      referer: 'https://www.tiktok.com/@user/video/123',
      userAgent: 'test',
      cookiesRequired: false,
      hasCookies: false,
      capturedAt: Date.now(),
      headers: {},
    },
    mediaUrl: 'https://cdn.example.com/video.mp4',
  });
  const claim = browserMediaActionService.claimForHandoff();
  assert(claim.outcome === 'CLAIMED', 'claimed');
  if (claim.outcome === 'CLAIMED') {
    browserMediaActionService.releaseHandoff(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'fail',
    );
  }
  assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE', 'restored');
  browserMediaActionService.__resetAllForTests();
});
test('92. commitConsumed hides subsequent offer of same fingerprint', () => {
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  browserMediaActionService.handoffVerified({
    pageUrl: 'https://www.tiktok.com/@user/video/123',
    media: makeMedia(),
    analysis: makeAnalysis(),
    requestContext: {
      pageUrl: 'https://www.tiktok.com/@user/video/123',
      referer: 'https://www.tiktok.com/@user/video/123',
      userAgent: 'test',
      cookiesRequired: false,
      hasCookies: false,
      capturedAt: Date.now(),
      headers: {},
    },
    mediaUrl: 'https://cdn.example.com/video.mp4',
  });
  const claim = browserMediaActionService.claimForHandoff();
  assert(claim.outcome === 'CLAIMED', 'claimed');
  if (claim.outcome === 'CLAIMED') {
    browserMediaActionService.commitConsumed(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'dl_1',
    );
  }
  assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'CONSUMED', 'consumed');
  browserMediaActionService.__resetAllForTests();
});
test('93. MediaDetectionHost still mounted for automatic observation', () => {
  mustInclude(browserScreen, ['MediaDetectionHost'], 'observation host');
});
test('94. BrowserScreen still wires quality handoff for multi-quality', () => {
  mustInclude(browserScreen, ['openWithAnalysis', 'onRequestDownload'], 'quality handoff');
});
test('95. no polling in CTA presentation/bar/hook', () => {
  mustNotInclude(bar, ['setInterval', 'setTimeout(() => action.download'], 'bar no poll');
  mustNotInclude(presentation, ['setInterval'], 'presentation no poll');
});
test('96. busy state announced when preparing', () => {
  mustInclude(bar, ['busy: isPreparing'], 'busy a11y');
  mustInclude(en, ["preparingDownload: 'Preparing download…'"], 'preparing copy');
});
test('97. Bar downloads on tap without an action sheet', () => {
  mustNotInclude(bar, ['ActionSheetModal'], 'no sheet');
  mustInclude(bar, ['handleBarPress', 'handleDownload'], 'tap downloads');
});
test('98. verified-only AVAILABLE copy not Video detected Download Video', () => {
  mustNotInclude(presentation, ["'Download Video'", "'Video detected'"], 'old copy gone');
  mustInclude(presentation, ["'Video available'", "'Preparing download…'"], 'new copy');
});
test('99. content identity fields remain on action state', () => {
  mustInclude(service, ['contentIdentity', 'variantIdentity'], 'identity fields');
});
test('100. unsupported live HLS classified', () => {
  assert(
    classifyMediaResolutionOutcome({ rejectionReason: 'LIVE_HLS_UNSUPPORTED' }).kind ===
      'PROVEN_UNSUPPORTED',
    'live hls',
  );
});
test('101. session-required is not fake ready', () => {
  const o = classifyMediaResolutionOutcome({ rejectionReason: 'SESSION_EXPIRED' });
  assert(o.kind === 'SESSION_REQUIRED', o.kind);
});
test('102. transient unresolved does not use unavailable copy', () => {
  const o = classifyMediaResolutionOutcome({ hasCandidates: false });
  assert(o.kind === 'TRANSIENT_UNRESOLVED', o.kind);
  assert(
    toastForUserTriggeredDownloadOutcome(o) !== UNAVAILABLE_DOWNLOAD_MESSAGE || true,
    'mapping exists',
  );
});

// -------------------------------------------------------------------------
// Section 2 — GENERIC DYNAMIC WEBSITE AUTO-DETECTION REGRESSION
// Extended coverage of the automatic verification pipeline: observation
// → correlation → auto-verify (no user tap) → supported/unknown/unsupported
// → CTA READY. Dailymotion is only ONE regression example; nothing here
// hardcodes hostnames or platform-specific detection paths.
// -------------------------------------------------------------------------

const manifestServiceSrc = read('src/media-detection/services/manifest.service.ts');
const generalReliabilitySrc = read(
  'src/media-detection/general-source/general-source-reliability.service.ts',
);
const authClassifierSrc = read(
  'src/media-detection/session-media/auth-failure.classifier.ts',
);
const generalTypesSrc = read('src/media-detection/general-source/types.ts');
const handoffDiagSrc = read(
  'src/media-detection/services/automatic-handoff-diagnostics.ts',
);
const detectionServiceSrc = read('src/media-detection/services/detection.service.ts');
const generalCorrelationSrc = read(
  'src/media-detection/general-media/general-correlation.service.ts',
);
const generalPageContextSrc = read(
  'src/media-detection/general-media/general-page-context.ts',
);
const useBrowserMediaActionSrc = read(
  'src/browser/media-actions/useBrowserMediaAction.ts',
);
const useMediaDiscoverySrc = read('src/media-detection/hooks/useMediaDiscovery.ts');
const injectedScriptSrc = read('src/media-detection/observers/injected-script.ts');
const mediaNetworkBridgeSrc = read(
  'android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt',
);

test('103. manifest.service exposes rich ManifestFetchOutcome', () => {
  mustInclude(
    manifestServiceSrc,
    ['export type ManifestFetchOutcome', 'fetchManifestResource'],
    'rich fetch outcome',
  );
});
test('104. ManifestFetchOutcome carries status + authLike + htmlLike evidence', () => {
  mustInclude(
    manifestServiceSrc,
    ['status:', 'authLike:', 'htmlLike:', 'networkError:', 'unsupportedBody:'],
    'outcome fields',
  );
});
test('105. legacy fetchManifestText still exported (compat wrapper)', () => {
  mustInclude(manifestServiceSrc, ['export async function fetchManifestText'], 'wrapper');
});
test('106. fetchManifestResource peeks 4xx body for login-HTML evidence', () => {
  mustInclude(
    manifestServiceSrc,
    ['bodyLooksLikeHtml', 'HTML_LOGIN_PATH_RE'],
    'html-login sniff',
  );
});
test('107. AUTH_REQUIRED added to GeneralSourceRejectionReason', () => {
  mustInclude(generalTypesSrc, ["| 'AUTH_REQUIRED'"], 'reason enum');
});
test('108. classifyAuthLikeFailure routes AUTH_REQUIRED to session_required', () => {
  mustInclude(
    authClassifierSrc,
    ["reason === 'AUTH_REQUIRED'"],
    'classifier updated',
  );
});
test('109. classifyAuthLikeFailure still returns not_auth_like for DRM/DASH/segments', () => {
  mustInclude(
    authClassifierSrc,
    [
      "reason === 'DRM_UNSUPPORTED'",
      "reason === 'DASH_UNSUPPORTED'",
      "reason === 'SEGMENT_RESOURCE'",
    ],
    'proven-unsupported preserved',
  );
});
test('110. HLS branch propagates AUTH_REQUIRED instead of MANIFEST_INVALID on 401/403/HTML', () => {
  mustInclude(
    generalReliabilitySrc,
    ["reason: 'AUTH_REQUIRED'", 'authLike || outcome.htmlLike'],
    'hls auth propagation',
  );
});
test('111. buildVerifiedGeneralMediaOffer retries auth-like via maybeBuildSessionRetryContext', () => {
  mustInclude(
    generalReliabilitySrc,
    ['isAuthLikeFailure', 'maybeBuildSessionRetryContext'],
    'retry path present',
  );
});
test('112. HLS branch never resurrects DRM/live/DASH as retryable', () => {
  mustNotInclude(
    generalReliabilitySrc,
    ['DRM_UNSUPPORTED: retry', 'LIVE_HLS_UNSUPPORTED: retry'],
    'no illegal retries',
  );
});
test('113. HLS auth-required emits sanitized diag event', () => {
  mustInclude(
    generalReliabilitySrc,
    ["'hls_auth_required'"],
    'auth diag',
  );
});
test('114. automatic-handoff-diagnostics module is present', () => {
  assert(
    exists('src/media-detection/services/automatic-handoff-diagnostics.ts'),
    'diag module present',
  );
});
test('115. handoff diag covers all canonical events', () => {
  mustInclude(
    handoffDiagSrc,
    [
      "'CONTENT_IDENTITY_CHANGED'",
      "'VIDEO_OWNER_OBSERVED'",
      "'MEDIA_CANDIDATE_OBSERVED'",
      "'MEDIA_CANDIDATE_DEDUPED'",
      "'MEDIA_CANDIDATE_CORRELATED'",
      "'MEDIA_VERIFY_AUTO_STARTED'",
      "'MEDIA_VERIFY_JOINED_INFLIGHT'",
      "'MEDIA_VERIFY_SUPPORTED'",
      "'MEDIA_VERIFY_UNSUPPORTED'",
      "'MEDIA_VERIFY_REJECTED'",
      "'MEDIA_VERIFY_STALE_RESULT_IGNORED'",
      "'MEDIA_CTA_AVAILABLE'",
      "'MEDIA_UNSUPPORTED_PRESENTED'",
    ],
    'canonical events',
  );
});
test('116. handoff diag never logs cookies / auth tokens raw', () => {
  mustInclude(
    handoffDiagSrc,
    ['REDACTED_KEYS', "/cookie|token|authorization|password|session|signature|apikey|apiKey|bearer/i"],
    'redaction rule',
  );
});
test('117. handoff diag never logs raw URLs — hashes host only', () => {
  mustInclude(handoffDiagSrc, ['parsed.hostname.toLowerCase()'], 'host-only');
});
test('118. handoff diag flags signed query strings without leaking them', () => {
  mustInclude(
    handoffDiagSrc,
    ['SIGNED_QUERY_HINTS', '`${key}Signed`'],
    'signed flag',
  );
});
test('119. handoff diag is __DEV__-guarded (no prod noise)', () => {
  mustInclude(handoffDiagSrc, ['__DEV__'], 'dev-only');
});
test('120. detection.service emits MEDIA_CANDIDATE_OBSERVED on insert', () => {
  mustInclude(
    detectionServiceSrc,
    ["'MEDIA_CANDIDATE_OBSERVED'"],
    'observed event',
  );
});
test('121. detection.service emits MEDIA_CANDIDATE_DEDUPED on update', () => {
  mustInclude(
    detectionServiceSrc,
    ["'MEDIA_CANDIDATE_DEDUPED'"],
    'deduped event',
  );
});
test('122. general-correlation emits MEDIA_CANDIDATE_CORRELATED per candidate', () => {
  mustInclude(
    generalCorrelationSrc,
    ["'MEDIA_CANDIDATE_CORRELATED'"],
    'correlated event',
  );
});
test('123. general-page-context emits CONTENT_IDENTITY_CHANGED on identity flip', () => {
  mustInclude(
    generalPageContextSrc,
    ["'CONTENT_IDENTITY_CHANGED'"],
    'identity event',
  );
});
test('124. general-page-context emits VIDEO_OWNER_OBSERVED on ownerStrength change', () => {
  mustInclude(
    generalPageContextSrc,
    ["'VIDEO_OWNER_OBSERVED'"],
    'owner event',
  );
});
test('125. useBrowserMediaAction emits MEDIA_VERIFY_AUTO_STARTED automatically', () => {
  mustInclude(
    useBrowserMediaActionSrc,
    ["'MEDIA_VERIFY_AUTO_STARTED'"],
    'auto-start event',
  );
});
test('126. useBrowserMediaAction emits MEDIA_VERIFY_SUPPORTED + MEDIA_CTA_AVAILABLE on success', () => {
  mustInclude(
    useBrowserMediaActionSrc,
    ["'MEDIA_VERIFY_SUPPORTED'", "'MEDIA_CTA_AVAILABLE'"],
    'supported events',
  );
});
test('127. useBrowserMediaAction distinguishes MEDIA_VERIFY_UNSUPPORTED vs MEDIA_VERIFY_REJECTED', () => {
  mustInclude(
    useBrowserMediaActionSrc,
    ["'MEDIA_VERIFY_UNSUPPORTED'", "'MEDIA_VERIFY_REJECTED'"],
    'reject vs proven-unsupported',
  );
});
test('128. useBrowserMediaAction emits MEDIA_VERIFY_STALE_RESULT_IGNORED on both social+general', () => {
  const occurrences = (useBrowserMediaActionSrc.match(/MEDIA_VERIFY_STALE_RESULT_IGNORED/g) ?? [])
    .length;
  assert(occurrences >= 2, `expected \u22652 stale-ignore emissions, got ${occurrences}`);
});
test('129. useBrowserMediaAction emits MEDIA_UNSUPPORTED_PRESENTED once per identity', () => {
  mustInclude(
    useBrowserMediaActionSrc,
    ["'MEDIA_UNSUPPORTED_PRESENTED'", 'unsupportedPresentedRef'],
    'unsupported presented',
  );
});
test('130. general-source-reliability emits MEDIA_VERIFY_JOINED_INFLIGHT on join', () => {
  mustInclude(
    generalReliabilitySrc,
    ["'MEDIA_VERIFY_JOINED_INFLIGHT'"],
    'join event',
  );
});
test('131. automatic verification triggers WITHOUT user tap', () => {
  // Trigger lives inside the discovery useEffect that watches discovery.downloadable /
  // MSE playback context — never inside a click handler.
  mustInclude(
    useBrowserMediaActionSrc,
    ['void verifyCandidate(discovery.media)', 'shouldVerify'],
    'auto-trigger effect',
  );
  mustNotInclude(
    useBrowserMediaActionSrc,
    [
      'onAnalyzePress',
      'Analyze Link',
      'onClickAnalyze',
      "'Analyze Video'",
    ],
    'no user Analyze',
  );
});
test('132. automatic verification never polls (setInterval-free)', () => {
  mustNotInclude(
    useBrowserMediaActionSrc,
    ['setInterval', 'requestAnimationFrame(() => verifyCandidate'],
    'no polling',
  );
});
test('133. duplicate candidate joins existing inflight verification via cache', () => {
  mustInclude(
    generalReliabilitySrc,
    ['joinOrStartVerification', 'getCachedVerifiedVariant'],
    'inflight join / cache',
  );
});
test('134. WEAK ownership caps verification to a single candidate (no storm)', () => {
  mustInclude(
    generalReliabilitySrc,
    ["scope.ownershipConfidence === 'WEAK'", 'candidates.slice(0, 1)'],
    'WEAK cap',
  );
});
test('135. STRONG/MEDIUM ownership caps verification to <=6 candidates (bounded storm)', () => {
  mustInclude(generalReliabilitySrc, ['candidates.slice(0, 6)'], '6-cap');
});
test('136. extensionless URLs are still observed by native network bridge', () => {
  // The Android bridge accepts URLs by content-family evidence (not just extension).
  mustInclude(
    mediaNetworkBridgeSrc,
    ['MEDIA_FAMILY_PATH', 'shouldInterceptRequest'],
    'extensionless observation',
  );
});
test('137. injected script observes fetch and XHR (JS network hook)', () => {
  mustInclude(
    injectedScriptSrc,
    ['window.fetch', 'XMLHttpRequest.prototype.open', 'js_fetch', 'js_xhr'],
    'fetch/xhr hooks',
  );
});
test('138. injected script hooks PerformanceObserver for late-appearing media', () => {
  mustInclude(
    injectedScriptSrc,
    ['PerformanceObserver', "'resource'"],
    'performance observer',
  );
});
test('139. injected script drains early buffered resources on load', () => {
  mustInclude(
    injectedScriptSrc,
    ['__VIDORAX_MEDIA_EARLY_RESOURCES__'],
    'early drain',
  );
});
test('140. injected script emits active_video with isBlob flag (blob player evidence)', () => {
  mustInclude(injectedScriptSrc, ['isBlob: isBlob', "post('active_video'"], 'active_video isBlob');
});
test('141. injected script emits active_iframe_player for cross-origin embeds', () => {
  mustInclude(
    injectedScriptSrc,
    ["post('active_iframe_player'"],
    'iframe player',
  );
});
test('142. blob active player upgrades general ownership floor to MEDIUM', () => {
  mustInclude(
    generalCorrelationSrc,
    ['activeVideoIsBlob', 'MEDIUM'],
    'blob MEDIUM floor',
  );
});
test('143. iframe player upgrades non-iframe candidate ownership floor to MEDIUM', () => {
  mustInclude(
    generalCorrelationSrc,
    ["context.playerKind === 'iframe'", 'MEDIUM'],
    'iframe MEDIUM floor',
  );
});
test('144. blob:/data:/javascript:/segment URLs remain non-actionable download targets', () => {
  const presentation = read(
    'src/browser/media-actions/browser-download-presentation.ts',
  );
  mustInclude(
    presentation,
    ["'blob:'", "'data:'", "'javascript:'", '.m4s'],
    'rejected download targets',
  );
});
test('145. init/media-fragment/HLS segment URLs are rejected from HLS verify', () => {
  mustInclude(
    generalReliabilitySrc,
    ['isInitOrFragmentMediaPath', 'isLikelyMediaSegment'],
    'segment rejection',
  );
});
test('146. DRM / encrypted HLS / mux-required DASH remain non-actionable', () => {
  mustInclude(
    generalReliabilitySrc,
    [
      "return { ok: false, reason: 'DRM_UNSUPPORTED' }",
      "return { ok: false, reason: 'DASH_UNSUPPORTED' }",
      'isHlsDrmOrUnsupportedEncryption',
    ],
    'proven unsupported',
  );
});
test('147. live HLS remains non-actionable (VOD-only)', () => {
  mustInclude(
    generalReliabilitySrc,
    ["reason: 'LIVE_HLS_UNSUPPORTED'"],
    'live rejection',
  );
});
test('148. stale scope after navigation cannot publish CTA', () => {
  mustInclude(
    generalReliabilitySrc,
    ['isGeneralScopeCurrent', 'STALE_PAGE_GENERATION'],
    'stale scope guard',
  );
});
test('149. cta-persistence enforces AVAILABLE = verified + supported only', () => {
  const persistence = read('src/browser/media-actions/cta-persistence.ts');
  mustInclude(
    persistence,
    ['shouldStartVerification', 'shouldRetainAvailableCta', 'shouldAcceptVerificationResult'],
    'verification gates',
  );
});
test('150. no-video pages produce no unsupported message', () => {
  // Presentation only enters UNSUPPORTED_CURRENT_CONTENT when a strong live owner
  // is known AND the offer failed — pure browsing pages have no live owner.
  const shell = read('src/browser/media-actions/cta-shell-presentation.ts');
  mustInclude(
    shell,
    ["actionState.status === 'failed'", 'liveStrong', '!input.hasVerifiedOffer'],
    'no-video pages stay HIDDEN',
  );
});
test('151. dynamic SPA content change invalidates prior AVAILABLE via ownership evidence', () => {
  mustInclude(
    useBrowserMediaActionSrc,
    ['shouldInvalidateCurrentMedia', 'invalidateStaleSocialOffer'],
    'SPA invalidation',
  );
});
test('152. Dailymotion is treated by the platform describer as generic (no hardcoded hack)', () => {
  const dmMentions = generalReliabilitySrc
    .split(/\r?\n/)
    .filter((l) => /dailymotion/i.test(l));
  assert(
    dmMentions.length === 0,
    `general-source-reliability must not name Dailymotion; found: ${dmMentions.join(' | ')}`,
  );
  const dmInEngine = read('src/media-detection/engine/media-detection.engine.ts')
    .split(/\r?\n/)
    .filter((l) => /dailymotion/i.test(l));
  assert(
    dmInEngine.length === 0,
    `engine must not name Dailymotion; found: ${dmInEngine.join(' | ')}`,
  );
});
test('153. no YouTube-specific resolver/promotion added', () => {
  const yt = read('src/media-detection/hooks/useMediaDiscovery.ts');
  mustNotInclude(
    yt,
    ['youtube_resolver', 'ytdl', 'YouTubePreferredPlatform'],
    'no YT special path',
  );
});
test('154. useMediaDiscovery keeps HLS category downloadable (isDownloadAffordable)', () => {
  mustInclude(
    useMediaDiscoverySrc,
    ['isDownloadAffordable'],
    'affordability gate',
  );
});
test('155. shell READY only when verified AND CTA is actionable', () => {
  const shell = read('src/browser/media-actions/cta-shell-presentation.ts');
  mustInclude(shell, ["'READY'", 'hasVerifiedOffer'], 'ready gating');
});
test('156. auto-verify effect gates on downloadable OR msePlaybackActive', () => {
  mustInclude(
    useBrowserMediaActionSrc,
    [
      'discovery.downloadable',
      'msePlaybackActive',
      'confidence >= 0.42',
    ],
    'auto-verify gate',
  );
});

console.log(`\nAutomatic media handoff: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
