/**
 * Phase 3C — Browser tab UI verification (static).
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-browser-tab-ui.ts
 *   npm run verify:browser-tab-ui
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

console.log('Phase 3C — Browser Tab UI Verification\n');

test('badge = tabs.length (not static 1)', () => {
  const badge = read('src/browser/components/BrowserHeader/BrowserTabBadge.tsx');
  mustInclude(badge, ['selectTabCount', 'onPress'], 'badge');
  mustNotInclude(badge, ['count = 1', 'Multi-tab management is not implemented'], 'badge stub gone');
});

test('tap badge opens switcher', () => {
  const screen = read('src/browser/BrowserScreen.tsx');
  mustInclude(
    screen,
    ['BrowserTabSwitcher', 'openTabSwitcher', 'BrowserTabBadge onPress={openTabSwitcher}'],
    'screen wiring',
  );
});

test('switcher shows tabs from engine + active marker + close + new tab', () => {
  const switcher = read('src/browser/components/BrowserTabSwitcher/BrowserTabSwitcher.tsx');
  mustInclude(
    switcher,
    [
      'selectTabs',
      'selectActiveTabId',
      'switchTab',
      'closeTab',
      'createTab',
      'LIMIT_REACHED',
      'browser-tab-switcher-new-tab',
      'tabSwitcherCloseA11y',
    ],
    'switcher',
  );
  mustNotInclude(switcher, ['<WebView', 'captureRef', 'takeSnapshot'], 'no previews');
});

test('New Tab canonical createTab from menu + switcher', () => {
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  const switcher = read('src/browser/components/BrowserTabSwitcher/BrowserTabSwitcher.tsx');
  mustInclude(menu, ['createTab()'], 'menu');
  mustInclude(switcher, ['createTab()'], 'switcher');
});

test('address draft discarded on tab switch', () => {
  const address = read('src/browser/hooks/useAddressBar.ts');
  mustInclude(address, ['selectActiveTabId', 'activeTabId', 'setDraft(\'\')'], 'address');
});

test('Desktop check uses active tab mirror', () => {
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(menu, ['selectDesktopMode', 'setDesktopMode'], 'desktop menu');
});

test('Copy/Share/Bookmark use active currentUrl/title', () => {
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(menu, ['selectCurrentUrl', 'selectPageTitle', 'addBookmark', 'Clipboard', 'Share.share'], 'actions');
});

test('Phase 1 downloads remain global / close does not cancel downloads', () => {
  const actions = read('src/browser/stores/browserStore/actions.ts');
  mustInclude(actions, ['cleanupClosedTab', 'clearTab'], 'close cleanup CTA only');
  mustNotInclude(actions, ['cancelDownload', 'admission-scheduler'], 'no Phase 1 cancel');
});

test('hydration mounts active only (engine)', () => {
  const persist = read('src/browser/tabs/tab-persistence.service.ts');
  mustInclude(persist, ['coldStartMountPool'], 'cold start');
});

test('max 8 UI feedback localized', () => {
  const en = read('src/localization/en.ts');
  mustInclude(en, ['tabsLimitReached', 'tabSwitcherTitle'], 'en');
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(menu, ['tabsLimitReached'], 'menu feedback');
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
