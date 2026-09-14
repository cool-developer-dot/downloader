/**
 * Phase 3A — Browser feature architecture audit verification.
 * Static checks only. NO network. NO Metro. NO emulator. NO prebuild.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-browser-phase3-architecture-audit.ts
 *   npm run verify:browser-phase3-architecture-audit
 */

import { existsSync, readFileSync } from 'node:fs';
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

const PHASE1_PATHS = [
  'src/downloads/scheduler/admission-scheduler.ts',
  'src/downloads/scheduler/network-policy.ts',
  'src/downloads/engine/worker.ts',
] as const;

const ARCHITECTURE_DOC =
  'docs/browser/PHASE-3A-BROWSER-FEATURE-ARCHITECTURE.md';

console.log('Phase 3A — Browser Feature Architecture Audit Verification\n');

test('architecture report exists', () => {
  assert(existsSync(join(ROOT, ARCHITECTURE_DOC)), `missing ${ARCHITECTURE_DOC}`);
  const doc = read(ARCHITECTURE_DOC);
  mustInclude(
    doc,
    [
      'OPTION C',
      'RECOMMENDED PHASE 3 MVP TAB ARCHITECTURE',
      'Architectural invariants',
      'maxMountedWebViews',
      'vidorax://home',
      'tabId + mediaFingerprint',
    ],
    'architecture doc',
  );
});

test('BrowserScreen + route located', () => {
  const route = read('src/app/(app)/(tabs)/browser.tsx');
  const screen = read('src/browser/BrowserScreen.tsx');
  mustInclude(route, ['BrowserScreen'], 'browser route');
  mustInclude(
    screen,
    [
      'BrowserEngineProvider',
      'BrowserContainer',
      'BrowserMediaDownloadBar',
      'BrowserTabBadge',
      'MediaDetectionHost',
    ],
    'BrowserScreen',
  );
});

test('BrowserWebView mount pool owner located', () => {
  const engine = read('src/browser/hooks/useBrowserEngine.ts');
  const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
  const container = read('src/browser/components/BrowserContainer/BrowserContainer.tsx');
  const host = read('src/browser/components/BrowserContainer/MountedTabWebView.tsx');

  mustInclude(engine, ['tabControllerRegistry', 'activeTabId'], 'useBrowserEngine facade');
  mustInclude(webView, ['resolveWebViewUserAgent', 'sharedCookiesEnabled'], 'BrowserWebView');
  mustInclude(container, ['MountedTabWebView', 'mountedTabIds'], 'BrowserContainer pool');
  mustInclude(host, ['useTabScopedBrowserEngine'], 'MountedTabWebView');
});

test('browser store + Desktop ownership located', () => {
  const state = read('src/browser/stores/browserStore/state.ts');
  const actions = read('src/browser/stores/browserStore/actions.ts');
  const desktop = read('src/browser/session/desktop-mode.service.ts');
  const prefs = read('src/browser/services/browser-preferences.service.ts');

  mustInclude(state, ['hydrateTabEngineState', 'activeTabId', 'mountedTabIds'], 'browserStore state');
  mustInclude(actions, ['setDesktopMode', 'createTab', 'closeTab', 'switchTab'], 'browserStore actions');
  mustInclude(desktop, ['resolveEffectiveDesktopMode', 'desktopModeUserExplicit'], 'desktop service');
  mustInclude(prefs, ['browserDesktopMode', 'persistDesktopMode'], 'preferences');
  mustInclude(read('src/browser/stores/browserStore/selectors.ts'), ['selectDesktopMode', 'selectTabCount'], 'selectors');
});

test('media CTA ownership located', () => {
  const hook = read('src/browser/media-actions/useBrowserMediaAction.ts');
  const service = read('src/browser/media-actions/browser-media-action.service.ts');
  const bar = read('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
  const fingerprint = read('src/browser/media-actions/media-fingerprint.ts');

  mustInclude(hook, ['enqueueBrowserMediaDownload', 'claimForHandoff', 'commitConsumed', 'visible'], 'useBrowserMediaAction');
  mustInclude(service, ['consumedFingerprints', 'claimForHandoff', 'commitConsumed', 'resetForNavigation', 'buildTabScopedConsumptionKey'], 'CTA service');
  mustInclude(bar, ['useBrowserMediaAction'], 'CTA bar');
  mustInclude(fingerprint, ['buildBrowserMediaFingerprint'], 'fingerprint');
});

test('true browser tab model present (Phase 3B Option C)', () => {
  const types = read('src/browser/types/browser.types.ts');
  const tabTypes = read('src/browser/tabs/types.ts');
  const constants = read('src/browser/tabs/constants.ts');
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');

  mustInclude(types, ['activeTabId', 'mountedTabIds'], 'browser.types tabs');
  mustInclude(tabTypes, ['BrowserTab', 'PersistedTabMetadata'], 'tab model');
  mustInclude(constants, ['MAX_OPEN_TABS = 8', 'MAX_MOUNTED_WEBVIEWS = 2'], 'caps');
  mustInclude(menu, ['createTab()', 'LIMIT_REACHED'], 'new tab → createTab');
  mustNotInclude(types, ['tabs: never[]'], 'tabs no longer never[]');
});

test('no server tab backend / cloud tab sync in browser sources', () => {
  const browserFiles = [
    'src/browser/BrowserScreen.tsx',
    'src/browser/stores/browserStore/state.ts',
    'src/browser/stores/browserStore/actions.ts',
    'src/browser/session/session-persistence.service.ts',
  ];

  for (const file of browserFiles) {
    const src = read(file);
    mustNotInclude(
      src,
      [
        'cloudTabSync',
        'remoteTabPersistence',
        'syncTabsToServer',
        'tabBackend',
      ],
      file,
    );
  }
});

test('architecture doc freezes Option C + local-first constraints', () => {
  const doc = read(ARCHITECTURE_DOC);
  mustInclude(
    doc,
    ['OPTION C — Bounded', 'Local-first', 'No tab backend'],
    'freeze language',
  );
  mustNotInclude(doc, ['RECOMMENDED PHASE 3 MVP TAB ARCHITECTURE: **OPTION A**'], 'must not recommend A');
  mustNotInclude(doc, ['RECOMMENDED PHASE 3 MVP TAB ARCHITECTURE: **OPTION B**'], 'must not recommend B');
});

test('Phase 1 download core files untouched by this audit script scope', () => {
  for (const path of PHASE1_PATHS) {
    assert(existsSync(join(ROOT, path)), `Phase 1 file missing: ${path}`);
  }
  // Audit must not rewrite Phase 1 — presence check only; git diff is human-gated.
  const doc = read(ARCHITECTURE_DOC);
  mustInclude(doc, ['Do not modify Phase 1 scheduler'], 'phase1 preserve note');
});

test('home constant remains vidorax://home for new-tab seed policy', () => {
  const constants = read('src/browser/constants/browser.constants.ts');
  mustInclude(constants, ["BROWSER_HOMEPAGE = 'vidorax://home'"], 'homepage constant');
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
