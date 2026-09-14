/**
 * Browser containment + current-video CTA verifier.
 * Run: npm run verify:browser-containment-current-video-cta
 *
 * Avoid barrel imports that pull react-native.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import { BROWSER_SOCIAL_NATIVE_APP_SCHEMES } from '../src/browser/constants/browser.constants';
import {
  classifyBrowserNavigation,
  wouldRnWebViewInvokeLinking,
  buildBrowserOriginWhitelist,
  isZeroSideEffectBlock,
  isSocialNativePackage,
} from '../src/browser/navigation/browser-navigation-policy';
import { resolveAndroidIntentUri } from '../src/browser/navigation/intent-uri-resolver';
import { BROWSER_WEBVIEW_ORIGIN_WHITELIST } from '../src/browser/webview/webview-configuration';
import { initialBrowserMediaActionState } from '../src/browser/media-actions/browser-media-action.types';
import {
  resolveCtaShellPresentation,
  shouldKeepCtaShellMounted,
  shouldReplaceCurrentOwner,
  shouldTreatAsCurrentVideoOwner,
} from '../src/browser/media-actions/cta-shell-presentation';
import {
  isSameContentIdentity,
  shouldAcceptVerificationResult,
  shouldInvalidateCurrentMedia,
} from '../src/browser/media-actions/cta-persistence';

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

const wl = BROWSER_WEBVIEW_ORIGIN_WHITELIST;

group('1 Web navigation HTTPS');

assert(classifyBrowserNavigation('https://www.tiktok.com/').kind === 'INTERNAL_WEB', '1 TikTok HTTPS');
assert(classifyBrowserNavigation('https://www.instagram.com/reel/abc/').kind === 'INTERNAL_WEB', '2 Instagram HTTPS');
assert(classifyBrowserNavigation('https://www.snapchat.com/').kind === 'INTERNAL_WEB', '3 Snapchat HTTPS');
assert(classifyBrowserNavigation('https://www.facebook.com/').kind === 'INTERNAL_WEB', '4 Facebook HTTPS');
assert(classifyBrowserNavigation('https://x.com/i/status/1').kind === 'INTERNAL_WEB', '5 X HTTPS');
assert(classifyBrowserNavigation('https://example.com/video').kind === 'INTERNAL_WEB', '6 general HTTPS');
assert(classifyBrowserNavigation('http://example.com/').kind === 'INTERNAL_WEB', '7 general HTTP');

group('1 Native schemes blocked');

assert(classifyBrowserNavigation('snssdk1233://aweme/detail/1').kind === 'BLOCK_NATIVE_APP', '8 snssdk1233');
assert(classifyBrowserNavigation('snssdk1340://aweme/detail/2').kind === 'BLOCK_NATIVE_APP', '9 snssdk1340');
assert(classifyBrowserNavigation('tiktok://video/1').kind === 'BLOCK_NATIVE_APP', '10 tiktok native');
assert(classifyBrowserNavigation('instagram://media?id=1').kind === 'BLOCK_NATIVE_APP', '11 instagram native');
assert(classifyBrowserNavigation('snapchat://unlock').kind === 'BLOCK_NATIVE_APP', '12 snapchat native');
assert(classifyBrowserNavigation('fb://page/1').kind === 'BLOCK_NATIVE_APP', '13 fb native');
assert(classifyBrowserNavigation('twitter://status?id=1').kind === 'BLOCK_NATIVE_APP', '14 twitter native');
assert(classifyBrowserNavigation('vnd.youtube://watch?v=x').kind === 'BLOCK_NATIVE_APP', '15 youtube native');

assert(!classifyBrowserNavigation('snssdk1340://x').invokeLinking, '16 no Linking flag');
assert(!classifyBrowserNavigation('snssdk1340://x').shouldLoadInWebView, '17 no webview load');
assert(isZeroSideEffectBlock(classifyBrowserNavigation('snssdk1340://x').kind), '18–24 zero-side-effect kind');

group('2 originWhitelist / RN WebView');

assert(!wl.includes('*'), '26 no wildcard *');
assert(wl.includes('http://*') && wl.includes('https://*'), '27 http/https supported');
assert(
  !wouldRnWebViewInvokeLinking(wl, 'snssdk1340://aweme/detail/1'),
  '25/28 snssdk reaches classifier not RN Linking',
);
assert(!wouldRnWebViewInvokeLinking(wl, 'instagram://media?id=1'), '28 instagram scheme classified');
assert(!wouldRnWebViewInvokeLinking(wl, 'intent://x#Intent;end'), 'intent whitelist');
const popupSrc = readSrc('src/browser/navigation/popup-navigation.service.ts');
assert(popupSrc.includes('classifyBrowserNavigation'), '29 popup blocker uses classifier');
assert(popupSrc.includes("action: 'ignore'"), '29b popup ignore path');
assert(popupSrc.includes('INTERNAL_WEB'), '30 https popup internal policy');

group('3 intent://');

const socialIntent =
  'intent://aweme/detail/1#Intent;scheme=snssdk1340;package=com.zhiliaoapp.musically;end';
const socialDecision = classifyBrowserNavigation(socialIntent);
assert(
  socialDecision.kind === 'BLOCK_NATIVE_APP' || socialDecision.kind === 'INTENT_BLOCK',
  '31 social intent without https fallback blocked',
);
const fallback =
  'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;S.browser_fallback_url=https%3A%2F%2Fzxing.org%2F;end';
assert(classifyBrowserNavigation(fallback).kind === 'INTENT_WEB_FALLBACK', '32 HTTPS fallback internal');
assert(classifyBrowserNavigation(fallback).internalUrl === 'https://zxing.org/', '32b fallback url');
const extSrc = readSrc('src/browser/navigation/external-navigation.service.ts');
assert(!/Linking\.openURL\(\s*trimmed\s*\)/.test(extSrc) || extSrc.includes('SAFE_SYSTEM_ACTION'), '33 intent not raw Linking');
assert(classifyBrowserNavigation('market://details?id=com.zhiliaoapp.musically').kind === 'BLOCK_MARKET', '34 market blocked');
assert(classifyBrowserNavigation('intent:').kind === 'INTENT_BLOCK', '35 malformed intent');
assert(readSrc('src/browser/navigation/intent-navigation.service.ts').includes('rememberIntentFingerprint'), '36 loop guard');

group('4 / 5 CTA shell');

const idle = { ...initialBrowserMediaActionState };
assert(
  resolveCtaShellPresentation({
    isHome: true,
    hasBrowserError: false,
    overlayBlocking: false,
    actionState: idle,
    liveContentIdentity: 'tiktok:video:1',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: false,
  }) === 'HIDDEN',
  '43 no owner on home / hidden',
);
assert(
  resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    actionState: idle,
    liveContentIdentity: null,
    liveOwnershipConfidence: null,
    hasVerifiedOffer: false,
  }) === 'HIDDEN',
  '43b no owner hidden',
);
const tracking = resolveCtaShellPresentation({
  isHome: false,
  hasBrowserError: false,
  overlayBlocking: false,
  actionState: idle,
  liveContentIdentity: 'tiktok:video:1',
  liveOwnershipConfidence: 'STRONG',
  hasVerifiedOffer: false,
});
assert(tracking === 'TRACKING_CURRENT_VIDEO', '44 strong owner shell visible');
assert(shouldKeepCtaShellMounted({ shellState: tracking }), '45 resolving keeps shell');
const ready = resolveCtaShellPresentation({
  isHome: false,
  hasBrowserError: false,
  overlayBlocking: false,
  actionState: { ...idle, status: 'verified' },
  liveContentIdentity: 'tiktok:video:1',
  liveOwnershipConfidence: 'STRONG',
  hasVerifiedOffer: true,
});
assert(ready === 'READY', '46 verified offer ready');
assert(shouldKeepCtaShellMounted({ shellState: ready }), '47 duplicate event no unmount');
assert(shouldTreatAsCurrentVideoOwner({ liveContentIdentity: 'ig:reel:A', liveOwnershipConfidence: 'MEDIUM' }), '48 medium owner');
assert(!shouldTreatAsCurrentVideoOwner({ liveContentIdentity: 'ig:reel:A', liveOwnershipConfidence: 'WEAK' }), '51 weak not owner');
assert(
  shouldReplaceCurrentOwner({
    priorContentIdentity: 'tiktok:video:A',
    nextContentIdentity: 'tiktok:video:B',
    nextOwnershipConfidence: 'STRONG',
  }),
  '52 B replaces A',
);
assert(
  !shouldReplaceCurrentOwner({
    priorContentIdentity: 'tiktok:video:A',
    nextContentIdentity: 'tiktok:video:B',
    nextOwnershipConfidence: 'WEAK',
  }),
  '51b weak B does not replace',
);
assert(
  resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    actionState: { ...idle, status: 'consumed', contentIdentity: 'tiktok:video:A' },
    liveContentIdentity: 'tiktok:video:A',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: false,
  }) === 'CONSUMED_CURRENT_CONTENT',
  'consumed A hidden as consumed',
);
assert(
  resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    actionState: { ...idle, status: 'consumed', contentIdentity: 'tiktok:video:A' },
    liveContentIdentity: 'tiktok:video:B',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: false,
  }) === 'TRACKING_CURRENT_VIDEO',
  '80 next identity can show CTA',
);
assert(
  resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: true,
    overlayBlocking: false,
    actionState: idle,
    liveContentIdentity: 'x',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: false,
  }) === 'HIDDEN',
  '54 page error hides',
);

group('6 content identity');

assert(isSameContentIdentity('tiktok:video:1?x=1', 'tiktok:video:1?x=1'), '55 identity string exact');
assert(!isSameContentIdentity('tiktok:video:1', 'tiktok:video:2'), '60 new TikTok id');
assert(!isSameContentIdentity('ig:reel:AAA', 'ig:reel:BBB'), '59 new Reel id');
assert(isSameContentIdentity('ig:reel:AAA', 'ig:reel:AAA'), '58 Instagram id stable');
assert(isSameContentIdentity('tiktok:video:9', 'tiktok:video:9'), '57 TikTok id stable');

group('7 execution safety / stale');

assert(
  !shouldAcceptVerificationResult({
    resultTabId: 'a',
    activeTabId: 'a',
    resultNavigationEpoch: 1,
    currentNavigationEpoch: 1,
    resultContentIdentity: 'A',
    currentContentIdentity: 'B',
    resultGeneration: 1,
    currentGeneration: 1,
  }),
  '65 A late verify rejected',
);
assert(
  shouldAcceptVerificationResult({
    resultTabId: 'a',
    activeTabId: 'a',
    resultNavigationEpoch: 1,
    currentNavigationEpoch: 1,
    resultContentIdentity: 'B',
    currentContentIdentity: 'B',
    resultGeneration: 2,
    currentGeneration: 2,
  }),
  '68 B tap resolves B',
);
assert(
  shouldInvalidateCurrentMedia({
    priorContentIdentity: 'A',
    nextContentIdentity: 'B',
    nextOwnershipConfidence: 'STRONG',
  }),
  '53 old A not executable after B',
);
assert(
  !shouldInvalidateCurrentMedia({
    priorContentIdentity: 'A',
    nextContentIdentity: 'B',
    nextOwnershipConfidence: 'STRONG',
    handoffOrSelectionLocked: true,
  }),
  '81 handoff lock',
);

group('3b packages / snapchat / youtube');

assert(isSocialNativePackage('com.instagram.android'), 'instagram package');
assert(isSocialNativePackage('com.snapchat.android'), 'snapchat package');
assert(isSocialNativePackage('com.google.android.youtube'), 'youtube package');
assert(!isSocialNativePackage('com.android.chrome'), 'chrome not social list');
assert(BROWSER_SOCIAL_NATIVE_APP_SCHEMES.includes('snapchat:'), 'snapchat scheme constant');
assert(BROWSER_SOCIAL_NATIVE_APP_SCHEMES.includes('vnd.youtube:'), 'youtube scheme constant');

group('9 tabs / overlay');

assert(
  resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: true,
    actionState: idle,
    liveContentIdentity: 'tiktok:video:1',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: true,
  }) === 'HIDDEN',
  '85 overlay hides CTA',
);

group('8 quality / consumption');

assert(
  resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    actionState: { ...idle, status: 'preparing', contentIdentity: 'A' },
    liveContentIdentity: 'A',
    liveOwnershipConfidence: 'STRONG',
    hasVerifiedOffer: true,
  }) === 'HANDOFF_IN_PROGRESS',
  '81 double-tap preparing',
);

group('11 architectural safety');

const policySrc = readSrc('src/browser/navigation/browser-navigation-policy.ts');
const engineSrc = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
const injSrc = readSrc('src/media-detection/observers/injected-script.ts');
const barSrc = readSrc('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
const shellSrc = readSrc('src/browser/media-actions/cta-shell-presentation.ts');
const intentNavSrc = readSrc('src/browser/navigation/intent-navigation.service.ts');

assert(!policySrc.includes('setInterval'), '94 no polling in classifier');
assert(!shellSrc.includes('setTimeout'), '95 no CTA visibility timeout');
assert(!engineSrc.includes('LogBox'), '96 no LogBox');
assert(!wl.includes('*'), '97 no wildcard');
assert(!injSrc.includes("createElement('button"), '98 no DOM CTA button');
assert(injSrc.includes('__VIDORAX_MEDIA_DETECTION__'), '99 single detector');
assert(!policySrc.includes('Cookie'), '100 no Cookie in classifier');
assert(!intentNavSrc.includes('launchExternalApp'), '18 no native intent launch from website');
assert(injSrc.includes('flushActiveVideo()'), '37 initial owner flush');
assert(barSrc.includes('zIndex: 40'), 'z-order above WebView');
assert(barSrc.includes('accessibilityRole="button"'), 'a11y role');

assert(classifyBrowserNavigation('mailto:a@b.c').kind === 'SAFE_SYSTEM_ACTION', 'mailto classify');
assert(classifyBrowserNavigation('unknownapp://x').kind === 'BLOCK_UNKNOWN_SCHEME', '9 unknown deny');

const igApplink =
  'intent://applink.instagram.com/reels/DAbc123/?utm_source=ig_web#Intent;scheme=https;package=com.instagram.android;end';
const igRes = resolveAndroidIntentUri(igApplink);
assert(igRes.type === 'WEB_FALLBACK', 'instagram applink still HTTPS fallback type');
assert(intentNavSrc.includes('intent_applink_contained'), 'applink bounce does not launch app');

assert(buildBrowserOriginWhitelist().every((e) => e !== '*'), 'generated whitelist no star');
assert(!wouldRnWebViewInvokeLinking(wl, 'javascript:alert(1)'), 'javascript classified not Linking');
assert(classifyBrowserNavigation('javascript:alert(1)').kind === 'BLOCK_DANGEROUS', 'javascript blocked');

console.log(`\nBrowser containment + current-video CTA: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
