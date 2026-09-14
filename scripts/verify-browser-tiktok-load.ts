/**
 * Phase 2F — TikTok / timeout / error-ownership regression.
 * Usage (from mobile/): npm run verify:browser-tiktok-load
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describePlatformPage } from '../src/media-detection/platform/registry.ts';
import {
  classifyBrowserLoadError,
  sanitizeBrowserUrl,
} from '../src/browser/diagnostics/browser-runtime-diagnostics.service.ts';
import {
  createBrowserErrorFromClassification,
  resolveBrowserRetryUrl,
} from '../src/browser/services/browser-failure.service.ts';

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

console.log('Phase 2F — TikTok Load + Timeout Ownership Verification\n');

async function main(): Promise<void> {
  await test('main-frame timeout with defined URL → TIMEOUT BrowserFailure', () => {
    const err = createBrowserErrorFromClassification({
      navigationId: 1,
      classification: classifyBrowserLoadError({
        description: 'net::ERR_TIMED_OUT',
        code: -8,
      }),
      source: 'webview_error',
      failingUrl: 'https://www.tiktok.com/',
    });
    assert(err.failure?.category === 'TIMEOUT', 'TIMEOUT category');
    assert(err.code === 'timeout', 'timeout code');
    assert(err.retryUrl === 'https://www.tiktok.com/', 'retry URL');
  });

  await test('main-frame timeout with native URL undefined → fallback retry URL', () => {
    const err = createBrowserErrorFromClassification({
      navigationId: 2,
      classification: 'timeout',
      source: 'webview_error',
      failingUrl: null,
      loadStartUrl: 'https://www.tiktok.com/',
      committedUrl: 'https://www.tiktok.com/',
      errorCode: -8,
    });
    assert(err.failure?.category === 'TIMEOUT', 'TIMEOUT');
    assert(err.retryUrl === 'https://www.tiktok.com/', 'fallback retry');
    assert(!err.message.includes('ERR_TIMED_OUT'), 'no raw ERR in message');
    assert(err.safeReason === 'Page took too long to respond', 'safe timeout reason');
  });

  await test('resolveBrowserRetryUrl prefers failing → loadStart → committed', () => {
    assert(
      resolveBrowserRetryUrl({
        failingUrl: null,
        loadStartUrl: 'https://www.tiktok.com/foryou',
        committedUrl: 'https://www.tiktok.com/',
      }) === 'https://www.tiktok.com/foryou',
      'loadStart wins when failing missing',
    );
  });

  await test('chrome load seeds loadStart epoch before native onLoadStart', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['seedActiveDocumentLoad', 'loadStartEpochRef', 'loadStartUrlRef'], 'seed');
    mustInclude(engine, ['describePlatformPage'], 'platform before load');
  });

  await test('stale timeout guard does not drop current intentional URL', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['isStaleMainFrameError', 'Domain: undefined', 'matchesIntent'], 'ownership');
    // Phase 3D+: intentional URL is tab-owned chrome, not global state.currentUrl.
    mustInclude(events, ['loadStartUrlRef.current ?? owning.url'], 'intentional URL fallback');
  });

  await test('BrowserErrorView hides raw WebView document', () => {
    const container = readSrc('src/browser/components/BrowserContainer/BrowserContainer.tsx');
    mustInclude(container, ['errorHiddenWebView', 'hasError'], 'suppress webview');
    const view = readSrc('src/browser/components/BrowserErrorView/BrowserErrorView.tsx');
    mustNotInclude(view, ['Domain:', 'Error Code', 'net::ERR'], 'no raw chromium copy');
  });

  await test('safe timeout reason shown; raw net::ERR_TIMED_OUT not rendered', () => {
    const failure = readSrc('src/browser/services/browser-failure.service.ts');
    mustInclude(failure, ['Page took too long to respond'], 'safe reason');
    const view = readSrc('src/browser/components/BrowserErrorView/BrowserErrorView.tsx');
    mustInclude(view, ['safeReason'], 'renders safeReason');
    assert(!view.includes('ERR_TIMED_OUT'), 'no ERR_TIMED_OUT in view');
  });

  await test('Retry preserves intended URL; Go Home clears failure', () => {
    const view = readSrc('src/browser/components/BrowserErrorView/BrowserErrorView.tsx');
    mustInclude(view, ['retryUrl', 'loadUrl(retryUrl)', 'goHome'], 'retry/home');
    const actions = readSrc('src/browser/stores/browserStore/actions.ts');
    mustInclude(actions, ['error: null'], 'goHome clears');
  });

  await test('intentional Stop abort still suppressed', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['suppressNextAbortErrorRef', "classification === 'aborted'"], 'stop suppress');
  });

  await test('TikTok never auto-forces Desktop WebView (homepage or video)', () => {
    const home = describePlatformPage('https://www.tiktok.com/');
    assert(home.kind === 'tiktok', 'tiktok kind');
    assert(home.prefersDesktopWebView === false, 'homepage mobile UA');
    const video = describePlatformPage('https://www.tiktok.com/@user/video/1234567890123456789');
    assert(video.kind === 'tiktok', 'tiktok video');
    assert(video.isPublicContentPath === true, 'content path');
    assert(video.prefersDesktopWebView === false, 'video stays mobile UA (no platform desktop)');
  });

  await test('platform Desktop applied before sourceUri on chrome load', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    // Per-tab Desktop: setDesktopMode(..., { source: 'platform', tabId }) before setSourceUri.
    const platformIdx = engine.indexOf("source: 'platform'");
    const sourceIdx = engine.indexOf('setSourceUri(trimmed)');
    assert(platformIdx > 0 && sourceIdx > platformIdx, 'desktop before sourceUri');
    mustInclude(engine, ['tabId'], 'per-tab Desktop ownership on chrome load');
  });

  await test('media sync must never flip Desktop (Phase 3D)', () => {
    const sync = readSrc('src/media-detection/hooks/useMediaDetectionBrowserSync.ts');
    mustNotInclude(sync, ['setDesktopMode'], 'no Desktop mutation from media sync');
    mustInclude(sync, ['never mutates', 'Desktop'], 'documents Desktop ownership');
  });

  await test('about:blank transient ignore while real sourceUri committed', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['ignore_transient_blank', 'BROWSER_WEBVIEW_BLANK'], 'blank guard');
  });

  await test('desktop UA prop frozen while tab loading (not only reload)', () => {
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(
      webView,
      ['appliedDesktopMode', 'deferredDesktopReloadRef', 'tabLoading'],
      'freeze UA mid-load',
    );
  });

  await test('mobile WebView uses stock system UA (omit userAgent prop)', () => {
    const ua = readSrc('src/browser/constants/user-agent.ts');
    mustInclude(ua, ['resolveWebViewUserAgent', 'return undefined', 'includeBrandToken'], 'stock UA policy');
    assert(ua.includes('BROWSER_USER_AGENT_BRAND_TOKEN'), 'token exists for opt-in only');
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(webView, ['resolveWebViewUserAgentForTab', '...(userAgent ? { userAgent } : {})'], 'omit prop');
    mustNotInclude(
      webView,
      ['applicationNameForUserAgent={'],
      'no applicationName branding on WebView',
    );
    const config = readSrc('src/browser/webview/webview-configuration.ts');
    assert(
      config.includes('applicationNameForUserAgent: undefined'),
      'config disables applicationName branding',
    );
  });

  await test('onLoadStart / setLoading must not clear branded BrowserFailure', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['Do NOT clearError here', 'Chromium error document'], 'no clear on loadStart');
    assert(!/onLoadStart[\s\S]{0,400}clearError\(\)/.test(events), 'clearError not called in onLoadStart');
    const actions = readSrc('src/browser/stores/browserStore/actions.ts');
    mustInclude(actions, ['Preserve BrowserFailure', 'error: state.error'], 'setLoading preserves');
    mustInclude(actions, ['Keep branded failure visible'], 'navState preserves');
  });

  await test('mobile UA builder remains Android Chrome-like (static fallback)', () => {
    const ua = readSrc('src/browser/constants/user-agent.ts');
    mustInclude(ua, ['Android 14; Mobile', 'DESKTOP_USER_AGENTS', 'X11; Linux x86_64'], 'UA templates');
    const meta = sanitizeBrowserUrl('https://www.tiktok.com/?lang=en');
    assert(meta.safeHost === 'www.tiktok.com', 'host sanitize');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
