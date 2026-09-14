/**
 * Browser top-level document loading lifecycle verifier.
 *
 * Usage (from mobile/):
 *   npm run verify:browser-loading-lifecycle
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
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
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

console.log('Browser loading lifecycle verification\n');

async function main(): Promise<void> {
await test('load start turns current tab loading on', () => {
  const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
  const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
  mustInclude(events, ['setLoading(true)', 'onLoadStart'], 'events');
  mustInclude(engine, ['loading: true', 'loadUrl'], 'chrome loadUrl');
});

await test('load end turns loading off', () => {
  const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
  mustInclude(events, ['clearTopLevelLoading', "clearTopLevelLoading('load_end')"], 'load end');
});

await test('error turns loading off', () => {
  const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
  mustInclude(events, ['loading: false', 'setError'], 'error clears');
  const actions = readSrc('src/browser/stores/browserStore/actions.ts');
  mustInclude(actions, ['loading: false', 'progress: 0'], 'setError path');
});

await test('stale navigation completion ignored', () => {
  const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
  mustInclude(
    events,
    ['isStaleEvent()', 'Stale completion from a superseded chrome navigation'],
    'stale guard',
  );
});

await test('inactive tab cannot affect active spinner', () => {
  const actions = readSrc('src/browser/stores/browserStore/actions.ts');
  mustInclude(
    actions,
    [
      'mirrorChrome = tabId === get().activeTabId',
      'never writes another tab\'s WebView events into active chrome',
    ],
    'tab mirror',
  );
  const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
  mustInclude(events, ['updateTab(tabId', 'withOwningTabGuard'], 'owning tab patch');
});

await test('navState.loading cannot permanently re-arm spinner', () => {
  const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
  mustInclude(
    events,
    [
      'nextLoading = owning.loading',
      'must NEVER re-arm the spinner',
      'Boolean(navState.loading)',
    ],
    'navState ownership',
  );
  // Must not blindly pass navState.loading into applyNavigationState anymore.
  assert(
    !events.includes('loading: navState.loading'),
    'must not assign navState.loading directly',
  );
});

await test('progress near-complete clears loading (no timeout workaround)', () => {
  const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
  mustInclude(
    events,
    ['raw >= 0.99', 'setLoading(false)', 'Progress reaching completion'],
    'progress complete',
  );
  mustNotInclude(
    events,
    ['setTimeout(() => setLoading(false)', 'setInterval'],
    'no timeout/polling',
  );
});

await test('SPA cannot leave permanent loading', () => {
  const bridge = readSrc('src/browser/hooks/useBrowserChromeBridge.ts');
  mustInclude(bridge, ["case 'spa_navigation'"], 'spa handler');
  // SPA updates URL/title only — never setLoading(true).
  const spaBlock = bridge.slice(bridge.indexOf("case 'spa_navigation'"));
  const spaBody = spaBlock.slice(0, spaBlock.indexOf('default:'));
  mustNotInclude(spaBody, ['setLoading(true)', 'loading: true'], 'spa body');
});

await test('media/subresource activity cannot control loading state', () => {
  const mediaHost = readSrc('src/media-detection/components/MediaDetectionHost.tsx');
  // Media host must not touch browser loading chrome.
  mustNotInclude(
    mediaHost,
    ['setLoading(', 'isLoading:', 'selectIsLoading'],
    'media host',
  );
  const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
  mustNotInclude(
    events,
    ['mediaDetectionEngine.setLoading', 'verifyMediaCandidate', 'runPreDownloadGate'],
    'events isolation',
  );
});

await test('Home clears loading', () => {
  const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
  mustInclude(engine, ["url: 'vidorax://home'", 'loading: false'], 'goHome');
  const actions = readSrc('src/browser/stores/browserStore/actions.ts');
  mustInclude(actions, ['goHome:', 'isLoading: false'], 'store home');
});

await test('tab close cleans state', () => {
  const actions = readSrc('src/browser/stores/browserStore/actions.ts');
  mustInclude(actions, ['cleanupClosedTab', 'closeTab'], 'close cleanup');
});

await test('redirect URL compare uses same-document helper', () => {
  const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
  mustInclude(
    events,
    ['isSameDocumentNavigationUrl(url, owning.url)', 'isSameDocumentNavigationUrl(navState.url'],
    'same document',
  );
});

console.log(`\nBrowser loading lifecycle: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
}

void main();
