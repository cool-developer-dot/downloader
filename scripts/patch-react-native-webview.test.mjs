import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./patch-react-native-webview.js', import.meta.url));
const { patchReactNativeWebView } = createRequire(import.meta.url)(SCRIPT);

const SOURCE_DIR = path.join('android', 'src', 'main', 'java', 'com', 'reactnativecommunity', 'webview');
const CLIENT = 'RNCWebViewClient.java';
const MANAGER = 'RNCWebViewManagerImpl.kt';
const VIEW = 'RNCWebView.java';
const HOOKS = 'RNCWebViewHooks.java';

// Excerpts of react-native-webview 13.16.1 around the patch anchors, verbatim; "// …" marks omitted code.

const PRISTINE_CLIENT = `    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        // …
            try {
                assert lockObject != null;
                synchronized (lockObject) {
                    final long startTime = SystemClock.elapsedRealtime();
                    while (lockObject.get() == RNCWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState.UNDECIDED) {
                        if (SystemClock.elapsedRealtime() - startTime > SHOULD_OVERRIDE_URL_LOADING_TIMEOUT) {
                            FLog.w(TAG, "Did not receive response to shouldOverrideUrlLoading in time, defaulting to allow loading.");
                            RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                            return false;
                        }
                        lockObject.wait(SHOULD_OVERRIDE_URL_LOADING_TIMEOUT);
                    }
                }
            } catch (InterruptedException e) {
                FLog.e(TAG, "shouldOverrideUrlLoading was interrupted while waiting for result.", e);
                RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                return false;
            }
        // …
    }

    @TargetApi(Build.VERSION_CODES.N)
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        final String url = request.getUrl().toString();
        return this.shouldOverrideUrlLoading(view, url);
    }

    @Override
    public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
`;

// The same excerpt as left by the v1 script (scripts/apply-webview-media-hook.js).
const V1_CLIENT = `    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        // …
            try {
                assert lockObject != null;
                synchronized (lockObject) {
                    final long startTime = SystemClock.elapsedRealtime();
                    while (lockObject.get() == RNCWebViewModuleImpl.ShouldOverrideUrlLoadingLock.ShouldOverrideCallbackState.UNDECIDED) {
                        if (SystemClock.elapsedRealtime() - startTime > SHOULD_OVERRIDE_URL_LOADING_TIMEOUT) {
                            FLog.w(TAG, "Did not receive response to shouldOverrideUrlLoading in time.");
                            RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                            // VidoraX: never default-allow custom schemes (TikTok snssdk).
                            // HTTP(S) still default-allow so a slow JS bridge does not freeze pages.
                            if (url != null) {
                                String lower = url.toLowerCase();
                                if (lower.startsWith("http:") || lower.startsWith("https:") || lower.startsWith("about:")) {
                                    return false;
                                }
                            }
                            return true;
                        }
                        lockObject.wait(SHOULD_OVERRIDE_URL_LOADING_TIMEOUT);
                    }
                }
            } catch (InterruptedException e) {
                FLog.e(TAG, "shouldOverrideUrlLoading was interrupted while waiting for result.", e);
                RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                if (url != null) {
                    String lower = url.toLowerCase();
                    if (lower.startsWith("http:") || lower.startsWith("https:") || lower.startsWith("about:")) {
                        return false;
                    }
                }
                return true;
            }
        // …
    }

    @TargetApi(Build.VERSION_CODES.N)
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        final String url = request.getUrl().toString();
        return this.shouldOverrideUrlLoading(view, url);
    }

    /**
     * VidoraX: passive media observation. Never replaces the response.
     * Observation is filtered + rate-limited inside MediaNetworkBridge.
     */
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        try {
            // Reflection avoids a compile-time dependency on the host app package.
            Class<?> bridge = Class.forName("com.anonymous.vidorax.mediadetection.MediaNetworkBridge");
            bridge.getMethod("observeRequest", WebView.class, WebResourceRequest.class)
                    .invoke(null, view, request);
        } catch (Throwable ignored) {
            // Detection must never break browsing.
        }
        return super.shouldInterceptRequest(view, request);
    }


    @Override
    public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
`;

const MANAGER_SOURCE = `    fun createViewInstance(context: ThemedReactContext, webView: RNCWebView): RNCWebViewWrapper {
        setupWebChromeClient(webView)
        // …
        webView.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimetype, contentLength ->
            val module = webView.reactApplicationContext.getNativeModule(RNCWebViewModule::class.java) ?: return@DownloadListener
            // …
        })
        return RNCWebViewWrapper(context, webView)
    }

    private fun setupWebChromeClient(
    // …
    fun setInjectedJavaScriptBeforeContentLoaded(viewWrapper: RNCWebViewWrapper, value: String?) {
        val view = viewWrapper.webView
        view.injectedJSBeforeContentLoaded = value
    }

    fun setInjectedJavaScriptForMainFrameOnly(viewWrapper: RNCWebViewWrapper, value: Boolean) {
`;

const VIEW_SOURCE = `    public void callInjectedJavaScriptBeforeContentLoaded() {
        if (getSettings().getJavaScriptEnabled() &&
                injectedJSBeforeContentLoaded != null &&
                !TextUtils.isEmpty(injectedJSBeforeContentLoaded)) {
            evaluateJavascriptWithFallback("(function() {\\n" + injectedJSBeforeContentLoaded + ";\\n})();");
            injectJavascriptObject();  // re-inject the Javascript object in case it has been overwritten.
        }
    }
`;

function createPackage(t, { client, manager, view = VIEW_SOURCE }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnwv-patch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, SOURCE_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'react-native-webview', version: '13.16.1' }));
  fs.writeFileSync(path.join(dir, SOURCE_DIR, CLIENT), client);
  fs.writeFileSync(path.join(dir, SOURCE_DIR, MANAGER), manager);
  fs.writeFileSync(path.join(dir, SOURCE_DIR, VIEW), view);
  return dir;
}

function readSources(dir) {
  const read = (name) => {
    const file = path.join(dir, SOURCE_DIR, name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  return { client: read(CLIENT), manager: read(MANAGER), view: read(VIEW), hooks: read(HOOKS) };
}

function runScript(dir) {
  return spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
}

const occurrences = (text, part) => text.split(part).length - 1;

test('patches a pristine install', (t) => {
  const dir = createPackage(t, { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE });

  assert.deepEqual(patchReactNativeWebView(dir), [CLIENT, MANAGER, VIEW, HOOKS]);

  const { client, manager, view, hooks } = readSources(dir);
  assert.equal(occurrences(client, 'RNCWebViewHooks.observeRequest(view, request);'), 1);
  assert.equal(occurrences(client, 'return RNCWebViewHooks.cancelsUndecidedNavigation(url);'), 2);
  assert.ok(!client.includes('defaulting to allow loading'));
  assert.match(
    manager,
    /DownloadListener \{[^\n]*\n\s+if \(RNCWebViewHooks\.onDownloadStart\(webView, url, userAgent, contentDisposition, mimetype, contentLength\)\) \{\n\s+return@DownloadListener\n\s+\}\n\s+val module =/,
  );
  assert.match(manager, /RNCWebViewHooks\.onWebViewCreated\(webView\)\n\s+return RNCWebViewWrapper\(context, webView\)/);
  assert.match(hooks, /public final class RNCWebViewHooks/);
  assert.match(hooks, /private static volatile Listener listener;/);
  // The before-content-loaded script runs at document start (main frame only) instead of from onPageStarted.
  assert.match(
    manager,
    /view\.injectedJSBeforeContentLoaded = value\n\s+RNCWebViewHooks\.setDocumentStartScript\(view, value\)\n\s+\}/,
  );
  assert.match(
    view,
    /callInjectedJavaScriptBeforeContentLoaded\(\) \{\n\s+if \(RNCWebViewHooks\.hasDocumentStartScript\(this\)\) \{\n\s+injectJavascriptObject\(\);\n\s+return;\n\s+\}/,
  );
  assert.match(hooks, /WebViewCompat\.addDocumentStartJavaScript\(webView, mainFrameOnly, ALL_ORIGINS\)/);
  assert.match(hooks, /if \(window !== window\.top\) \{ return; \}/);
  assert.match(hooks, /WebViewFeature\.isFeatureSupported\(WebViewFeature\.DOCUMENT_START_SCRIPT\)/);
});

test('migrates the v1 patch to the same sources as a pristine install', (t) => {
  const pristine = createPackage(t, { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE });
  const v1 = createPackage(t, { client: V1_CLIENT, manager: MANAGER_SOURCE });

  patchReactNativeWebView(pristine);
  patchReactNativeWebView(v1);

  const migrated = readSources(v1);
  assert.deepEqual(migrated, readSources(pristine));
  assert.ok(!migrated.client.includes('Class.forName'));
  assert.ok(!migrated.client.includes('MediaNetworkBridge'));
});

test('applying twice is a no-op', (t) => {
  const dir = createPackage(t, { client: V1_CLIENT, manager: MANAGER_SOURCE });
  patchReactNativeWebView(dir);
  const once = readSources(dir);

  const result = runScript(dir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Already patched/);
  assert.deepEqual(readSources(dir), once);
});

test('fails loudly and writes nothing when an anchor is missing', (t) => {
  const manager = MANAGER_SOURCE.replace('            val module =', '            val webViewModule =');
  const dir = createPackage(t, { client: PRISTINE_CLIENT, manager });

  const result = runScript(dir);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /RNCWebViewManagerImpl\.kt: anchor not found for "hand downloads to the hook before DownloadManager" \(react-native-webview 13\.16\.1\)/,
  );
  assert.deepEqual(readSources(dir), { client: PRISTINE_CLIENT, manager, view: VIEW_SOURCE, hooks: null });
});

test('fails when react-native-webview is not installed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnwv-missing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = runScript(path.join(dir, 'react-native-webview'));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /react-native-webview is not installed/);
});
