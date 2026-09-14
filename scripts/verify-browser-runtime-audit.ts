/**
 * Phase 2A — browser runtime audit verification.
 * Static architecture/invariant checks + diagnostics presence.
 *
 * Usage (from mobile/):
 *   npm run verify:browser-runtime-audit
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  browserRuntimeDiagnosticsContract,
  classifyBrowserLoadError,
  sanitizeBrowserUrl,
} from '../src/browser/diagnostics/browser-runtime-diagnostics.service';

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
    assert(!source.includes(needle), `${label} must not include: ${needle}`);
  }
}

const BROWSER_DIAG_TAGS = browserRuntimeDiagnosticsContract.tags;

const PHASE1_DOWNLOAD_PATHS = [
  'src/downloads/scheduler/admission-scheduler.ts',
  'src/downloads/scheduler/network-policy.ts',
  'src/downloads/engine/worker.ts',
  'src/downloads/engine/audit-diagnostics.service.ts',
];

console.log('Phase 2A — Browser Runtime Audit Verification\n');

async function main(): Promise<void> {
  await test('main browser entry located', () => {
    const route = readSrc('src/app/(app)/(tabs)/browser.tsx');
    const screen = readSrc('src/browser/BrowserScreen.tsx');
    mustInclude(route, ['BrowserScreen'], 'browser route');
    mustInclude(screen, ['BrowserEngineProvider', 'BrowserContainer'], 'BrowserScreen');
  });

  await test('WebView configuration enumerated in BrowserWebView', () => {
    const src = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(
      src,
      [
        'javaScriptEnabled',
        'domStorageEnabled',
        'sharedCookiesEnabled',
        'thirdPartyCookiesEnabled',
        'mixedContentMode',
        'setSupportMultipleWindows',
        'onShouldStartLoadWithRequest',
        'onOpenWindow',
        'resolveWebViewUserAgent',
      ],
      'BrowserWebView props',
    );
  });

  await test('navigation handler located', () => {
    const src = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(
      src,
      [
        'onShouldStartLoadWithRequest',
        'onNavigationStateChange',
        'logBrowserNav',
      ],
      'navigation handlers',
    );
  });

  await test('error handlers located', () => {
    const src = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(src, ['onError', 'onHttpError', 'logBrowserError'], 'error handlers');
  });

  await test('SSL handling path documented via diagnostics', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['logBrowserSsl', "classification === 'ssl'"], 'SSL diagnostics');
    const diagnostics = readSrc('src/browser/diagnostics/browser-runtime-diagnostics.service.ts');
    mustInclude(diagnostics, ['err_cert', 'ssl'], 'SSL classifier');
    const failure = readSrc('src/browser/services/browser-failure.service.ts');
    mustInclude(failure, ['SSL', 'ssl_error'], 'SSL failure mapping');
  });

  await test('cookie/session configuration located', () => {
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(
      webView,
      ['sharedCookiesEnabled', 'thirdPartyCookiesEnabled', 'domStorageEnabled'],
      'cookie props',
    );
    mustInclude(webView, ['logBrowserSession'], 'session diagnostics');
  });

  await test('history ownership located', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    const history = readSrc('src/browser/services/history-recording.service.ts');
    mustInclude(events, ['recordSuccessfulVisit', 'logBrowserHistory'], 'history trigger');
    mustInclude(history, ['isRecordableHistoryUrl'], 'history guards');
  });

  await test('Desktop Site implementation located', () => {
    const ua = readSrc('src/browser/constants/user-agent.ts');
    const menu = readSrc('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
    mustInclude(ua, ['buildBrowserUserAgent', 'DESKTOP_USER_AGENTS'], 'UA builder');
    mustInclude(menu, ['handleDesktopToggle', 'desktop_site'], 'desktop toggle');
  });

  await test('window.open/new-window handling located', () => {
    const src = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(
      src,
      ['setSupportMultipleWindows', 'onOpenWindow', 'logBrowserWindow'],
      'popup handling',
    );
    assert(
      src.includes('setSupportMultipleWindows={true}') ||
        src.includes('config.setSupportMultipleWindows'),
      'multiple windows must be enabled for popup dispatch',
    );
  });

  await test('external scheme handling located', () => {
    const nav = readSrc('src/browser/services/navigation.service.ts');
    const constants = readSrc('src/browser/constants/browser.constants.ts');
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(nav, ['openExternal', 'shouldHandleInBrowser', 'isExternalScheme'], 'navigation service');
    mustInclude(constants, ['BROWSER_EXTERNAL_SCHEMES'], 'external schemes');
    mustInclude(events, ["'external'"], 'external nav diagnostics');
  });

  await test('media bridge located', () => {
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    const host = readSrc('src/browser/BrowserScreen.tsx');
    mustInclude(webView, ['useMediaDetectionBridge'], 'media bridge hook');
    mustInclude(host, ['MediaDetectionHost', 'BrowserMediaDownloadBar'], 'media host + CTA');
  });

  await test('native interception hook located', () => {
    const hook = readSrc('scripts/apply-webview-media-hook.js');
    mustInclude(
      hook,
      ['shouldInterceptRequest', 'mediadetection.MediaNetworkBridge', 'super.shouldInterceptRequest'],
      'webview media hook',
    );
  });

  await test('DEV diagnostics present with required tags', () => {
    const src = readSrc('src/browser/diagnostics/browser-runtime-diagnostics.service.ts');
    for (const tag of BROWSER_DIAG_TAGS) {
      assert(src.includes(`'${tag}'`) || src.includes(`"${tag}"`), `Missing tag: ${tag}`);
    }
    mustInclude(src, ['sanitizeBrowserUrl', 'classifyBrowserLoadError'], 'diagnostics helpers');
  });

  await test('diagnostics sanitizer strips query/fragment', () => {
    const result = sanitizeBrowserUrl(
      'https://cdn.example.com/video.mp4?token=SECRET&id=123#frag',
    );
    assert(result.safeHost === 'cdn.example.com', 'host preserved');
    assert(result.safePathPattern === '/video.mp4', 'path pattern without query');
    assert(!JSON.stringify(result).includes('SECRET'), 'query stripped from output');
  });

  await test('diagnostics cannot log Cookie values', () => {
    const src = readSrc('src/browser/diagnostics/browser-runtime-diagnostics.service.ts');
    mustInclude(src, ["'cookie'", 'BLOCKED_KEYS'], 'cookie blocklist');
    mustNotInclude(src, ['getCookie', 'CookieManager'], 'cookie value reads');
  });

  await test('diagnostics cannot log Authorization', () => {
    const src = readSrc('src/browser/diagnostics/browser-runtime-diagnostics.service.ts');
    mustInclude(src, ["'authorization'"], 'authorization blocklist');
  });

  await test('error classifier recognizes aborted + ssl patterns', () => {
    assert(
      classifyBrowserLoadError({ description: 'net::ERR_CONNECTION_ABORTED' }) === 'aborted',
      'aborted pattern',
    );
    assert(
      classifyBrowserLoadError({ description: 'net::ERR_CERT_NOT_PERMITTED' }) === 'ssl',
      'cert pattern',
    );
  });

  await test('Phase 1 download modules not modified by browser diagnostics wiring', () => {
    for (const rel of PHASE1_DOWNLOAD_PATHS) {
      const src = readSrc(rel);
      mustNotInclude(src, ['logBrowserNav', 'BrowserNav', 'browser-runtime-diagnostics'], rel);
    }
  });

  await test('navigation epoch correlation available', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    const facade = readSrc('src/browser/hooks/useBrowserEngine.ts');
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(engine, ['navigationEpochRef'], 'tab-scoped engine epoch');
    mustInclude(facade, ['tabControllerRegistry'], 'active tab facade');
    mustInclude(events, ['navigationEpochRef', 'isStaleEvent'], 'stale guards');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
