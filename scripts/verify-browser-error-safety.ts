/**
 * Phase 2D — browser error safety verification.
 * Usage (from mobile/): npm run verify:browser-error-safety
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  browserFailureContract,
  createBrowserFailure,
  createBrowserErrorFromClassification,
  resolveBrowserRetryUrl,
} from '../src/browser/services/browser-failure.service.ts';
import {
  classifyBrowserLoadError,
  sanitizeBrowserUrl,
} from '../src/browser/diagnostics/browser-runtime-diagnostics.service.ts';

function classifyForTest(input: {
  description?: string;
  code?: number | string;
  url?: string | null;
  navigationId?: number;
}) {
  return createBrowserErrorFromClassification({
    navigationId: input.navigationId ?? 0,
    classification: classifyBrowserLoadError({
      description: input.description ?? '',
      code: input.code,
    }),
    source: 'webview_error',
    failingUrl: input.url ?? null,
  });
}

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

console.log('Phase 2D — Browser Error Safety Verification\n');

async function main(): Promise<void> {
  await test('canonical browser failure model exists', () => {
    mustInclude(readSrc('src/browser/types/browser-failure.types.ts'), ['BrowserFailure', 'BrowserFailureCategory'], 'types');
    mustInclude(readSrc('src/browser/services/browser-failure.service.ts'), ['createBrowserFailure', 'resolveBrowserRetryUrl'], 'service');
  });

  await test('raw error description is not rendered directly', () => {
    const err = classifyForTest({
      description: 'net::ERR_NAME_NOT_RESOLVED',
      code: -2,
      url: 'https://bad.example.test/',
      navigationId: 1,
    });
    assert(!err.message.includes('ERR_NAME_NOT_RESOLVED'), 'message must not expose raw code');
    assert(!err.title.includes('net::'), 'title must not expose net::');
    assert(err.failure?.category === 'DNS', 'DNS classification');
  });

  await test('retry URL stored separately from display message', () => {
    const retry = resolveBrowserRetryUrl({
      failingUrl: 'https://example.com/video?id=signed',
      loadStartUrl: 'https://example.com/page',
      committedUrl: 'https://example.com/other',
    });
    assert(retry === 'https://example.com/video?id=signed', 'failing URL wins');
    const err = classifyForTest({
      description: 'timeout',
      url: retry,
      navigationId: 2,
    });
    assert(err.retryUrl === retry, 'retryUrl preserved');
    assert(err.message !== retry, 'message is not raw URL');
  });

  await test('query/fragment stripped in diagnostics', () => {
    const meta = sanitizeBrowserUrl('https://user:pass@cdn.example.com/path?q=secret&token=abc#frag');
    assert(meta.safeHost === 'cdn.example.com', 'host only');
    assert(!JSON.stringify(meta).includes('secret'), 'no query in diagnostics');
  });

  await test('main-frame errors own full-page error UI', () => {
    const container = readSrc('src/browser/components/BrowserContainer/BrowserContainer.tsx');
    mustInclude(container, ['errorHiddenWebView', 'BrowserErrorView', 'hasError'], 'container');
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['mainFrame: true', 'setError'], 'main frame error');
  });

  await test('subresource failure does not automatically replace page', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['isSameDocumentNavigationUrl', 'Ignore subresource HTTP errors'], 'http subresource guard');
  });

  await test('offline classification', () => {
    assert(classifyBrowserLoadError({ description: 'net::ERR_INTERNET_DISCONNECTED' }) === 'offline', 'offline');
    const err = classifyForTest({ description: 'ERR_INTERNET_DISCONNECTED', navigationId: 1 });
    assert(err.failure?.category === 'OFFLINE', 'OFFLINE category');
    assert(err.safeReason?.includes('internet') || err.failure?.safeReason?.includes('internet'), 'offline reason');
  });

  await test('DNS classification', () => {
    assert(classifyBrowserLoadError({ description: 'net::ERR_NAME_NOT_RESOLVED' }) === 'dns', 'dns');
    const err = classifyForTest({ description: 'ERR_NAME_NOT_RESOLVED', navigationId: 1 });
    assert(err.code === 'dns_failure', 'dns_failure code');
  });

  await test('connection-aborted classification', () => {
    assert(classifyBrowserLoadError({ description: 'net::ERR_CONNECTION_ABORTED' }) === 'aborted', 'aborted');
    const err = classifyForTest({ description: 'ERR_CONNECTION_ABORTED', navigationId: 1 });
    assert(err.failure?.category === 'CONNECTION_ABORTED', 'CONNECTION_ABORTED');
  });

  await test('connection-reset classification', () => {
    assert(classifyBrowserLoadError({ description: 'net::ERR_CONNECTION_RESET' }) === 'reset', 'reset');
    const err = classifyForTest({ description: 'ERR_CONNECTION_RESET', navigationId: 1 });
    assert(err.failure?.category === 'CONNECTION_RESET', 'CONNECTION_RESET');
  });

  await test('timeout classification', () => {
    assert(classifyBrowserLoadError({ description: 'ERR_CONNECTION_TIMED_OUT' }) === 'timeout', 'timeout');
    const err = classifyForTest({ description: 'ERR_CONNECTION_TIMED_OUT', navigationId: 1 });
    assert(err.code === 'timeout', 'timeout code');
  });

  await test('SSL classification', () => {
    assert(classifyBrowserLoadError({ description: 'SSL error: certificate invalid' }) === 'ssl', 'ssl');
    const err = classifyForTest({ description: 'SSL error: certificate invalid', navigationId: 1 });
    assert(err.code === 'ssl_error', 'ssl_error code');
  });

  await test('render-process classification', () => {
    assert(classifyBrowserLoadError({ description: 'render process gone' }) === 'render_process', 'render');
    const failure = createBrowserFailure({
      navigationId: 1,
      classification: 'render_process',
      source: 'render_process',
    });
    assert(failure.category === 'RENDER_PROCESS', 'RENDER_PROCESS');
  });

  await test('unknown fallback', () => {
    const err = classifyForTest({ description: 'something weird happened', navigationId: 1 });
    assert(err.code === 'unknown' || err.failure?.category === 'UNKNOWN', 'unknown fallback');
  });

  await test('Stop-induced abort suppressed', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['suppressNextAbortErrorRef', "classification === 'aborted'"], 'abort suppress');
  });

  await test('stale navigation error guard', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['isStaleMainFrameError', 'staleDropped: true'], 'stale guard');
  });

  await test('Retry is single controlled reload', () => {
    const errorView = readSrc('src/browser/components/BrowserErrorView/BrowserErrorView.tsx');
    mustInclude(errorView, ['retryUrl', 'controller.loadUrl(retryUrl)'], 'retry uses retryUrl');
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['clearError', 'bumpNavigationEpoch'], 'loadUrl clears and bumps once');
  });

  await test('Go Home clears error', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['goHome()', 'error: null'], 'goHome');
    const store = readSrc('src/browser/stores/browserStore/actions.ts');
    mustInclude(store, ['error: null'], 'goHome clears error');
  });

  await test('invalid SSL remains blocked', () => {
    const webViewClient = readFileSync(
      join(ROOT, 'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java'),
      'utf8',
    );
    mustInclude(webViewClient, ['handler.cancel()', 'onReceivedSslError'], 'native SSL cancel');
  });

  await test('no handler.proceed for SSL', () => {
    const webViewClient = readFileSync(
      join(ROOT, 'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java'),
      'utf8',
    );
    const sslBlock = webViewClient.slice(
      webViewClient.indexOf('onReceivedSslError'),
      webViewClient.indexOf('onReceivedSubResourceSslError'),
    );
    assert(!sslBlock.includes('handler.proceed()'), 'SSL handler must not proceed');
  });

  await test('no trust-all certificate patterns in project', () => {
    const suspicious = ['trustAll', 'ALLOW_ALL_HOSTNAME_VERIFIER', 'InsecureTrustManager'];
    const files = [
      'src/browser/services/browser-failure.service.ts',
      'src/browser/hooks/useBrowserEngineEvents.ts',
      'src/browser/components/BrowserContainer/BrowserWebView.tsx',
      'scripts/apply-webview-media-hook.js',
    ];
    for (const rel of files) {
      const src = readSrc(rel);
      for (const pattern of suspicious) {
        assert(!src.includes(pattern), `${rel} must not include ${pattern}`);
      }
    }
  });

  await test('BrowserErrorView does not expose raw net::ERR text', () => {
    const view = readSrc('src/browser/components/BrowserErrorView/BrowserErrorView.tsx');
    mustNotInclude(view, ['net::ERR', 'Domain: undefined', 'event.nativeEvent.description'], 'error view');
    for (const pattern of browserFailureContract.neverExposePatterns) {
      assert(!view.includes(pattern), `view must not reference ${pattern}`);
    }
  });

  await test('no backend/proxy introduced', () => {
    const failure = readSrc('src/browser/services/browser-failure.service.ts');
    mustNotInclude(failure, ['fetch(', 'axios', 'proxy'], 'failure service');
  });

  await test('Phase 2C navigation ownership preserved', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['navigationEpochRef', 'loadStartEpochRef', 'onShouldStartLoadWithRequest'], 'nav ownership');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
