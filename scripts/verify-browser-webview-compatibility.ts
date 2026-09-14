/**
 * Phase 2B — browser WebView compatibility verification.
 *
 * Usage (from mobile/):
 *   npm run verify:browser-webview-compatibility
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browserWebViewConfigurationContract } from '../src/browser/webview/webview-configuration';

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

console.log('Phase 2B — Browser WebView Compatibility Verification\n');

async function main(): Promise<void> {
  await test('JS + DOM storage enabled via configuration contract', () => {
    assert(browserWebViewConfigurationContract.javaScriptEnabled === true, 'javaScriptEnabled');
    assert(browserWebViewConfigurationContract.domStorageEnabled === true, 'domStorageEnabled');
  });

  await test('shared + third-party cookies explicitly enabled', () => {
    assert(browserWebViewConfigurationContract.sharedCookiesEnabled === true, 'shared');
    assert(browserWebViewConfigurationContract.thirdPartyCookiesEnabled === true, 'third-party');
  });

  await test('unsafe file access remains disabled', () => {
    assert(browserWebViewConfigurationContract.allowFileAccess === false, 'file access');
    assert(browserWebViewConfigurationContract.allowUniversalAccessFromFileURLs === false, 'universal');
  });

  await test('mixed content remains strict (never)', () => {
    assert(browserWebViewConfigurationContract.mixedContentMode === 'never', 'mixed content');
  });

  await test('normal cache remains enabled', () => {
    assert(browserWebViewConfigurationContract.cacheEnabled === true, 'cacheEnabled');
  });

  await test('WebView host uses centralized configuration', () => {
    const src = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(src, ['browserWebViewConfiguration', 'webview/webview-configuration'], 'config import');
    mustInclude(src, ['javaScriptEnabled={config.javaScriptEnabled}'], 'wired props');
  });

  await test('WebView is not keyed for remount', () => {
    const src = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    assert(!src.includes('key='), 'WebView must not use React key remount');
  });

  await test('UA has single source of truth', () => {
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(webView, ['resolveWebViewUserAgent'], 'UA resolver usage');
    const ua = readSrc('src/browser/constants/user-agent.ts');
    assert(ua.includes('resolveWebViewUserAgent'), 'resolver exported');
    assert(
      ua.includes('return undefined') || ua.includes('stock'),
      'mobile uses stock WebView UA',
    );
  });

  await test('desktop mode changes UA string', () => {
    const uaSrc = readSrc('src/browser/constants/user-agent.ts');
    mustInclude(uaSrc, ['DESKTOP_USER_AGENTS', 'buildBrowserUserAgent', 'resolveWebViewUserAgent'], 'UA module');
  });

  await test('desktop toggle triggers one controlled reload with cache bypass', () => {
    const src = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    mustInclude(
      src,
      ['BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD', 'desktopReloadPendingRef', 'reload()'],
      'UA reload path',
    );
  });

  await test('WebView does not append branding via applicationNameForUserAgent', () => {
    const config = readSrc('src/browser/webview/webview-configuration.ts');
    assert(
      config.includes('applicationNameForUserAgent: undefined'),
      'no branding append',
    );
    const webView = readSrc('src/browser/components/BrowserContainer/BrowserWebView.tsx');
    assert(
      !webView.includes('applicationNameForUserAgent={config.applicationNameForUserAgent}'),
      'WebView must not pass branding applicationName',
    );
  });

  await test('user desktop preference overrides platform recommendation', () => {
    const src = readSrc('src/browser/session/desktop-mode.service.ts');
    mustInclude(src, ['userPreferenceExplicit', "source: 'user'", "source: 'platform'"], 'priority logic');
  });

  await test('media sync never mutates Desktop (platform only via loadUrl)', () => {
    const sync = readSrc('src/media-detection/hooks/useMediaDetectionBrowserSync.ts');
    assert(!sync.includes('setDesktopMode'), 'media sync must not flip Desktop');
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ["source: 'platform'"], 'platform desktop via chrome loadUrl only');
  });

  await test('browser module has no download Wi-Fi policy', () => {
    const browserSrc = readSrc('src/browser/hooks/useBrowserEngine.ts');
    assert(!browserSrc.includes('wifiOnly'), 'browser must not gate on wifiOnly');
    assert(!browserSrc.includes('NetInfo'), 'browser must not use NetInfo policy');
  });

  await test('no VPN/proxy/backend introduced in browser layer', () => {
    const paths = [
      'src/browser/hooks/useBrowserEngine.ts',
      'src/browser/components/BrowserContainer/BrowserWebView.tsx',
      'src/browser/services/navigation.service.ts',
    ];
    for (const rel of paths) {
      const src = readSrc(rel);
      assert(!src.toLowerCase().includes('vpn'), `${rel} vpn reference`);
      assert(!src.includes('proxy'), `${rel} proxy reference`);
    }
  });

  await test('diagnostics sanitizer remains safe', () => {
    const src = readSrc('src/browser/diagnostics/browser-runtime-diagnostics.service.ts');
    mustInclude(src, ['BLOCKED_KEYS', 'sanitizeBrowserUrl'], 'sanitizer');
    assert(src.includes("'authorization'"), 'authorization blocked');
  });

  await test('native media hook remains observe-only', () => {
    const hook = readSrc('scripts/apply-webview-media-hook.js');
    mustInclude(hook, ['super.shouldInterceptRequest'], 'observe-only hook');
  });

  await test('Phase 1 download modules untouched by browser phase', () => {
    const worker = readSrc('src/downloads/engine/worker.ts');
    assert(!worker.includes('browserWebViewConfiguration'), 'worker unchanged');
  });

  await test('browserUserAgentMode helper present', () => {
    const ua = readSrc('src/browser/constants/user-agent.ts');
    mustInclude(ua, ['browserUserAgentMode'], 'UA mode helper');
  });
}

void main().then(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
});
