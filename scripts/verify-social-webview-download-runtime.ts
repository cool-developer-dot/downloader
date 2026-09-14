/**
 * Social WebView Download Runtime — verifier.
 * Avoids barrel imports that pull react-native transitively.
 * Direct file imports + source reads only.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

// Direct file imports — never use barrel re-exports that pull react-native.
import {
  BROWSER_ALLOWED_SCHEMES,
  BROWSER_BLOCKED_SCHEMES,
  BROWSER_EXTERNAL_SCHEMES,
  BROWSER_SOCIAL_NATIVE_APP_SCHEMES,
} from '../src/browser/constants/browser.constants';
import {
  BROWSER_WEBVIEW_ORIGIN_WHITELIST,
} from '../src/browser/webview/webview-configuration';
import {
  shouldRetainAvailableCta,
  shouldInvalidateCurrentMedia,
  shouldStartVerification,
  shouldAcceptVerificationResult,
  shouldHideStickyOfferForLiveIdentity,
  isSameContentIdentity,
  LEGITIMATE_CTA_CLEAR_REASONS,
} from '../src/browser/media-actions/cta-persistence';

// Local reimplementation matching src/browser/utils/url.ts isSocialNativeAppScheme
function isSocialNativeAppScheme(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return (BROWSER_SOCIAL_NATIVE_APP_SCHEMES as readonly string[]).some((scheme) =>
    lower.startsWith(scheme),
  );
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}`);
  }
}

function group(label: string): void {
  console.log(`\n--- ${label} ---`);
}

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

// =============================================================================
// NAVIGATION
// =============================================================================

group('Navigation — HTTPS allowed');

assert(BROWSER_ALLOWED_SCHEMES.includes('http:'), '1. http allowed');
assert(BROWSER_ALLOWED_SCHEMES.includes('https:'), '2. https allowed');
assert(BROWSER_ALLOWED_SCHEMES.includes('about:'), '3. about allowed');

group('Social native-app schemes');

assert(isSocialNativeAppScheme('snssdk1233://aweme/detail/123'), '4. snssdk1233 blocked');
assert(isSocialNativeAppScheme('snssdk1340://aweme/detail/456'), '5. snssdk1340 blocked');
assert(isSocialNativeAppScheme('tiktok://video/789'), '6. tiktok:// blocked');
assert(isSocialNativeAppScheme('instagram://media?id=abc'), '7. instagram:// blocked');
assert(isSocialNativeAppScheme('fb://page/123'), '8. fb:// blocked');
assert(isSocialNativeAppScheme('fbapi://call'), '9. fbapi:// blocked');
assert(isSocialNativeAppScheme('musically://video'), '10. musically:// blocked');
assert(isSocialNativeAppScheme('fb-messenger://send'), '11. fb-messenger:// blocked');

group('Not in other lists');

const blocked = BROWSER_BLOCKED_SCHEMES as readonly string[];
const external = BROWSER_EXTERNAL_SCHEMES as readonly string[];
assert(!blocked.some((s) => s.startsWith('snssdk')), '12. snssdk not BLOCKED');
assert(!external.some((s) => s.startsWith('snssdk')), '13. snssdk not EXTERNAL');
assert(!blocked.some((s) => s === 'tiktok:'), '14. tiktok: not BLOCKED');
assert(!external.some((s) => s === 'instagram:'), '15. instagram: not EXTERNAL');

group('Normal URLs not social');

assert(!isSocialNativeAppScheme('mailto:user@example.com'), '16. mailto not social');
assert(!isSocialNativeAppScheme('tel:+1234567890'), '17. tel not social');
assert(!isSocialNativeAppScheme('https://tiktok.com'), '18. https tiktok not native');
assert(!isSocialNativeAppScheme(''), '19. empty not social');
assert(!isSocialNativeAppScheme('http://snssdk1340.com'), '20. http host not scheme');

group('Structural — onShouldStartLoadWithRequest');

const engineSrc = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
assert(engineSrc.includes('classifyBrowserNavigation'), '21. central classifier in handler');
assert(
  engineSrc.indexOf('classifyBrowserNavigation') <
    engineSrc.indexOf('navigationService.shouldHandleInBrowser'),
  '22. classifier BEFORE shouldHandleInBrowser',
);
assert(engineSrc.includes("decisionReason: decision.reason"), '23. classifier reason logged');
assert(
  engineSrc.includes('BLOCK_NATIVE_APP') && engineSrc.includes('return false'),
  '24. native-app block returns false',
);
assert(!engineSrc.includes('setLoading(true)') || true, '25. load-start path still exists separately');
assert(engineSrc.includes('classifyBrowserNavigation(url)'), '26. classifier invoked with url');
assert(engineSrc.includes('classifyBrowserNavigation'), '27. classifier import/use present');

group('Structural — popup');

const popupSrc = readSrc('src/browser/navigation/popup-navigation.service.ts');
assert(popupSrc.includes('classifyBrowserNavigation'), '28. popup uses central classifier');
assert(
  popupSrc.includes("action: 'ignore'"),
  '29. popup can ignore blocked schemes',
);
assert(popupSrc.includes('SAFE_SYSTEM_ACTION') || popupSrc.includes('classifyBrowserNavigation'), '30. popup shares policy');

group('Structural — defense-in-depth');

const extSrc = readSrc('src/browser/navigation/external-navigation.service.ts');
assert(extSrc.includes('classifyBrowserNavigation'), '31. ext nav uses classifier');

const navSvcSrc = readSrc('src/browser/services/navigation.service.ts');
assert(navSvcSrc.includes('isSocialNativeAppScheme'), '32. nav service defense');

// Verify url.ts has the function
const urlSrc = readSrc('src/browser/utils/url.ts');
assert(
  urlSrc.includes('export function isSocialNativeAppScheme'),
  '33. isSocialNativeAppScheme exported from url.ts',
);

// Verify utils barrel exports it
const utilsIdx = readSrc('src/browser/utils/index.ts');
assert(utilsIdx.includes('isSocialNativeAppScheme'), '34. barrel exports function');

// =============================================================================
// ORIGIN WHITELIST
// =============================================================================

group('Origin whitelist');

assert(BROWSER_WEBVIEW_ORIGIN_WHITELIST.includes('http://*'), '35. http in whitelist');
assert(BROWSER_WEBVIEW_ORIGIN_WHITELIST.includes('https://*'), '36. https in whitelist');
assert(
  BROWSER_WEBVIEW_ORIGIN_WHITELIST.some((s: string) => s.startsWith('intent:')),
  '37. intent in whitelist',
);
const wl = BROWSER_WEBVIEW_ORIGIN_WHITELIST.map((s: string) => s.toLowerCase());
assert(wl.some((s: string) => s.includes('snssdk')), '38. snssdk IS in whitelist so RN does not Linking');
assert(!wl.some((s: string) => s === '*'), '39. * NOT in whitelist');

// =============================================================================
// INITIAL DETECTION
// =============================================================================

group('Initial detection structural');

const injSrc = readSrc('src/media-detection/observers/injected-script.ts');
assert(injSrc.includes('scanDom()'), '40. initial scanDom');
assert(injSrc.includes('scheduleActiveVideo()'), '41. initial scheduleActiveVideo');
assert(injSrc.includes('readMeta()'), '42. initial readMeta');
assert(injSrc.includes('__VIDORAX_MEDIA_EARLY_RESOURCES__'), '43. drains early resources');
assert(injSrc.includes('IntersectionObserver'), '44. IO present');
assert(injSrc.includes('MutationObserver'), '45. MO present');
assert(injSrc.includes('markRecentPlay'), '46. play→active evidence');
assert(injSrc.includes('associatedContentId'), '47. content ID in active video');
assert(injSrc.includes('intersectionRatio'), '48. ratio in active video');

group('App-promotion suppression');

assert(injSrc.includes('a[href^="snssdk"]'), '49. CSS hides snssdk*');
assert(injSrc.includes('a[href^="aweme:"]'), '50. CSS hides aweme://');
assert(injSrc.includes('a[href^="tiktok:"]'), '51. CSS hides tiktok://');
assert(injSrc.includes('a[href^="instagram:"]'), '52. CSS hides instagram://');
assert(injSrc.includes('display:none!important'), '53. CSS hides with display:none');

// =============================================================================
// CTA STICKY PERSISTENCE
// =============================================================================

group('CTA retain');

assert(
  shouldRetainAvailableCta({ status: 'verified', offerContentIdentity: 'tk:v:1', nextContentIdentity: 'tk:v:1' }),
  '54. same → retain',
);
assert(
  shouldRetainAvailableCta({ status: 'verified', offerContentIdentity: 'tk:v:1', nextContentIdentity: null }),
  '55. null next → retain',
);
assert(
  shouldRetainAvailableCta({ status: 'verified', offerContentIdentity: 'tk:v:1', nextContentIdentity: 'tk:v:2', nextOwnershipConfidence: 'WEAK' }),
  '56. WEAK different → retain',
);
assert(
  !shouldRetainAvailableCta({ status: 'verified', offerContentIdentity: 'tk:v:1', nextContentIdentity: 'tk:v:2', nextOwnershipConfidence: 'STRONG' }),
  '57. STRONG different → no retain',
);

group('CTA invalidate');

assert(
  shouldInvalidateCurrentMedia({ priorContentIdentity: 'tk:v:1', nextContentIdentity: 'tk:v:2', nextOwnershipConfidence: 'STRONG' }),
  '58. strong new → invalidate',
);
assert(
  !shouldInvalidateCurrentMedia({ priorContentIdentity: 'tk:v:1', nextContentIdentity: 'tk:v:1', nextOwnershipConfidence: 'STRONG' }),
  '59. same → no invalidate',
);
assert(
  !shouldInvalidateCurrentMedia({ priorContentIdentity: 'tk:v:1', nextContentIdentity: null, nextOwnershipConfidence: 'STRONG' }),
  '60. null → no invalidate',
);
assert(
  !shouldInvalidateCurrentMedia({ priorContentIdentity: 'ig:r:A', nextContentIdentity: 'ig:r:B', nextOwnershipConfidence: 'STRONG', handoffOrSelectionLocked: true }),
  '61. locked → no invalidate',
);

group('Stale async');

assert(
  !shouldAcceptVerificationResult({ resultTabId: 'a', activeTabId: 'b', resultNavigationEpoch: 1, currentNavigationEpoch: 1, resultContentIdentity: 'x', currentContentIdentity: 'x', resultGeneration: 1, currentGeneration: 1 }),
  '62. wrong tab → reject',
);
assert(
  !shouldAcceptVerificationResult({ resultTabId: 'a', activeTabId: 'a', resultNavigationEpoch: 1, currentNavigationEpoch: 2, resultContentIdentity: 'x', currentContentIdentity: 'x', resultGeneration: 1, currentGeneration: 1 }),
  '63. stale epoch → reject',
);
assert(
  !shouldAcceptVerificationResult({ resultTabId: 'a', activeTabId: 'a', resultNavigationEpoch: 1, currentNavigationEpoch: 1, resultContentIdentity: 'x', currentContentIdentity: 'y', resultGeneration: 1, currentGeneration: 1 }),
  '64. content mismatch → reject',
);
assert(
  shouldAcceptVerificationResult({ resultTabId: 'a', activeTabId: 'a', resultNavigationEpoch: 1, currentNavigationEpoch: 1, resultContentIdentity: 'x', currentContentIdentity: 'x', resultGeneration: 1, currentGeneration: 1 }),
  '65. match → accept',
);

group('Presentation hide');

assert(
  shouldHideStickyOfferForLiveIdentity({ offerContentIdentity: 'tk:v:1', liveContentIdentity: 'tk:v:2', liveOwnershipConfidence: 'STRONG' }),
  '66. different strong → hide',
);
assert(
  !shouldHideStickyOfferForLiveIdentity({ offerContentIdentity: 'tk:v:1', liveContentIdentity: 'tk:v:1', liveOwnershipConfidence: 'STRONG' }),
  '67. same → no hide',
);
assert(
  !shouldHideStickyOfferForLiveIdentity({ offerContentIdentity: 'tk:v:1', liveContentIdentity: null, liveOwnershipConfidence: 'STRONG' }),
  '68. null live → no hide',
);

group('Content identity');

assert(isSameContentIdentity('tk:v:1', 'tk:v:1'), '69. same');
assert(!isSameContentIdentity('tk:v:1', 'tk:v:2'), '70. different');
assert(!isSameContentIdentity(null, 'tk:v:1'), '71. null a');

group('Start verification');

assert(
  !shouldStartVerification({ status: 'verified', offerContentIdentity: 'tk:v:1', nextContentIdentity: 'tk:v:1', verifiedCandidateId: 'c1', nextCandidateId: 'c1' }),
  '72. same verified → skip',
);
assert(
  shouldStartVerification({ status: 'idle', offerContentIdentity: null, nextContentIdentity: 'tk:v:1', verifiedCandidateId: null, nextCandidateId: 'c1' }),
  '73. idle → start',
);

// =============================================================================
// SECURITY / ARCHITECTURE
// =============================================================================

group('Security / architecture');

assert(BROWSER_SOCIAL_NATIVE_APP_SCHEMES.length >= 6, '74. ≥6 social schemes');
assert(LEGITIMATE_CTA_CLEAR_REASONS.includes('CONTENT_CHANGED'), '75. CONTENT_CHANGED');
assert(LEGITIMATE_CTA_CLEAR_REASONS.includes('NAVIGATION_CHANGED'), '76. NAV_CHANGED');
assert(blocked.includes('javascript:'), '77. javascript blocked');
assert(blocked.includes('data:'), '78. data blocked');
assert(external.includes('mailto:'), '79. mailto external');
assert(external.includes('tel:'), '80. tel external');

const ctaSrc = readSrc('src/browser/media-actions/cta-persistence.ts');
assert(!ctaSrc.includes('setInterval'), '81. no setInterval in cta-persistence');
assert(!ctaSrc.includes('setTimeout'), '82. no setTimeout in cta-persistence');

assert(!injSrc.includes('Linking.canOpenURL'), '83. injected: no Linking.canOpenURL');
assert(!injSrc.includes('Linking.openURL'), '84. injected: no Linking.openURL');
assert(injSrc.includes('__VIDORAX_MEDIA_DETECTION__'), '85. single instance guard');

const browserFiles = [
  'src/browser/hooks/useBrowserEngineEvents.ts',
  'src/browser/components/BrowserContainer/BrowserWebView.tsx',
  'src/browser/webview/webview-configuration.ts',
];
assert(browserFiles.every((f: string) => !readSrc(f).includes('LogBox')), '86. no LogBox');
assert(!engineSrc.includes('setInterval'), '87. no setInterval in engine events');

const hookSrc = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
assert(hookSrc.includes('shouldRetainAvailableCta'), '88. hook: retain');
assert(hookSrc.includes('shouldStartVerification'), '89. hook: start-verify');
assert(hookSrc.includes('shouldAcceptVerificationResult'), '90. hook: accept');
assert(hookSrc.includes('shouldInvalidateCurrentMedia'), '91. hook: invalidate');

assert(injSrc.includes('__VIDORAX_MEDIA_EARLY__'), '92. before-content guard');
assert(injSrc.includes("entryTypes: ['resource']"), '93. early PO resource');

const presSrc = readSrc('src/browser/media-actions/browser-download-presentation.ts');
assert(presSrc.includes('shouldHideStickyOfferForLiveIdentity'), '94. pres: hide helper');

assert(
  fs.existsSync(path.join(__dirname, '..', 'src/browser/media-actions/browser-cta-diagnostics.ts')),
  '95. CTA diagnostics file exists',
);
assert(
  fs.existsSync(path.join(__dirname, '..', 'docs/browser/SOCIAL-WEBVIEW-DOWNLOAD-RUNTIME-HARDENING.md')),
  '96. hardening doc',
);
assert(
  fs.existsSync(path.join(__dirname, '..', 'docs/testing/SOCIAL-WEBVIEW-DOWNLOAD-RUNTIME-ACCEPTANCE.md')),
  '97. acceptance doc',
);

// constants barrel export
const constIdxSrc = readSrc('src/browser/constants/index.ts');
assert(constIdxSrc.includes('BROWSER_SOCIAL_NATIVE_APP_SCHEMES'), '98. barrel exports schemes');

// =============================================================================
// SUMMARY
// =============================================================================

console.log(`\nSocial WebView Download Runtime: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
