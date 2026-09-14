/**
 * Phase 6A — Session continuity, cookies & logged-in browser state verifier.
 *
 * Usage (from mobile/):
 *   npm run verify:phase6a-session-continuity
 *
 * Deterministic checks — no Maestro / Appium / Python / expo prebuild.
 * Imports only RN-free modules (same constraint as verify-browser-tab-engine).
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { phase6aSessionContinuityPolicy } from '../src/browser/session/session-continuity-policy';
import {
  stripSensitiveAuthQueryParams,
  urlContainsSensitiveAuthQuery,
  SENSITIVE_AUTH_QUERY_KEYS,
} from '../src/browser/session/session-url-sanitizer';
import {
  browserWebViewConfiguration,
  browserWebViewConfigurationContract,
  BROWSER_WEBVIEW_INCOGNITO_PROP_FORBIDDEN,
} from '../src/browser/webview/webview-configuration';
import {
  sanitizeBrowserUrl,
  browserRuntimeDiagnosticsContract,
} from '../src/browser/diagnostics/browser-runtime-diagnostics.service';
import { generalPageMediaContextStore } from '../src/media-detection/general-media';
import { MAX_OPEN_TABS, MAX_MOUNTED_WEBVIEWS } from '../src/browser/tabs/constants';
import { isIntentScheme } from '../src/browser/navigation/intent-uri-resolver';

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

function mustInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} missing: ${needle}`);
  }
}

function mustNotInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(!source.includes(needle), `${label} must not contain: ${needle}`);
  }
}

function listTsFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') {
        continue;
      }
      listTsFiles(full, acc);
    } else if (/\.(ts|tsx|kt|java)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function isHomeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed === 'vidorax://home' ||
    trimmed === 'vidorax://home/' ||
    trimmed === 'about:vidorax-home'
  );
}

function isBlockedSchemeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('file:') ||
    lower.startsWith('blob:')
  );
}

/**
 * Mirrors popup-navigation.service decision rules without importing Linking / RN.
 */
function resolvePopupForTest(targetUrl: string): 'load_in_browser' | 'open_external' | 'ignore' {
  const trimmed = targetUrl.trim();
  if (!trimmed || trimmed === 'about:blank' || isHomeUrl(trimmed)) {
    return 'ignore';
  }
  if (isIntentScheme(trimmed)) {
    return 'open_external';
  }
  if (isBlockedSchemeUrl(trimmed)) {
    return 'ignore';
  }
  try {
    const protocol = new URL(trimmed).protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:') {
      return 'load_in_browser';
    }
  } catch {
    return 'ignore';
  }
  return 'ignore';
}

console.log('Phase 6A — Session Continuity Verification\n');

async function main(): Promise<void> {
  // Policy module must stay RN-free.
  assert(phase6aSessionContinuityPolicy.platform === 'android', 'platform');
  assert(SENSITIVE_AUTH_QUERY_KEYS.length > 0, 'auth keys');

  await test('1. same-site tabs share platform cookie semantics / no app isolation layer', () => {
    assert(
      phase6aSessionContinuityPolicy.cookieAuthority ===
        'android_webview_cookie_manager',
      'cookie authority',
    );
    assert(phase6aSessionContinuityPolicy.customCookieDatabase === false, 'no custom jar');
    assert(
      browserWebViewConfiguration.sharedCookiesEnabled === true &&
        browserWebViewConfiguration.thirdPartyCookiesEnabled === true,
      'cookie props enabled',
    );
    assert(
      phase6aSessionContinuityPolicy.androidSharedCookiesPropIsNoop === true,
      'Android sharedCookies prop is no-op',
    );
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(
      webView,
      [
        'thirdPartyCookiesEnabled={config.thirdPartyCookiesEnabled}',
        'sharedCookiesEnabled={config.sharedCookiesEnabled}',
      ],
      'BrowserWebView applies cookie props',
    );
    mustNotInclude(webView, ['incognito={true}', 'incognito={config.incognito}'], 'no incognito prop');
    const container = readSrc('src/browser/components/BrowserContainer/BrowserContainer.tsx');
    mustInclude(container, ['mountedTabIds', 'MountedTabWebView'], 'shared mount pool');
    assert(!container.includes('CookieManager'), 'no per-tab cookie manager');
  });

  await test('2–5. tab switch / close / navigation / Home do not clear cookies', () => {
    const paths = [
      'src/browser/stores/browserStore/actions.ts',
      'src/browser/hooks/useTabScopedBrowserEngine.ts',
      'src/browser/hooks/useBrowserSessionContinuity.ts',
      'src/browser/hooks/useBrowserEngineEvents.ts',
      'src/browser/tabs/tab-operations.ts',
    ];
    for (const rel of paths) {
      mustNotInclude(
        readSrc(rel),
        ['removeAllCookies', 'clearCookies', 'CookieManager.clear', 'flushCookieStore'],
        rel,
      );
    }
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['clearHistory', 'goHome'], 'Home clears history only');
    const closeOp = readSrc('src/browser/tabs/tab-operations.ts');
    mustInclude(closeOp, ['closeTabOperation', 'CLOSED', 'REPLACED_HOME'], 'close op');
    mustNotInclude(closeOp, ['Cookie', 'cookie'], 'close never touches cookies');
    const switchOp = readSrc('src/browser/tabs/tab-operations.ts');
    mustInclude(switchOp, ['switchTabOperation'], 'switch op');
  });

  await test('6. login redirects remain WebView http(s) navigation', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ["decisionReason: 'http_https'", 'onShouldStartLoadWithRequest'], 'allow https');
    const nav = readSrc('src/browser/services/navigation.service.ts');
    mustInclude(nav, ['shouldHandleInBrowser', 'hasAllowedScheme'], 'in-browser policy');
  });

  await test('7. safe HTTPS popup routes through existing popup logic', () => {
    assert(
      resolvePopupForTest('https://accounts.example.com/oauth/authorize') === 'load_in_browser',
      'https popup in browser',
    );
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(webView, ['resolvePopupNavigation', 'onOpenWindow', 'loadUrl(decision.url)'], 'popup wiring');
    const popup = readSrc('src/browser/navigation/popup-navigation.service.ts');
    mustInclude(popup, ["action: 'load_in_browser'", 'shouldHandleInBrowser'], 'popup service');
    assert(
      phase6aSessionContinuityPolicy.popupStrategy === 'same_webview_https',
      'popup strategy',
    );
  });

  await test('8. unsafe custom scheme still goes through safe intent policy', () => {
    assert(
      resolvePopupForTest('intent://scan/#Intent;scheme=zxing;end') === 'open_external',
      'intent external',
    );
    assert(resolvePopupForTest('javascript:alert(1)') === 'ignore', 'javascript blocked');
    const intentSvc = readSrc('src/browser/navigation/intent-navigation.service.ts');
    mustInclude(intentSvc, ['Never calls Linking.openURL with raw intent://'], 'intent safety');
  });

  await test('9–13. SPA / login / logout / account-switch bump page/media ownership', () => {
    generalPageMediaContextStore.clearAll();
    const tabId = 'phase6a-spa-tab';

    const login = generalPageMediaContextStore.syncFromPageUrl({
      tabId,
      pageUrl: 'https://app.example.com/login',
      navigationEpoch: 1,
    });
    assert(login != null && login.pageGeneration === 1, 'login gen');

    const authed = generalPageMediaContextStore.syncFromPageUrl({
      tabId,
      pageUrl: 'https://app.example.com/dashboard',
      navigationEpoch: 1,
    });
    assert(authed != null && authed.pageGeneration === 2, 'SPA path bumps generation');
    assert(
      generalPageMediaContextStore.isStaleGeneration(tabId, 1, 1) === true,
      'pre-login generation stale',
    );

    const logout = generalPageMediaContextStore.syncFromPageUrl({
      tabId,
      pageUrl: 'https://app.example.com/login',
      navigationEpoch: 2,
    });
    assert(logout != null && logout.pageGeneration === 3, 'logout nav bumps');

    const accountB = generalPageMediaContextStore.syncFromPageUrl({
      tabId,
      pageUrl: 'https://app.example.com/dashboard',
      navigationEpoch: 3,
    });
    assert(accountB != null && accountB.pageGeneration === 4, 'account switch bumps');

    const chrome = readSrc('src/browser/hooks/useBrowserChromeBridge.ts');
    mustInclude(chrome, ["case 'spa_navigation'", 'updateTab(tabId'], 'SPA URL apply');
    const sync = readSrc('src/media-detection/hooks/useMediaDetectionBrowserSync.ts');
    mustInclude(sync, ['onNavigationStart', 'currentUrl'], 'SPA → media sync');

    generalPageMediaContextStore.clearTab(tabId);
  });

  await test('10–11. stale pre-login media/CTA cannot overwrite authenticated page', () => {
    const cta = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    mustInclude(cta, ['pageGeneration', 'scope.pageGeneration'], 'CTA generation guard');
    const general = readSrc('src/media-detection/general-media/general-page-context.ts');
    mustInclude(general, ['shouldBump', 'pagePathIdentity', 'pageGeneration'], 'ownership bump');
  });

  await test('14. same-site tab media state remains isolated', () => {
    const tabA = 'iso-a';
    const tabB = 'iso-b';
    generalPageMediaContextStore.clearTab(tabA);
    generalPageMediaContextStore.clearTab(tabB);
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: tabA,
      pageUrl: 'https://site.com/watch/1',
      navigationEpoch: 1,
    });
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: tabB,
      pageUrl: 'https://site.com/watch/2',
      navigationEpoch: 1,
    });
    const a = generalPageMediaContextStore.get(tabA);
    const b = generalPageMediaContextStore.get(tabB);
    assert(a?.pageUrl.includes('watch/1'), 'A url');
    assert(b?.pageUrl.includes('watch/2'), 'B url');
    assert(a?.tabId !== b?.tabId, 'tab ids distinct');
    generalPageMediaContextStore.clearTab(tabA);
    generalPageMediaContextStore.clearTab(tabB);

    const mediaSvc = readSrc('src/browser/media-actions/browser-media-action.service.ts');
    mustInclude(
      mediaSvc,
      ['clearTab', 'suspendTab', 'setActiveTab', 'buildTabScopedConsumptionKey'],
      'CTA tab scope',
    );
  });

  await test('15–16. inactive / closed tab callbacks cannot mutate active tab', () => {
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(
      webView,
      ['if (!isActive)', 'Inactive parked tabs must not drive media'],
      'park gate',
    );
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['withOwningTabGuard', 'webViewInstanceGenerationRef'], 'generation guard');
    const actions = readSrc('src/browser/stores/browserStore/actions.ts');
    mustInclude(actions, ['cleanupClosedTab', 'clearTab'], 'close cleanup');
  });

  await test('17–18. top-level redirect spinner vs media/background', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(
      events,
      ['clearTopLevelLoading', "clearTopLevelLoading('load_end')", 'onLoadProgress'],
      'top-level clear',
    );
    mustNotInclude(events, ['setInterval(', 'pollCookie', 'checkLoggedIn'], 'no poll in events');
  });

  await test('19–21. no custom credential / cookie / session DB', () => {
    assert(phase6aSessionContinuityPolicy.customCookieDatabase === false, 'no cookie db');
    assert(phase6aSessionContinuityPolicy.customSessionDatabase === false, 'no session db');
    assert(phase6aSessionContinuityPolicy.persistRawCookiesToMmkv === false, 'no mmkv cookies');
    assert(phase6aSessionContinuityPolicy.persistRawCookiesToZustand === false, 'no zustand cookies');
    assert(phase6aSessionContinuityPolicy.persistRawCookiesToAsyncStorage === false, 'no async cookies');
    assert(phase6aSessionContinuityPolicy.persistRawCookiesToSqlite === false, 'no sqlite cookies');

    const sessionTypes = readSrc('src/browser/session/session.types.ts');
    mustNotInclude(sessionTypes, ['cookies', 'Cookie', 'Authorization', 'accessToken'], 'session types');
    const persist = readSrc('src/browser/session/session-persistence.service.ts');
    mustInclude(persist, ['stripSensitiveAuthQueryParams'], 'auth query strip on persist');
    mustNotInclude(persist, ['Set-Cookie', 'document.cookie'], 'persist never cookies');
  });

  await test('22–24. no password/OTP extraction; inject scripts privacy', () => {
    assert(phase6aSessionContinuityPolicy.credentialExtraction === false, 'no cred extract');
    assert(phase6aSessionContinuityPolicy.documentCookieExtraction === false, 'no doc.cookie');
    const chromeInject = readSrc('src/browser/bridge/browser-chrome.injected.ts');
    mustNotInclude(
      chromeInject,
      ['document.cookie', 'input.value', 'password', 'OTP', 'Authorization'],
      'chrome inject',
    );
    const mediaFiles = listTsFiles(join(ROOT, 'src/media-detection')).filter((p) =>
      /inject|observer|bridge/i.test(p),
    );
    for (const file of mediaFiles) {
      const src = readFileSync(file, 'utf8');
      assert(!src.includes('document.cookie'), `${file} must not read document.cookie`);
      assert(
        !/input\.value|passwordField|type=['"]password['"]/i.test(src),
        `${file} must not inspect password/input values`,
      );
    }
  });

  await test('25–26. no cookie / auth polling', () => {
    assert(phase6aSessionContinuityPolicy.cookiePolling === false, 'policy');
    assert(phase6aSessionContinuityPolicy.authPolling === false, 'policy');
    const browserDir = listTsFiles(join(ROOT, 'src/browser'));
    for (const file of browserDir) {
      const src = readFileSync(file, 'utf8');
      assert(!src.includes('checkLoggedIn'), `${file} no login poll`);
      assert(!src.includes('pollCookies'), `${file} no cookie poll`);
      assert(!/setInterval\s*\(\s*\(\)\s*=>\s*.*cookie/i.test(src), `${file} no cookie interval`);
    }
  });

  await test('27. diagnostics redact sensitive URL/query data', () => {
    const sanitized = sanitizeBrowserUrl(
      'https://auth.example.com/callback?code=SECRET&state=abc&access_token=TOK',
    );
    assert(sanitized.safeHost === 'auth.example.com', 'host only');
    assert(sanitized.queryPresent === true, 'queryPresent flag');
    assert(!JSON.stringify(sanitized).includes('SECRET'), 'no code');
    assert(!JSON.stringify(sanitized).includes('TOK'), 'no token');

    const stripped = stripSensitiveAuthQueryParams(
      'https://site.com/cb?code=abc&keep=1&access_token=x&id_token=y',
    );
    assert(!stripped.includes('code='), 'strip code');
    assert(!stripped.includes('access_token'), 'strip access_token');
    assert(stripped.includes('keep=1'), 'keep non-sensitive');
    assert(urlContainsSensitiveAuthQuery('https://x.com/?otp=123') === true, 'detect otp');
    assert(urlContainsSensitiveAuthQuery('https://x.com/?code=1') === true, 'detect code');
    assert(SENSITIVE_AUTH_QUERY_KEYS.includes('code'), 'code listed');

    const contract = browserRuntimeDiagnosticsContract;
    assert(contract.blockedKeys.has('cookie'), 'cookie blocked');
    assert(contract.blockedKeys.has('password'), 'password blocked');
    assert(contract.blockedKeys.has('otp'), 'otp blocked');
  });

  await test('28. no backend / auth API in Phase 6A surface', () => {
    const policy = readSrc('src/browser/session/session-continuity-policy.ts');
    mustNotInclude(policy, ['firebase', 'supabase', 'auth.api', 'createRemoteAuth'], 'policy');
    const continuity = readSrc('src/browser/hooks/useBrowserSessionContinuity.ts');
    mustNotInclude(continuity, ['fetch(', 'axios', 'supabase', 'firebase'], 'continuity hook');
  });

  await test('29. no Phase 6B authenticated downloader implementation in 6A', () => {
    assert(
      phase6aSessionContinuityPolicy.phase6bAuthenticatedDownloader === false,
      '6B not claimed',
    );
    const phase6aFiles = [
      'src/browser/session/session-continuity-policy.ts',
      'src/browser/session/session-url-sanitizer.ts',
      'src/browser/hooks/useBrowserSessionContinuity.ts',
    ];
    for (const rel of phase6aFiles) {
      const src = readSrc(rel);
      mustNotInclude(
        src,
        ['headers.Cookie', 'Authorization:', 'buildAuthenticatedDownload'],
        rel,
      );
    }
  });

  await test('30. existing tab max/bounds remain intact', () => {
    assert(MAX_OPEN_TABS === 8, 'max tabs');
    assert(MAX_MOUNTED_WEBVIEWS === 2, 'max mounted');
  });

  await test('incognito forbidden + DOM storage + third-party policy documented', () => {
    assert(BROWSER_WEBVIEW_INCOGNITO_PROP_FORBIDDEN === true, 'incognito forbidden flag');
    assert(browserWebViewConfigurationContract.incognito === false, 'config incognito false');
    assert(browserWebViewConfigurationContract.domStorageEnabled === true, 'dom storage');
    assert(
      phase6aSessionContinuityPolicy.thirdPartyCookiePolicy === 'accept_for_webview',
      '3p policy',
    );
    const config = readSrc('src/browser/webview/webview-configuration.ts');
    mustInclude(
      config,
      [
        'CookieManager',
        'Never pass WebView `incognito`',
        'sharedCookiesEnabled',
        'thirdPartyCookiesEnabled',
      ],
      'config docs',
    );
  });

  await test('VidoraCookieBridge is read-only handoff (existing) — 6A does not clear jar', () => {
    const bridge = readSrc(
      'android/app/src/main/java/com/anonymous/vidorax/mediadetection/VidoraCookieBridgeModule.kt',
    );
    mustInclude(bridge, ['CookieManager.getInstance()', 'getCookie', 'hasCookiesForUrl'], 'bridge');
    mustNotInclude(bridge, ['removeAllCookies', 'setCookie'], 'bridge read-only');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
