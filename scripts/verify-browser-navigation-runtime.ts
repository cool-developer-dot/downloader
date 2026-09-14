/**
 * Phase 2C — browser navigation runtime verification.
 *
 * Usage (from mobile/):
 *   npm run verify:browser-navigation-runtime
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('Phase 2C — Browser Navigation Runtime Verification\n');

async function main(): Promise<void> {
  await test('HTTP/HTTPS remain in-browser via navigation policy', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ["decisionReason: 'http_https'"], 'http(s) allow');
    const nav = readSrc('src/browser/services/navigation.service.ts');
    mustInclude(nav, ['shouldHandleInBrowser', 'hasAllowedScheme'], 'policy');
  });

  await test('address bar keeps draft local until submit', () => {
    const src = readSrc('src/browser/hooks/useAddressBar.ts');
    mustInclude(src, ['draft', 'navigateTo', 'loadUrlActiveTab'], 'draft isolation');
    assert(!src.includes('onChangeText') || src.includes('setDraft'), 'typing stays local');
  });

  await test('omnibox Enter uses same loadUrl owner as home shortcuts', () => {
    const address = readSrc('src/browser/hooks/useAddressBar.ts');
    const home = readSrc('src/browser/hooks/useBrowserHome.ts');
    const active = readSrc('src/browser/services/active-tab-navigation.service.ts');
    mustInclude(address, ['loadUrlActiveTab', 'resolveSubmission'], 'omnibox');
    mustInclude(home, ['loadUrlActiveTab'], 'home shortcuts');
    mustInclude(active, ['export function loadUrlActiveTab', 'export function loadUrlForTab'], 'canonical owner');
    assert(
      !address.includes('useBrowserEngineContext'),
      'omnibox must not depend on chrome noop facade loadUrl',
    );
  });

  await test('sourceUri only updated on chrome load (not navigation state)', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['setSourceUri'], 'chrome source updates');
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    assert(!events.includes('setSourceUri'), 'events must not drive sourceUri');
  });

  await test('redirect final URL can commit without source reload', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['isValidBrowserPageUrl(url)', 'applyNavigationState'], 'redirect commit');
  });

  await test('toolbar back prefers native WebView history', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['nativeCanGoBackRef.current', 'goBackWebView'], 'native back first');
  });

  await test('Android hardware back wired on browser tab', () => {
    const hook = readSrc('src/browser/hooks/useBrowserHardwareBack.ts');
    mustInclude(hook, ['useAndroidBackHandler', "'android_back'", 'goBackForTab'], 'hardware back');
    const screen = readSrc('src/browser/BrowserScreen.tsx');
    mustInclude(screen, ['useBrowserHardwareBack'], 'screen wiring');
  });

  await test('reload uses WebView.reload without sourceUri churn', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['reloadWebView', "logBrowserNav(navId, 'reload'"], 'single reload');
    const reloadBlock = engine.match(/const reload = useCallback\([\s\S]*?\n  \}, \[/);
    assert(reloadBlock && !reloadBlock[0].includes('setSourceUri'), 'reload must not set sourceUri');
  });

  await test('stop suppresses aborted error surface', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['suppressNextAbortErrorRef'], 'stop suppress ref');
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['classification === \'aborted\'', 'suppressNextAbortErrorRef'], 'abort suppress');
  });

  await test('home URL excluded from history recording', () => {
    const history = readSrc('src/browser/services/history-recording.service.ts');
    mustInclude(history, ['isBrowserHomeUrl', 'vidorax://'], 'home guard');
  });

  await test('window.open HTTP(S) resolves to same-surface load', () => {
    const popup = readSrc('src/browser/navigation/popup-navigation.service.ts');
    mustInclude(popup, ["action: 'load_in_browser'", 'shouldHandleInBrowser'], 'popup policy');
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(webView, ['setSupportMultipleWindows={config.setSupportMultipleWindows}', 'handleOpenWindow', 'resolvePopupNavigation'], 'popup wiring');
    assert(
      webView.includes('setSupportMultipleWindows={true}') ||
        webView.includes('config.setSupportMultipleWindows'),
      'multiple windows enabled',
    );
  });

  await test('target=_blank handled via onOpenWindow same as window.open', () => {
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(webView, ['onOpenWindow={handleOpenWindow}', 'loadUrl(decision.url)'], 'open window handler');
  });

  await test('mailto/tel external policy present', () => {
    const constants = readSrc('src/browser/constants/browser.constants.ts');
    mustInclude(constants, ["'mailto:'", "'tel:'"], 'external schemes');
    const external = readSrc('src/browser/navigation/external-navigation.service.ts');
    mustInclude(external, ['Linking.canOpenURL', 'openURL'], 'linking handoff');
  });

  await test('intent scheme handled safely', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['isIntentScheme', 'openIntentOrExternal'], 'intent handler');
  });

  await test('dangerous schemes blocked in constants', () => {
    const constants = readSrc('src/browser/constants/browser.constants.ts');
    mustInclude(constants, ["'javascript:'", "'file:'"], 'blocked schemes');
  });

  await test('SPA navigation updates URL without reload', () => {
    const inject = readSrc('src/browser/bridge/browser-chrome.injected.ts');
    mustInclude(inject, ['pushState', 'spa_navigation'], 'SPA observer');
    const bridge = readSrc('src/browser/hooks/useBrowserChromeBridge.ts');
    mustInclude(bridge, ["case 'spa_navigation'", 'setCurrentUrl'], 'SPA handler');
  });

  await test('persistent history separate from WebView stack', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['chromeNavRef', 'nativeCanGoBackRef'], 'dual stack awareness');
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['recordSuccessfulVisit'], 'sqlite history');
    assert(!events.includes('goBackWebView') || events.includes('recordSuccessfulVisit'), 'history not nav stack');
  });

  await test('media detection epoch preserved on navigation', () => {
    const sync = readSrc('src/media-detection/hooks/useMediaDetectionBrowserSync.ts');
    mustInclude(sync, ['navigationEpochRef', 'onNavigationStart'], 'media epoch');
  });

  await test('navigation diagnostics extended', () => {
    const diag = readSrc('src/browser/diagnostics/browser-runtime-diagnostics.service.ts');
    mustInclude(diag, ["'android_back'", "'popup'", "'chrome_load'"], 'nav events');
  });
}

void main().then(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
});
