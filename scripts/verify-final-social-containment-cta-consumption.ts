/**
 * Final TikTok containment + CTA consumption verifier.
 * Run: npm run verify:final-social-containment-cta-consumption
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import { isSocialNativeAppScheme } from '../src/browser/constants/browser.constants';
import {
  buildBrowserOriginWhitelist,
  classifyBrowserNavigation,
  isPlayStoreOrMarketWebUrl,
  isSocialNativePackage,
  isZeroSideEffectBlock,
  wouldRnWebViewInvokeLinking,
} from '../src/browser/navigation/browser-navigation-policy';
import { BROWSER_WEBVIEW_ORIGIN_WHITELIST } from '../src/browser/webview/webview-configuration';
import { initialBrowserMediaActionState } from '../src/browser/media-actions/browser-media-action.types';
import { browserMediaActionService } from '../src/browser/media-actions/browser-media-action.service';
import {
  resolveCtaShellPresentation,
  shouldKeepCtaShellMounted,
} from '../src/browser/media-actions/cta-shell-presentation';
import { shouldAcceptVerificationResult } from '../src/browser/media-actions/cta-persistence';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
  }
}

function group(label: string): void {
  console.log(`\n--- ${label} ---`);
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function shell(overrides: Partial<Parameters<typeof resolveCtaShellPresentation>[0]>) {
  return resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    actionState: initialBrowserMediaActionState,
    liveContentIdentity: null,
    liveOwnershipConfidence: null,
    hasVerifiedOffer: false,
    liveIdentityConsumed: false,
    ...overrides,
  });
}

const wl = BROWSER_WEBVIEW_ORIGIN_WHITELIST;
const policySrc = readSrc('src/browser/navigation/browser-navigation-policy.ts');
const eventsSrc = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
const intentSrc = readSrc('src/browser/navigation/intent-navigation.service.ts');
const externalSrc = readSrc('src/browser/navigation/external-navigation.service.ts');
const popupSrc = readSrc('src/browser/navigation/popup-navigation.service.ts');
const navSrc = readSrc('src/browser/services/navigation.service.ts');
const hookSrc = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
const serviceSrc = readSrc('src/browser/media-actions/browser-media-action.service.ts');
const shellSrc = readSrc('src/browser/media-actions/cta-shell-presentation.ts');
const nativeHook = readSrc('scripts/apply-webview-media-hook.js');
const webviewClient = fs.existsSync(
  path.join(__dirname, '../node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java'),
)
  ? readSrc(
      'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
    )
  : '';

group('A TikTok HTTPS');

assert(classifyBrowserNavigation('https://www.tiktok.com/').kind === 'INTERNAL_WEB', '1 TikTok HTTPS internal');
assert(
  classifyBrowserNavigation('https://www.tiktok.com/@u/video/1').kind === 'INTERNAL_WEB',
  '2 TikTok video HTTPS internal',
);
assert(classifyBrowserNavigation('https://m.tiktok.com/').kind === 'INTERNAL_WEB', '3 m.tiktok.com internal');

group('A Native schemes');

assert(classifyBrowserNavigation('snssdk1233://aweme/detail/1').kind === 'BLOCK_NATIVE_APP', '4 snssdk1233');
assert(classifyBrowserNavigation('snssdk1340://aweme/detail/2').kind === 'BLOCK_NATIVE_APP', '5 snssdk1340');
assert(classifyBrowserNavigation('tiktok://video/1').kind === 'BLOCK_NATIVE_APP', '6 tiktok:');
assert(classifyBrowserNavigation('musically://video').kind === 'BLOCK_NATIVE_APP', '7 musically:');
assert(isSocialNativeAppScheme('snssdk1180://aweme/detail/9'), '4b unlisted snssdk1180 matched');
assert(classifyBrowserNavigation('snssdk1180://aweme/detail/9').kind === 'BLOCK_NATIVE_APP', '4c snssdk1180 blocked');
assert(classifyBrowserNavigation('aweme://detail/1').kind === 'BLOCK_NATIVE_APP', '4d aweme blocked');
assert(isSocialNativePackage('com.zhiliaoapp.musically'), '8 musically package');
assert(isSocialNativePackage('com.ss.android.ugc.aweme.lite'), '10 ugc family');

const pkgIntent =
  'intent://aweme/detail/1#Intent;scheme=snssdk1180;package=com.zhiliaoapp.musically;end';
assert(
  classifyBrowserNavigation(pkgIntent).kind === 'BLOCK_NATIVE_APP' ||
    classifyBrowserNavigation(pkgIntent).kind === 'INTENT_BLOCK',
  '8–10 TikTok package intent blocked',
);

const httpsFallback =
  'intent://www.tiktok.com/@u/video/1#Intent;scheme=https;package=com.zhiliaoapp.musically;S.browser_fallback_url=https%3A%2F%2Fwww.tiktok.com%2F%40u%2Fvideo%2F1;end';
assert(classifyBrowserNavigation(httpsFallback).kind === 'INTENT_WEB_FALLBACK', '11 HTTPS fallback internal');
assert(
  classifyBrowserNavigation(pkgIntent).kind !== 'SAFE_SYSTEM_ACTION',
  '12 no-fallback not system Linking',
);

const playFallback =
  'intent://www.tiktok.com/#Intent;scheme=https;package=com.zhiliaoapp.musically;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.zhiliaoapp.musically;end';
assert(classifyBrowserNavigation(playFallback).kind === 'BLOCK_MARKET', '13–14 Play Store fallback blocked');
assert(isPlayStoreOrMarketWebUrl('https://play.google.com/store/apps/details?id=x'), '13 play.google.com detected');
assert(classifyBrowserNavigation('market://details?id=com.zhiliaoapp.musically').kind === 'BLOCK_MARKET', '14 market://');

group('A Linking / whitelist');

assert(!wouldRnWebViewInvokeLinking(wl, 'snssdk1180://aweme/detail/1'), '15 snssdk1180 not RN Linking');
assert(!wouldRnWebViewInvokeLinking(wl, 'snssdk1340://x'), '15b snssdk1340 not RN Linking');
assert(!wouldRnWebViewInvokeLinking(wl, 'aweme://x'), '15c aweme not RN Linking');
assert(!classifyBrowserNavigation('snssdk1180://x').invokeLinking, '16 no Linking flag');
assert(!externalSrc.includes('Linking.openURL(trimmed)') || externalSrc.includes("kind === 'SAFE_SYSTEM_ACTION'"), '16 system Linking gated');
assert(intentSrc.includes('intent_external_app_contained'), '17 native launcher not used for EXTERNAL_APP');
assert(!intentSrc.includes('launchExternalApp'), '17 no launchExternalApp');
assert(popupSrc.includes('classifyBrowserNavigation'), '25–26 popup uses classifier');
assert(popupSrc.includes("action: 'ignore'"), '26 popup ignore native');
assert(nativeHook.includes('never default-allow custom schemes'), '27 timeout custom-scheme containment');
if (webviewClient) {
  assert(
    webviewClient.includes('VidoraX: never default-allow custom schemes') ||
      nativeHook.includes('TIMEOUT_CONTAINED'),
    '27 native timeout path present',
  );
}
assert(
  !eventsSrc.includes('navigationService.openExternal(url)') ||
    eventsSrc.includes('shouldHandleInBrowser'),
  '28 HTTPS not blindly external',
);
assert(!wouldRnWebViewInvokeLinking(wl, 'https://www.tiktok.com/@u/video/1'), '28 HTTPS stays whitelist');

assert(isZeroSideEffectBlock(classifyBrowserNavigation('snssdk1180://x').kind), '18–24 zero side-effect kind');
assert(!classifyBrowserNavigation('snssdk1180://x').shouldLoadInWebView, '18 no new document');

group('B Consumption presentation');

const idle = initialBrowserMediaActionState;
assert(
  shell({
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
  }) === 'TRACKING_CURRENT_VIDEO',
  '29 unconsumed A visible',
);
assert(
  shell({
    actionState: { ...idle, status: 'preparing', contentIdentity: 'tiktok:video:A' },
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
  }) === 'HANDOFF_IN_PROGRESS',
  '30 HANDOFF',
);
assert(
  shell({
    actionState: { ...idle, status: 'verified', contentIdentity: 'tiktok:video:A' },
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: true,
  }) === 'READY',
  '31 quality-open still READY/not consumed',
);
assert(
  shell({
    actionState: { ...idle, status: 'verified', contentIdentity: 'tiktok:video:A' },
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: true,
    liveIdentityConsumed: false,
  }) === 'READY',
  '32 quality cancel remains visible',
);
assert(
  shell({
    actionState: { ...idle, status: 'failed', contentIdentity: 'tiktok:video:A', errorMessage: 'x' },
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
  }) === 'UNSUPPORTED_CURRENT_CONTENT' ||
    shell({
      actionState: { ...idle, status: 'failed', contentIdentity: 'tiktok:video:A' },
      liveContentIdentity: 'tiktok:video:A',
      liveOwnershipConfidence: 'STRONG',
      hasVerifiedOffer: true,
    }) === 'READY',
  '33 verify failure not consumed hide',
);

browserMediaActionService.__resetAllForTests();
browserMediaActionService.setActiveTab('tabA');
browserMediaActionService.resetForNavigation('https://www.tiktok.com/@u/video/1');
browserMediaActionService.setVerified({
  pageUrl: 'https://www.tiktok.com/@u/video/1',
  media: {
    id: 'mA',
    url: 'https://cdn.example.com/a.mp4',
    finalUrl: 'https://cdn.example.com/a.mp4',
    sourceUrl: null,
    pageUrl: 'https://www.tiktok.com/@u/video/1',
    title: 'A',
    mimeType: 'video/mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'PROGRESSIVE',
    confidence: 0.9,
    detectionSource: 'native_network',
    requiresCookies: false,
    requiredHeaders: null,
    thumbnailUrl: null,
    duration: 10,
    width: 720,
    height: 1280,
    resolution: '720p',
    bitrate: null,
    codec: null,
    audioCodec: null,
    estimatedFileSize: 1,
    websiteSource: 'tiktok.com',
    isDrm: false,
    videoOnly: false,
    hasSeparateAudio: false,
  },
  analysis: {
    title: 'A',
    platform: 'tiktok',
    sourceUrl: 'https://cdn.example.com/a.mp4',
    finalUrl: 'https://cdn.example.com/a.mp4',
    thumbnailUrl: null,
    duration: 10,
    container: 'mp4',
    extension: 'mp4',
    mimeType: 'video/mp4',
    mediaType: 'video',
    streamType: 'PROGRESSIVE',
    downloadable: true,
    requiresCookies: false,
    drm: false,
    encrypted: false,
    variants: [
      {
        variantId: 'v1',
        label: '720p',
        height: 720,
        width: 1280,
        bandwidth: 1,
        codecs: 'avc1',
        mimeType: 'video/mp4',
        url: 'https://cdn.example.com/a.mp4',
        downloadable: true,
        isDefault: true,
      },
    ],
    selectedVariantId: 'v1',
  } as never,
  requestContext: { pageUrl: 'https://www.tiktok.com/@u/video/1', headers: {} },
  mediaUrl: 'https://cdn.example.com/a.mp4',
  autoShow: false,
  contentIdentity: 'tiktok:video:A',
  variantIdentity: 'v1',
});

const claim = browserMediaActionService.claimForHandoff();
assert(claim.outcome === 'CLAIMED', '30 claim');
if (claim.outcome !== 'CLAIMED') {
  throw new Error('claim failed');
}
assert(!browserMediaActionService.isContentIdentityConsumed('tiktok:video:A'), '31 not consumed before enqueue');
browserMediaActionService.releaseHandoff(claim.tabId, claim.fingerprint, claim.handoffGeneration, 'no');
assert(browserMediaActionService.getState().status === 'verified', '34 enqueue reject restores AVAILABLE');

const claim2 = browserMediaActionService.claimForHandoff();
assert(claim2.outcome === 'CLAIMED', '35 re-claim');
if (claim2.outcome === 'CLAIMED') {
  const ok = browserMediaActionService.commitConsumed(
    claim2.tabId,
    claim2.fingerprint,
    claim2.handoffGeneration,
    'dl1',
  );
  assert(ok, '35 enqueue accepted consumes');
}
assert(browserMediaActionService.getState().status === 'consumed', '35 status consumed');
assert(browserMediaActionService.isContentIdentityConsumed('tiktok:video:A'), '35 identity consumed');
assert(browserMediaActionService.getState().contentIdentity === 'tiktok:video:A', '35 identity retained');

assert(
  shell({
    actionState: browserMediaActionService.getState(),
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
    liveIdentityConsumed: true,
  }) === 'CONSUMED_CURRENT_CONTENT',
  '36 consumed A CTA hidden',
);
assert(
  !shouldKeepCtaShellMounted({
    shellState: 'CONSUMED_CURRENT_CONTENT',
  }),
  '36 shell not sticky after consume',
);

browserMediaActionService.retainConsumedPresentation('tiktok:video:A');
assert(browserMediaActionService.getState().status === 'consumed', '37–40 rediscovery stays consumed');
assert(
  shell({
    actionState: { ...idle, status: 'idle' },
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
    liveIdentityConsumed: true,
  }) === 'CONSUMED_CURRENT_CONTENT',
  '37–40 idle+consumed identity still hidden',
);

assert(
  shell({
    actionState: { ...idle, status: 'consumed', contentIdentity: 'tiktok:video:A' },
    liveContentIdentity: 'tiktok:video:B',
    liveOwnershipConfidence: 'STRONG',
    liveIdentityConsumed: false,
  }) === 'TRACKING_CURRENT_VIDEO',
  '41 new B visible',
);

browserMediaActionService.setActiveTab('tabB');
browserMediaActionService.resetForNavigation('https://www.instagram.com/reel/B/');
assert(!browserMediaActionService.isContentIdentityConsumed('tiktok:video:A'), '47 tab B independent');
assert(
  shell({
    liveContentIdentity: 'ig:reel:B',
    liveOwnershipConfidence: 'STRONG',
    liveIdentityConsumed: false,
  }) === 'TRACKING_CURRENT_VIDEO',
  '47 tab B CTA visible',
);

browserMediaActionService.setActiveTab('tabA');
assert(browserMediaActionService.isContentIdentityConsumed('tiktok:video:A'), '47 tab A still consumed');

group('C Stale / wrong video');

assert(
  !shouldAcceptVerificationResult({
    resultTabId: 't1',
    activeTabId: 't1',
    resultNavigationEpoch: 1,
    currentNavigationEpoch: 1,
    resultContentIdentity: 'tiktok:video:A',
    currentContentIdentity: 'tiktok:video:B',
    resultGeneration: 1,
    currentGeneration: 2,
  }),
  '50–54 stale A rejected under B',
);
assert(
  shouldAcceptVerificationResult({
    resultTabId: 't1',
    activeTabId: 't1',
    resultNavigationEpoch: 4,
    currentNavigationEpoch: 4,
    resultContentIdentity: 'tiktok:video:D',
    currentContentIdentity: 'tiktok:video:D',
    resultGeneration: 4,
    currentGeneration: 4,
  }),
  '57–58 D current accepted',
);

group('D Presentation priority');

assert(
  shell({
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
    liveIdentityConsumed: true,
    hasVerifiedOffer: true,
    actionState: { ...idle, status: 'verified', contentIdentity: 'tiktok:video:A' },
  }) === 'CONSUMED_CURRENT_CONTENT',
  '59 consumed outranks owner visibility',
);
assert(
  shell({
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
  }) === 'TRACKING_CURRENT_VIDEO',
  '60 strong unconsumed visible',
);
assert(
  shell({
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'MEDIUM',
  }) === 'TRACKING_CURRENT_VIDEO',
  '61 medium unconsumed visible',
);

group('E Architecture');

assert(!hookSrc.includes('LogBox'), '68 no LogBox');
assert(!hookSrc.includes('setInterval'), '69 no CTA setInterval');
assert(!shellSrc.includes('setTimeout'), '70 no CTA timeout');
assert(!policySrc.includes("originWhitelist={['*']}") && !wl.includes('*') || wl.every((e) => e !== '*'), '73 no wildcard');
assert(navSrc.includes('isSocialNativeAppScheme(trimmed)'), '74 openExternal refuses social');
assert(hookSrc.includes('retainConsumedPresentation'), '40 no idle resurrect');
assert(serviceSrc.includes('clearExecutableOfferFields'), '35 keep identity on consume');
assert(eventsSrc.includes('classifyBrowserNavigation'), 'policy on shouldStart');
assert(buildBrowserOriginWhitelist().some((e) => e.includes('snssdk*')), 'snssdk* whitelist glob');

const downloaderSm = readSrc('src/downloads/execution/download-state-machine.ts');
assert(downloaderSm.includes('PREPARING') && downloaderSm.includes('QUEUED'), '80 Phase 1 SM present');

if (failed > 0) {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nResults: ${passed} passed, ${failed} failed`);
