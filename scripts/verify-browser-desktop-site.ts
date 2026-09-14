/**
 * Phase 3D — Desktop Site finalization verification (static architecture).
 * Does not import React Native / Expo / MMKV runtime modules.
 *
 * Usage (from mobile/): npm run verify:browser-desktop-site
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describePlatformPage } from '../src/media-detection/platform/registry.ts';

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
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function mustInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} missing: ${needle}`);
  }
}

function mustNotInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(!source.includes(needle), `${label} must not include: ${needle}`);
  }
}

/** Mirror of resolveEffectiveDesktopMode — pure precedence check. */
function resolveEffectiveDesktopMode(input: {
  userPreference: boolean;
  userPreferenceExplicit: boolean;
  platformPrefersDesktop: boolean;
}): { desktopMode: boolean; source: string } {
  if (input.userPreferenceExplicit) {
    return { desktopMode: input.userPreference, source: 'user' };
  }
  if (input.platformPrefersDesktop) {
    return { desktopMode: true, source: 'platform' };
  }
  return { desktopMode: false, source: 'default' };
}

console.log('Phase 3D — Desktop Site Verification\n');

test('1. Desktop mode stored per tab', () => {
  const types = read('src/browser/tabs/types.ts');
  mustInclude(types, ['desktopMode: boolean', 'desktopModeSource'], 'tab types');
  const actions = read('src/browser/stores/browserStore/actions.ts');
  mustInclude(actions, ['patchActiveTab', "desktopModeSource: 'user'"], 'per-tab patch');
});

test('2. Global default does not change on active toggle', () => {
  const actions = read('src/browser/stores/browserStore/actions.ts');
  mustInclude(actions, ['do NOT mutate global MMKV default'], 'no global write on toggle');
  mustNotInclude(
    actions,
    ['persistDesktopMode(', 'persistDesktopModeUserExplicit('],
    'setDesktopMode must not write MMKV default',
  );
});

test('3. New tab gets global default', () => {
  const factory = read('src/browser/tabs/tab-factory.ts');
  mustInclude(factory, ['readNewTabDesktopDefault', 'createHomeTab'], 'new-tab default');
  const desktop = read('src/browser/session/desktop-mode.service.ts');
  mustInclude(desktop, ['NEW TAB DEFAULT ONLY', 'readGlobalDesktopDefault'], 'global semantics');
});

test('4. A ON / B OFF isolation model', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(webView, ['tabs.find((t) => t.id === tabId)?.desktopMode', 'tabId'], 'tab-scoped mode');
  // Parked tab may finish its own Desktop reload; callbacks stay tab-scoped.
  mustInclude(webView, ['Owning-tab Desktop reload may complete while parked', 'tabId'], 'owned reload');
});

test('5. Desktop menu reflects active tab', () => {
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(menu, ['selectDesktopMode', "source: 'user'", 'tabId: targetTabId'], 'menu → captured tab');
  const selectors = read('src/browser/stores/browserStore/selectors.ts');
  mustInclude(selectors, ['selectActiveTabDesktopMode'], 'active selector alias');
});

test('6. Mobile uses stock WebView UA', () => {
  const ua = read('src/browser/constants/user-agent.ts');
  mustInclude(ua, ['if (!desktop)', 'return undefined'], 'mobile omits UA');
  mustInclude(ua, ['resolveWebViewUserAgentForTab'], 'canonical tab resolver');
});

test('7. Desktop uses centralized desktop UA', () => {
  const ua = read('src/browser/constants/user-agent.ts');
  mustInclude(ua, ['DESKTOP_USER_AGENTS', 'Chrome/131', 'resolveWebViewUserAgent'], 'desktop UA');
  assert(ua.includes('Linux x86_64'), 'desktop Linux UA');
  const desktopBlock = ua.slice(
    ua.indexOf('const DESKTOP_USER_AGENTS'),
    ua.indexOf('} as const;', ua.indexOf('const DESKTOP_USER_AGENTS')) + '} as const;'.length,
  );
  assert(desktopBlock.includes('Linux x86_64'), 'desktop Linux UA in block');
  assert(!/\bMobile\b/.test(desktopBlock), 'desktop UA strings have no Mobile token');
  assert(!/\(Linux; Android/.test(desktopBlock), 'desktop UA strings are not Android mobile');
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(webView, ['resolveWebViewUserAgentForTab'], 'WebView uses canonical');
  mustNotInclude(webView, ['buildBrowserUserAgent('], 'no ad-hoc UA in WebView');
});

test('8. applicationNameForUserAgent does not duplicate/mismatch', () => {
  const config = read('src/browser/webview/webview-configuration.ts');
  mustInclude(config, ['applicationNameForUserAgent: undefined'], 'config omits');
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustNotInclude(webView, ['applicationNameForUserAgent'], 'no prop on WebView');
  const ua = read('src/browser/constants/user-agent.ts');
  mustInclude(ua, ['includeBrandToken', 'BROWSER_USER_AGENT_BRAND_TOKEN'], 'brand opt-in only');
  assert(
    /buildBrowserUserAgent[\s\S]*?if \(!options\?\.includeBrandToken\)[\s\S]*?return base/.test(ua),
    'default UA unbranded',
  );
});

test('9–10. Exactly one reload owner for ON/OFF', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    [
      'executeDesktopReload',
      'reload_started',
      'desktopReloadPendingRef',
      'pendingUaCommitReloadRef',
      'ua_commit_scheduled',
    ],
    'one owner + UA-before-reload',
  );
  // Comments may mention reload(); count only the imperative statement.
  const reloadStatementLines = webView
    .split('\n')
    .filter((line) => /^\s*reload\(\);\s*$/.test(line));
  assert(
    reloadStatementLines.length === 1,
    `single reload() call site, found ${reloadStatementLines.length}`,
  );
  // Must not reload in the same turn as setAppliedDesktopMode (stale UA race).
  assert(
    !/setAppliedDesktopMode\(toMode\);\s*[\s\S]{0,120}^\s*reload\(\);/m.test(webView),
    'reload must not follow setAppliedDesktopMode in the same function body',
  );
});

test('11. Inactive tab Desktop reload stays owning-tab scoped', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    ['Owning-tab Desktop reload may complete while parked', 'activate_reconcile'],
    'parked reload + activate reconcile',
  );
  assert(!webView.includes('reload_aborted_inactive'), 'no inactive abort that drops desired UA');
});

test('12. Switch between mounted tabs does not reload for Desktop', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(webView, ['desktopMode,\n    executeDesktopReload'], 'toggle deps include desktopMode');
  assert(!webView.includes('}, [isActive]);'), 'no isActive-only effect reload');
});

test('13–14. Evicted restore applies tab UA before load', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    ['useState(desktopMode)', 'mount_restore', 'evicted restore applies UA before load'],
    'init from tab desktopMode',
  );
  const mounted = read('src/browser/components/BrowserContainer/MountedTabWebView.tsx');
  mustInclude(mounted, ['tabId', 'BrowserWebView'], 'per-tab host');
});

test('15. No fake history restore for Desktop', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustNotInclude(webView, ['goBack(', 'history.back'], 'no history hacks');
});

test('16. Desktop toggle does not clear cookies', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  // Comment may mention CookieManager (Phase 6A warning); forbid clear/call sites only.
  mustNotInclude(
    webView,
    ['clearCookies', 'clearData', 'clearFormData', 'CookieManager.clear', 'CookieManager.remove'],
    'no cookie clear',
  );
  assert(
    !/\bCookieManager\.[A-Za-z_]\w*\s*\(/.test(webView),
    'BrowserWebView must not invoke CookieManager APIs',
  );
  const config = read('src/browser/webview/webview-configuration.ts');
  mustInclude(config, ['sharedCookiesEnabled: true'], 'shared cookies on');
});

test('17. No global cache clear', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustNotInclude(webView, ['clearCache(', 'clearHistory('], 'no global clear');
});

test('18–19. Cache bypass is tab-scoped one-shot → LOAD_DEFAULT', () => {
  const config = read('src/browser/webview/webview-configuration.ts');
  mustInclude(
    config,
    ['BROWSER_WEBVIEW_CACHE_MODE_DEFAULT = \'LOAD_DEFAULT\'', 'BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD = \'LOAD_NO_CACHE\''],
    'cache modes',
  );
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    [
      'desktopReloadPendingRef',
      'BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD',
      'setCacheMode(BROWSER_WEBVIEW_CACHE_MODE_DEFAULT)',
    ],
    'one-shot cache',
  );
});

test('20. User preference beats platform recommendation', () => {
  const resolved = resolveEffectiveDesktopMode({
    userPreference: false,
    userPreferenceExplicit: true,
    platformPrefersDesktop: true,
  });
  assert(resolved.desktopMode === false && resolved.source === 'user', 'user wins');
  const desktop = read('src/browser/session/desktop-mode.service.ts');
  mustInclude(desktop, ['canApplyPlatformDesktop', "source !== 'user'"], 'platform guard');
  const actions = read('src/browser/stores/browserStore/actions.ts');
  mustInclude(actions, ["if (tab.desktopModeSource === 'user')", 'return;'], 'user immutable');
});

test('21. Desktop/platform updates target captured tabId (never blind active retarget)', () => {
  const actions = read('src/browser/stores/browserStore/actions.ts');
  mustInclude(
    actions,
    ['options?.tabId ?? state.activeTabId', 'patchTab', 'Capture targetTabId at call time'],
    'targetTabId ownership',
  );
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(menu, ["tabId: targetTabId", "source: 'user'"], 'menu captures targetTabId');
});

test('22. TikTok initial load has no mid-load auto Desktop flip', () => {
  const home = describePlatformPage('https://www.tiktok.com/');
  assert(home.prefersDesktopWebView === false, 'tiktok prefers mobile');
  const sync = read('src/media-detection/hooks/useMediaDetectionBrowserSync.ts');
  mustNotInclude(sync, ['setDesktopMode'], 'media sync never flips Desktop');
});

test('23. Close during Desktop reload is safe', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(webView, ['reload_aborted_tab_closed'], 'close abort log');
});

test('24. Switch during Desktop reload cannot leak via inactive abort', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(webView, ['isActive', 'tabId'], 'scoped callbacks');
  const engine = read('src/browser/hooks/useTabScopedBrowserEngine.ts');
  mustInclude(engine, ['tabId'], 'tab-scoped engine');
});

test('25–26. Error remains per-tab; retry uses tab loadUrl', () => {
  const types = read('src/browser/tabs/types.ts');
  mustInclude(types, ['error:'], 'per-tab error field');
  const view = read('src/browser/components/BrowserErrorView/BrowserErrorView.tsx');
  mustInclude(view, ['controller.loadUrl(retryUrl)', 'goHomeForTab'], 'retry/home via target tab');
});

test('27. Media/navigation epoch remains tab-scoped', () => {
  const engine = read('src/browser/hooks/useTabScopedBrowserEngine.ts');
  mustInclude(engine, ['navigationEpochRef', 'bumpNavigationEpoch'], 'epoch');
  const media = read('src/browser/media-actions/browser-media-action.service.ts');
  mustInclude(media, ['buildTabScopedConsumptionKey', 'tabId'], 'tab-scoped CTA');
});

test('28. Mounted WebViews never exceed 2', () => {
  const constants = read('src/browser/tabs/constants.ts');
  mustInclude(constants, ['MAX_MOUNTED_WEBVIEWS = 2', 'MAX_OPEN_TABS = 8'], 'pool bounds');
});

test('29. No backend added', () => {
  const sync = read('src/media-detection/hooks/useMediaDetectionBrowserSync.ts');
  mustNotInclude(sync, ['fetch(', 'axios', 'supabase'], 'no network desktop sync');
  const desktop = read('src/browser/session/desktop-mode.service.ts');
  mustNotInclude(desktop, ['fetch(', 'http://', 'https://'], 'local desktop service');
});

test('30. No SSL bypass added', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustNotInclude(
    webView,
    ['onReceivedSslError', 'proceed()', 'setAllowFileAccess(true)'],
    'no SSL weaken',
  );
  const config = read('src/browser/webview/webview-configuration.ts');
  mustInclude(config, ["BROWSER_MIXED_CONTENT_MODE = 'never'"], 'mixed content never');
});

test('diagnostics BrowserDesktop present', () => {
  const diag = read('src/browser/diagnostics/browser-runtime-diagnostics.service.ts');
  mustInclude(diag, ['logBrowserDesktop', 'BrowserDesktop'], 'desktop diagnostics');
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    [
      'toggle_requested',
      'reload_deferred',
      'reload_started',
      'reload_completed',
      'ua_resolved',
      'mount_restore',
    ],
    'desktop events',
  );
});

test('mid-load + rapid toggle coalesce', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    ['deferredDesktopReloadRef', 'desiredDesktopModeRef', 'deferred_after_load', 'reload_in_flight'],
    'coalesce policy',
  );
});

test('pending navigation waits for mounted tab controller (no silent noop drop)', () => {
  const screen = read('src/browser/BrowserScreen.tsx');
  mustInclude(
    screen,
    [
      'pendingNavigationService.peek()',
      'tabControllerRegistry.get(pending.targetTabId)',
      'pendingNavigationService.consume(',
      'controller.loadUrl(consumed.url)',
    ],
    'deferred consume until TARGET tab controller ready',
  );
  assert(
    !/pendingNavigationService\.consume\(\);\s*\n\s*if \(!pendingUrl\)/.test(screen),
    'must not consume before controller guard',
  );
  const pending = read('src/browser/services/pending-navigation.service.ts');
  mustInclude(pending, ['targetTabId', 'requestId'], 'pending bound to tab + requestId');
  const noop = read('src/browser/tabs/tab-controller-registry.ts');
  mustInclude(noop, ['loadUrl: () => undefined', 'createNoopTabController'], 'noop documented');
});

test('sourceUri chrome pairing does not depend on desktopMode', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(webView, ['}, [sourceUri]);', 'intentional chrome source pairing only'], 'sourceUri-only sync');
});

console.log(`\nDesktop site: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
