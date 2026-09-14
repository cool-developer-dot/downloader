/**
 * Phase 3D — Back / Forward / Home ownership + responsive WebView static checks.
 * Run once: npx tsx scripts/verify-browser-navigation-responsive.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${msg}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${msg}`);
  }
}

function mustInclude(src: string, needles: string[], label: string): void {
  const missing = needles.filter((n) => !src.includes(n));
  assert(missing.length === 0, `${label}${missing.length ? ` missing: ${missing.join(' | ')}` : ''}`);
}

console.log('\nPhase 3D — Navigation + Responsiveness Verification\n');

const navOwner = read('src/browser/services/active-tab-navigation.service.ts');
mustInclude(
  navOwner,
  [
    'goBackForTab',
    'goForwardForTab',
    'goHomeForTab',
    'goBackActiveTab',
    'targetTabId',
    'tabControllerRegistry.get',
    'webViewInstanceGenerationRef',
  ],
  'canonical navigation owner',
);

const toolbarNav = read('src/browser/hooks/useBrowserNavigation.ts');
mustInclude(
  toolbarNav,
  ['goBackForTab', 'goForwardForTab', 'goHomeForTab', 'activeTabId'],
  'toolbar captures activeTabId',
);
assert(!toolbarNav.includes('useBrowserEngineContext'), 'toolbar does not use engine context directly');

const hw = read('src/browser/hooks/useBrowserHardwareBack.ts');
mustInclude(hw, ['goBackForTab', 'activeTabId', 'android_back'], 'hardware Back shares owner');

const engine = read('src/browser/hooks/useTabScopedBrowserEngine.ts');
mustInclude(engine, ["strategy: 'native_webview'", "strategy: 'home_fallback'"], 'Back native then Home');
assert(!engine.includes("strategy: 'chrome_stack'"), 'no chrome_stack sourceUri Back/Forward');
mustInclude(engine, ['Preserve desktopMode'], 'Home preserves Desktop metadata comment');

const events = read('src/browser/hooks/useBrowserEngineEvents.ts');
assert(
  !events.includes('navState.canGoBack || chrome.index'),
  'events do not OR chrome stack into canGoBack',
);
assert(
  !events.includes('navState.canGoForward ||'),
  'events do not OR chrome stack into canGoForward',
);

const mount = read('src/browser/tabs/mount-pool.ts');
mustInclude(mount, ['canGoBack: false', 'canGoForward: false', 'EVICTED'], 'evicted clears history flags');

const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
mustInclude(
  webView,
  ['scalesPageToFit={scalesPageToFit}', 'resolveScalesPageToFit', 'appliedDesktopMode'],
  'per-tab Desktop viewport via scalesPageToFit',
);

const config = read('src/browser/webview/webview-configuration.ts');
mustInclude(
  config,
  ['resolveScalesPageToFit', 'setBuiltInZoomControls', 'useWideViewPort/loadWithOverviewMode'],
  'viewport config documented',
);

const toolbar = read('src/browser/components/BrowserToolbar/BrowserToolbar.tsx');
mustInclude(
  toolbar,
  ['BROWSER_TOUCH_TARGET', 'flex={1}', 'isHome', "id === 'home'"],
  'toolbar flex + Home disabled on Home',
);
mustInclude(
  toolbar,
  ["id === 'back'", "id === 'forward'", "id === 'home'", 'ToolbarButton'],
  'Back Forward Home always mount ToolbarButton',
);

const toolbarBtn = read('src/browser/components/BrowserToolbar/ToolbarButton.tsx');
mustInclude(
  toolbarBtn,
  [
    'bottomNavActive',
    'bottomNavInactive',
    'bottomNavPressed',
    'disabledOpacity={1}',
    'pressedOpacity={1}',
    'transparent',
    '<Icon',
  ],
  'toolbar button: visible glyphs, transparent default, pressed overlay',
);
assert(!toolbarBtn.includes('IconButton'), 'toolbar button does not use IconButton surface path');
assert(!toolbarBtn.includes('colors.surface'), 'no surface white square');

const menu = read('src/browser/components/BrowserOverflowMenu/BrowserOverflowMenu.tsx');
mustInclude(menu, ['menuWidth', 'windowWidth', 'ScrollView'], 'overflow menu responsive width');

const errorView = read('src/browser/components/BrowserErrorView/BrowserErrorView.tsx');
mustInclude(errorView, ['goHomeForTab', 'reloadForTab', 'activeTabId'], 'error actions capture tab');

assert(!navOwner.includes('setInterval'), 'no navigation polling');
assert(!toolbarNav.includes('setInterval'), 'no toolbar polling');

console.log(`\nNavigation+responsive: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
