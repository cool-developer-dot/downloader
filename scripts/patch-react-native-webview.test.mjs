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

const VIEW_SOURCE = `    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
      if(menuCustomItems == null ){
        return super.startActionMode(callback, type);
      }

      return super.startActionMode(new ActionMode.Callback2() {
      // …
    }

    public void callInjectedJavaScriptBeforeContentLoaded() {
        if (getSettings().getJavaScriptEnabled() &&
                injectedJSBeforeContentLoaded != null &&
                !TextUtils.isEmpty(injectedJSBeforeContentLoaded)) {
            evaluateJavascriptWithFallback("(function() {\\n" + injectedJSBeforeContentLoaded + ";\\n})();");
            injectJavascriptObject();  // re-inject the Javascript object in case it has been overwritten.
        }
    }
`;

// B11: excerpt of react-native-webview 13.16.1 android/src/newarch/.../RNCWebViewManager.java around the anchor.
const NEWARCH_DIR = path.join('android', 'src', 'newarch', 'com', 'reactnativecommunity', 'webview');
const NEWARCH_MANAGER = 'RNCWebViewManager.java';
const NEWARCH_MANAGER_SOURCE = `    @NonNull
    @Override
    public String getName() {
        return RNCWebViewManagerImpl.NAME;
    }

    @NonNull
    @Override
    protected RNCWebViewWrapper createViewInstance(@NonNull ThemedReactContext context) {
        return mRNCWebViewManagerImpl.createViewInstance(context);
    }

    @Override
    @ReactProp(name = "allowFileAccess")
    public void setAllowFileAccess(RNCWebViewWrapper view, boolean value) {
`;

// B11: excerpt of react-native-webview 13.16.1 src/RNCWebViewNativeComponent.ts around the anchor.
const SPEC = 'RNCWebViewNativeComponent.ts';
const SPEC_SOURCE = `  allowFileAccessFromFileURLs?: boolean;
  allowUniversalAccessFromFileURLs?: boolean;
  applicationNameForUserAgent?: string;
  basicAuthCredential?: Readonly<{
`;

function createPackage(t, { client, manager, view = VIEW_SOURCE, newarch = null, spec = SPEC_SOURCE }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnwv-patch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, SOURCE_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'react-native-webview', version: '13.16.1' }));
  fs.writeFileSync(path.join(dir, SOURCE_DIR, CLIENT), client);
  fs.writeFileSync(path.join(dir, SOURCE_DIR, MANAGER), manager);
  fs.writeFileSync(path.join(dir, SOURCE_DIR, VIEW), view);
  if (newarch != null) {
    fs.mkdirSync(path.join(dir, NEWARCH_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, NEWARCH_DIR, NEWARCH_MANAGER), newarch);
    if (spec != null) {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', SPEC), spec);
    }
  }
  return dir;
}

const readSpec = (dir) => fs.readFileSync(path.join(dir, 'src', SPEC), 'utf8');

const readNewarch = (dir) => fs.readFileSync(path.join(dir, NEWARCH_DIR, NEWARCH_MANAGER), 'utf8');

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
  // B20: the hook sees a new WebView before anything else touches it (a profile can only be set then).
  assert.match(
    manager,
    /RNCWebViewWrapper \{\n\s+RNCWebViewHooks\.beforeWebViewSetup\(webView\)\n\s+setupWebChromeClient\(webView\)/,
  );
  assert.match(hooks, /void beforeWebViewSetup\(@NonNull RNCWebView webView\);/);
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
  // B8: the selection menu goes through the hook (Android's own items kept); custom menuItems still replace it.
  assert.match(
    view,
    /if\(menuCustomItems == null \)\{\n\s+return super\.startActionMode\(RNCWebViewHooks\.wrapSelectionMenu\(this, callback\), type\);\n\s+\}/,
  );
  assert.match(hooks, /default ActionMode\.Callback wrapSelectionMenu\(@NonNull RNCWebView webView, @NonNull ActionMode\.Callback callback\)/);
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

// B16: the client as left by this script before the interceptRequest hook (observeRequest only).
const OBSERVE_ONLY_CLIENT = PRISTINE_CLIENT.replace(
  `            } catch (InterruptedException e) {
                FLog.e(TAG, "shouldOverrideUrlLoading was interrupted while waiting for result.", e);
                RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                return false;
            }`,
  `            } catch (InterruptedException e) {
                FLog.e(TAG, "shouldOverrideUrlLoading was interrupted while waiting for result.", e);
                RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                return RNCWebViewHooks.cancelsUndecidedNavigation(url);
            }`,
).replace(
  `                            FLog.w(TAG, "Did not receive response to shouldOverrideUrlLoading in time, defaulting to allow loading.");
                            RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                            return false;`,
  `                            FLog.w(TAG, "Did not receive response to shouldOverrideUrlLoading in time.");
                            RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                            return RNCWebViewHooks.cancelsUndecidedNavigation(url);`,
).replace(
  `        return this.shouldOverrideUrlLoading(view, url);
    }
`,
  `        return this.shouldOverrideUrlLoading(view, url);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        RNCWebViewHooks.observeRequest(view, request);
        return super.shouldInterceptRequest(view, request);
    }
`,
);

test('B16: one shouldInterceptRequest override; observeRequest first, then the interceptRequest hook may answer', (t) => {
  const dir = createPackage(t, { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE });
  patchReactNativeWebView(dir);
  const { client, hooks } = readSources(dir);

  assert.equal(occurrences(client, 'public WebResourceResponse shouldInterceptRequest('), 1);
  assert.match(
    client,
    /RNCWebViewHooks\.observeRequest\(view, request\);\s+WebResourceResponse hookResponse = RNCWebViewHooks\.interceptRequest\(view, request\);\s+if \(hookResponse != null\) \{\s+return hookResponse;\s+\}\s+return super\.shouldInterceptRequest\(view, request\);/,
  );
  // The Listener method defaults to null (load normally); the dispatcher never lets a failure break the request.
  assert.match(
    hooks,
    /@Nullable\s+default WebResourceResponse interceptRequest\(@NonNull WebView view, @NonNull WebResourceRequest request\) \{\s+return null;\s+\}/,
  );
  assert.match(hooks, /import android\.webkit\.WebResourceResponse;/);
  assert.match(hooks, /logFailure\("interceptRequest", e\);\s+return null;/);
});

test('B16: sources patched before the interceptRequest hook end up the same as a pristine install', (t) => {
  const pristine = createPackage(t, { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE });
  const observeOnly = createPackage(t, { client: OBSERVE_ONLY_CLIENT, manager: MANAGER_SOURCE });
  assert.equal(occurrences(OBSERVE_ONLY_CLIENT, 'RNCWebViewHooks.observeRequest(view, request);'), 1);

  patchReactNativeWebView(pristine);
  patchReactNativeWebView(observeOnly);

  const migrated = readSources(observeOnly);
  assert.deepEqual(migrated, readSources(pristine));
  assert.equal(occurrences(migrated.client, 'public WebResourceResponse shouldInterceptRequest('), 1);
  assert.equal(occurrences(migrated.client, 'RNCWebViewHooks.interceptRequest(view, request)'), 1);

  // And a second run (the next npm install) changes nothing.
  const result = runScript(observeOnly);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Already patched/);
  assert.deepEqual(readSources(observeOnly), migrated);
});

test('B11: the new-architecture manager hands the initial webProfile prop to beforeWebViewSetup', (t) => {
  const dir = createPackage(t, { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE, newarch: NEWARCH_MANAGER_SOURCE });

  assert.deepEqual(patchReactNativeWebView(dir), [CLIENT, MANAGER, VIEW, NEWARCH_MANAGER, SPEC, HOOKS]);
  const manager = readNewarch(dir);
  const spec = readSpec(dir);
  const { hooks } = readSources(dir);

  // The new architecture only sends declared props: the spec declares webProfile, and the manager accepts it (no-op).
  assert.equal(occurrences(spec, '  webProfile?: string;\n'), 1);
  assert.match(
    manager,
    /@Override\s+@ReactProp\(name = "webProfile"\)\s+public void setWebProfile\(RNCWebViewWrapper view, @Nullable String value\) \{\s+\}/,
  );

  // One 4-argument override; the pending name is set before super and cleared in finally.
  assert.equal(occurrences(manager, 'protected RNCWebViewWrapper createViewInstance('), 2);
  assert.match(
    manager,
    /RNCWebViewHooks\.setPendingWebProfile\(RNCWebViewHooks\.webProfileProp\(initialProps\)\);\s+try \{\s+return super\.createViewInstance\(reactTag, context, initialProps, stateWrapper\);\s+\} finally \{\s+RNCWebViewHooks\.setPendingWebProfile\(null\);\s+\}/,
  );
  // The dispatcher takes the pending name once; without one, normal WebViews get beforeWebViewSetup as before.
  assert.match(hooks, /String webProfile = pendingWebProfile;\s+pendingWebProfile = null;/);
  assert.match(hooks, /if \(webProfile != null\) \{\s+current\.beforeWebViewSetupInProfile\(webView, webProfile\);\s+\} else \{\s+current\.beforeWebViewSetup\(webView\);/);
  assert.match(
    hooks,
    /default void beforeWebViewSetupInProfile\(@NonNull RNCWebView webView, @NonNull String webProfile\) \{\s+beforeWebViewSetup\(webView\);/,
  );
  assert.match(hooks, /import com\.facebook\.react\.uimanager\.ReactStylesDiffMap;/);
  assert.ok(!/`/.test(hooks), 'no template backtick leaked into the Java source');

  // Run twice: nothing changes.
  const once = { ...readSources(dir), newarch: manager, spec };
  const result = runScript(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Already patched/);
  assert.deepEqual({ ...readSources(dir), newarch: readNewarch(dir), spec: readSpec(dir) }, once);
});

test('B11: a package already patched without the declared prop gets the spec line and the setter', (t) => {
  const dir = createPackage(t, { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE, newarch: NEWARCH_MANAGER_SOURCE });
  patchReactNativeWebView(dir);
  // The patch as it was before the spec edit: no setter in the manager, the spec untouched.
  const older = readNewarch(dir).replace(/\n\n    \/\/ B11: read once[\s\S]*?public void setWebProfile\([^)]*\) \{\n    \}/, '');
  fs.writeFileSync(path.join(dir, NEWARCH_DIR, NEWARCH_MANAGER), older);
  fs.writeFileSync(path.join(dir, 'src', SPEC), SPEC_SOURCE);

  assert.deepEqual(patchReactNativeWebView(dir), [NEWARCH_MANAGER, SPEC]);
  assert.equal(occurrences(readNewarch(dir), 'public void setWebProfile('), 1);
  assert.equal(occurrences(readNewarch(dir), 'protected RNCWebViewWrapper createViewInstance('), 2);
  assert.equal(occurrences(readSpec(dir), 'webProfile?: string;'), 1);
});

test('B11: a new-architecture package without the component spec fails and writes nothing', (t) => {
  const dir = createPackage(t, { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE, newarch: NEWARCH_MANAGER_SOURCE, spec: null });

  const result = runScript(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /RNCWebViewNativeComponent\.ts not found/);
  assert.equal(readNewarch(dir), NEWARCH_MANAGER_SOURCE);
});

test('B11: a new-architecture manager without the anchor fails and writes nothing', (t) => {
  const broken = NEWARCH_MANAGER_SOURCE.replace('mRNCWebViewManagerImpl.createViewInstance(context)', 'createIt(context)');
  const dir = createPackage(t, { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE, newarch: broken });

  const result = runScript(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /RNCWebViewManager\.java: anchor not found for "hand the initial webProfile prop to beforeWebViewSetup \(B11\)"/);
  assert.deepEqual(readSources(dir), { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE, view: VIEW_SOURCE, hooks: null });
  assert.equal(readNewarch(dir), broken);
});

test('B11: a new-architecture directory without the manager file fails', (t) => {
  const dir = createPackage(t, { client: PRISTINE_CLIENT, manager: MANAGER_SOURCE, newarch: NEWARCH_MANAGER_SOURCE });
  fs.rmSync(path.join(dir, NEWARCH_DIR, NEWARCH_MANAGER));

  const result = runScript(dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /RNCWebViewManager\.java not found/);
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
