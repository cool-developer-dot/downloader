/**
 * Browser Android intent:// navigation verifier.
 * Usage (from mobile/): npm run verify:browser-intent-navigation
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import {
  __resetIntentLoopGuardsForTests,
  rememberIntentFingerprint,
} from '../src/browser/navigation/intent-loop-guard';
import {
  isAppLinkBounceHost,
  isIntentScheme,
  parseAndroidIntentUri,
  resolveAndroidIntentUri,
} from '../src/browser/navigation/intent-uri-resolver';

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

const IG_INTENT =
  'intent://applink.instagram.com/reels/DAbc123/?utm_source=ig_web#Intent;scheme=https;package=com.instagram.android;end';

const FALLBACK_INTENT =
  'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;S.browser_fallback_url=https%3A%2F%2Fzxing.org%2F;end';

const BAD_FALLBACK =
  'intent://evil/#Intent;scheme=https;S.browser_fallback_url=javascript%3Aalert(1);end';

const FILE_FALLBACK =
  'intent://x/#Intent;scheme=https;S.browser_fallback_url=file%3A%2F%2F%2Fsdcard%2Fx;end';

const HTTP_RECON = 'intent://example.com/path?q=1#Intent;scheme=http;end';
const HTTPS_RECON = 'intent://example.com/video/1#Intent;scheme=https;end';
const MALFORMED = 'intent:';

const externalSrc = read('src/browser/navigation/external-navigation.service.ts');
const eventsSrc = read('src/browser/hooks/useBrowserEngineEvents.ts');
const webViewSrc = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
const whitelistSrc = read('src/browser/webview/webview-configuration.ts');
const navServiceSrc = read('src/browser/services/navigation.service.ts');
const shareSrc = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
const mainApp = read('android/app/src/main/java/com/anonymous/vidorax/MainApplication.kt');
const intentModule = read(
  'android/app/src/main/java/com/anonymous/vidorax/intent/VidoraIntentLauncherModule.kt',
);
const packageJson = read('package.json');
const intentNavSrc = read('src/browser/navigation/intent-navigation.service.ts');
const actionsSrc = read('src/browser/stores/browserStore/actions.ts');

assert(isIntentScheme(IG_INTENT), 'isIntentScheme recognizes Instagram intent');
assert(
  whitelistSrc.includes('buildBrowserOriginWhitelist'),
  'originWhitelist includes intent so WebViewShared does not Linking.warn',
);
assert(
  externalSrc.includes('handleIntentNavigation'),
  'external service delegates intent to handleIntentNavigation',
);
assert(
  /if \(isIntentScheme\(trimmed\)\) \{[\s\S]*?handleIntentNavigation[\s\S]*?return result\.handled;[\s\S]*?\}/.test(
    externalSrc,
  ),
  'raw intent:// never passed to Linking.openURL',
);
  assert(
    !intentNavSrc.includes("from 'expo-linking'") &&
      !intentNavSrc.includes('from "expo-linking"') &&
      !intentNavSrc.includes("from 'react-native'") &&
      !/Linking\.openURL\s*\(/.test(intentNavSrc),
    'intent navigation service never imports Linking',
  );
  assert(
    eventsSrc.includes('IntentNavigationContext') &&
      (eventsSrc.includes('targetTabId: tabId') || eventsSrc.includes('targetTabId: owningTabId')),
    'targetTabId preserved at intent request time',
  );
assert(
  eventsSrc.includes('controllerGeneration: webViewInstanceGenerationRef.current'),
  'controller generation captured',
);
assert(
  intentModule.includes('Intent.parseUri') && intentModule.includes('URI_INTENT_SCHEME'),
  'native helper uses Intent.parseUri',
);
assert(intentModule.includes('intent.component = null'), 'native strips explicit component');
assert(mainApp.includes('IntentNativePackage'), 'IntentNativePackage registered');
assert(packageJson.includes('verify:browser-intent-navigation'), 'npm script registered');
assert(
  shareSrc.includes('Share.share') && shareSrc.includes('currentUrl'),
  'browser Share Page unchanged (Share API + currentUrl)',
);
assert(
  navServiceSrc.includes("startsWith('intent:')"),
  'navigationService.openExternal refuses intent://',
);
assert(
  webViewSrc.includes('openIntentOrExternal(decision.url,') &&
    webViewSrc.includes('targetTabId: owningTabId'),
  'popup external path passes tab ownership',
);
assert(
  intentNavSrc.includes('rememberIntentFingerprint'),
  'loop protection present',
);
assert(
  intentNavSrc.includes('webViewInstanceGenerationRef.current !== context.controllerGeneration'),
  'stale controller generation rejected',
);
assert(
  actionsSrc.includes('clearIntentLoopGuardForTab'),
  'closed tab clears intent loop guard',
);
assert(
  intentNavSrc.includes("tabs.some((t) => t.id === context.targetTabId)"),
  'closed tab no-op when tab missing',
);

const fb = resolveAndroidIntentUri(FALLBACK_INTENT);
assert(
  fb.type === 'WEB_FALLBACK' && fb.url === 'https://zxing.org/',
  'HTTP(S) browser_fallback_url accepted',
);

const bad = resolveAndroidIntentUri(BAD_FALLBACK);
assert(bad.type !== 'WEB_FALLBACK', 'javascript fallback rejected as WEB_FALLBACK');

const file = resolveAndroidIntentUri(FILE_FALLBACK);
assert(file.type !== 'WEB_FALLBACK', 'file fallback rejected');

const httpRecon = resolveAndroidIntentUri(HTTP_RECON);
assert(
  httpRecon.type === 'WEB_FALLBACK' && httpRecon.url.startsWith('http://example.com/path'),
  'scheme=http reconstruction',
);

const httpsRecon = resolveAndroidIntentUri(HTTPS_RECON);
assert(
  httpsRecon.type === 'WEB_FALLBACK' && httpsRecon.url.startsWith('https://example.com/video/1'),
  'scheme=https reconstruction',
);

const malformed = resolveAndroidIntentUri(MALFORMED);
assert(malformed.type === 'BLOCKED', 'malformed Intent blocked');

const ig = resolveAndroidIntentUri(IG_INTENT);
assert(ig.type === 'WEB_FALLBACK', 'Instagram applink reconstructs to WEB_FALLBACK');
if (ig.type === 'WEB_FALLBACK') {
  assert(
    ig.url.startsWith('https://applink.instagram.com/reels/'),
    'Instagram https reconstruction host/path',
  );
  assert(
    isAppLinkBounceHost(new URL(ig.url).hostname),
    'applink host detected for bounce policy',
  );
}

const parsed = parseAndroidIntentUri(IG_INTENT);
assert(parsed?.packageName === 'com.instagram.android', 'package parsed without executing');
assert(parsed?.scheme === 'https', 'scheme=https parsed');

assert(
  (externalSrc.includes('isExternalScheme') || externalSrc.includes('SAFE_SYSTEM_ACTION')) &&
    externalSrc.includes('Linking.openURL'),
  'mailto/tel behavior still uses Linking for external schemes',
);

assert(
  whitelistSrc.includes('https://') || whitelistSrc.includes('buildBrowserOriginWhitelist'),
  'normal https remains whitelisted for WebView',
);

__resetIntentLoopGuardsForTests();
const fp = ig.type !== 'BLOCKED' ? ig.fingerprint : 'x';
assert(rememberIntentFingerprint('tab-a', 1, fp) === true, 'first intent fingerprint accepted');
assert(rememberIntentFingerprint('tab-a', 1, fp) === false, 'no navigation loop (duplicate blocked)');
assert(
  rememberIntentFingerprint('tab-a', 2, fp) === true,
  'new navigation epoch allows same fingerprint once',
);
assert(
  rememberIntentFingerprint('tab-b', 1, fp) === true,
  'other tab isolation for intent fingerprints',
);

const withBoth =
  'intent://applink.instagram.com/x#Intent;scheme=https;S.browser_fallback_url=https%3A%2F%2Fwww.instagram.com%2Freel%2Fabc%2F;end';
const both = resolveAndroidIntentUri(withBoth);
assert(
  both.type === 'WEB_FALLBACK' && both.url.includes('www.instagram.com/reel/abc'),
  'existing intent fallback semantics not regressed',
);

console.log(`\nBrowser intent navigation: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
