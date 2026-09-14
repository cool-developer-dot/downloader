/**
 * Desktop Site runtime hardening — immediate toggle + UA-before-reload.
 *
 * Usage: npm run verify:browser-desktop-site-runtime
 * Static architecture checks only — no React Native runtime import.
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

console.log('Desktop Site Runtime Verification\n');

test('1. default tab mobile mode omits WebView userAgent', () => {
  const ua = read('src/browser/constants/user-agent.ts');
  mustInclude(ua, ['resolveWebViewUserAgent', 'desktopMode'], 'mobile omit');
  assert(
    /export function resolveWebViewUserAgent\(desktop: boolean\)[\s\S]{0,200}if\s*\(\s*!desktop\s*\)\s*\{\s*return undefined;/.test(
      ua,
    ),
    'mobile path returns undefined (omit WebView userAgent prop)',
  );
});

test('2-3. Desktop toggle updates store immediately (menu does not wait for reload)', () => {
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(
    menu,
    [
      'setDesktopMode(enabled',
      'desktopSiteEnabled',
      'desktopSiteDisabled',
      'onClose()',
      'Store + Switch update synchronously',
    ],
    'immediate UI',
  );
  assert(!/await[\s\S]{0,40}setDesktopMode/.test(menu), 'no await before toggle');
});

test('4. desktop UA selected when ON', () => {
  const ua = read('src/browser/constants/user-agent.ts');
  mustInclude(ua, ['Chrome/', 'Linux', 'DESKTOP_USER_AGENTS'], 'desktop UA builder');
});

test('5. mobile UA restored when OFF', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    [
      'resolveWebViewUserAgentForTab',
      'appliedDesktopMode',
      '{...(userAgent ? { userAgent } : {})}',
    ],
    'omit prop when mobile',
  );
});

test('6-8. current tab reload once after UA commit; no timer; no duplicate call site', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    [
      'pendingUaCommitReloadRef',
      'ua_commit_scheduled',
      'reload_started',
      'executeDesktopReload',
    ],
    'UA then reload',
  );
  // Imperative reload must be exactly one statement-line (comments may mention reload()).
  const reloadStatementLines = webView
    .split('\n')
    .filter((line) => /^\s*reload\(\);\s*$/.test(line));
  assert(
    reloadStatementLines.length === 1,
    `exactly one reload() statement, found ${reloadStatementLines.length}`,
  );
  mustNotInclude(webView, ['setTimeout(', 'setInterval('], 'no artificial delay');
  assert(
    !/setAppliedDesktopMode\(toMode\);\s*[\s\S]{0,80}^\s*reload\(\);/m.test(webView),
    'no same-turn stale-UA reload',
  );
});

test('9-10. per-tab desktop; tab switch restores toggle from tab state', () => {
  const actions = read('src/browser/stores/browserStore/actions.ts');
  mustInclude(actions, ["desktopModeSource: 'user'", 'chromeFromTab'], 'per-tab');
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(menu, ['selectDesktopMode', 'toggled: desktopMode'], 'menu reads chrome mirror');
  const types = read('src/browser/tabs/types.ts');
  mustInclude(types, ['desktopMode: boolean'], 'tab model');
});

test('11. cookies are not cleared', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  // Comment may mention CookieManager (Phase 6A warning); forbid call sites only.
  mustNotInclude(
    webView,
    ['clearCookies', 'clearData', 'clearFormData', 'CookieManager.clear', 'CookieManager.remove'],
    'no cookie clear',
  );
  assert(
    !/\bCookieManager\.[A-Za-z_]\w*\s*\(/.test(webView),
    'BrowserWebView must not invoke CookieManager APIs',
  );
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustNotInclude(menu, ['CookieManager', 'clearCookies'], 'menu no cookie clear');
});

test('12. Home/Back/Forward architecture preserved (no remount for Desktop)', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(webView, ['webViewRemounted: false', 'reload()'], 'reload not remount');
  const container = read('src/browser/components/BrowserContainer/BrowserContainer.tsx');
  mustInclude(container, ['key={tabId}'], 'stable key');
  mustNotInclude(webView, ['key={appliedDesktopMode', 'key={desktopMode'], 'no UA remount key');
});

test('13. navigation loading lifecycle terminates via normal load end', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    ['finalizeLoadEnd', 'reload_completed', 'desktopReloadPendingRef.current = false'],
    'reload completes',
  );
});

test('14. no fake CSS desktop scaling; reload bumps epoch', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustNotInclude(
    webView,
    ['transform: scale', 'document.documentElement.style.zoom', 'width: 1200'],
    'no fake CSS desktop',
  );
  const engine = read('src/browser/hooks/useTabScopedBrowserEngine.ts');
  mustInclude(engine, ['bumpNavigationEpoch', 'reloadWebView'], 'reload bumps epoch');
});

test('15. no polling', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustNotInclude(webView, ['setInterval(', 'setTimeout('], 'no poll/delay');
});

test('16. no WebView remount — Desktop path uses reload only after UA commit', () => {
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  mustInclude(
    webView,
    ['pendingUaCommitReloadRef.current = true', 'setAppliedDesktopMode'],
    'UA first',
  );
  assert(
    webView.includes('reload()') && !webView.includes('forceRemount'),
    'reload-only desktop path',
  );
});

console.log(`\nDesktop runtime: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
