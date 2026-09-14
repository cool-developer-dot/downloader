/**
 * Applies VidoraX shouldInterceptRequest observation hook to react-native-webview
 * and contains shouldOverrideUrlLoading JS-lock timeout for custom schemes.
 * Prefer this over a bulky patch-package diff (avoids android/build artifact noise).
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '../node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
);

const MEDIA_MARKER = 'com.anonymous.vidorax.mediadetection.MediaNetworkBridge';
const TIMEOUT_MARKER = 'VidoraX: never default-allow custom schemes';

const HOOK = `
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
`;

const TIMEOUT_ALLOW = `if (SystemClock.elapsedRealtime() - startTime > SHOULD_OVERRIDE_URL_LOADING_TIMEOUT) {
                            FLog.w(TAG, "Did not receive response to shouldOverrideUrlLoading in time, defaulting to allow loading.");
                            RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                            return false;
                        }`;

const TIMEOUT_CONTAINED = `if (SystemClock.elapsedRealtime() - startTime > SHOULD_OVERRIDE_URL_LOADING_TIMEOUT) {
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
                        }`;

const INTERRUPT_ALLOW = `} catch (InterruptedException e) {
                FLog.e(TAG, "shouldOverrideUrlLoading was interrupted while waiting for result.", e);
                RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                return false;
            }`;

const INTERRUPT_CONTAINED = `} catch (InterruptedException e) {
                FLog.e(TAG, "shouldOverrideUrlLoading was interrupted while waiting for result.", e);
                RNCWebViewModuleImpl.shouldOverrideUrlLoadingLock.removeLock(lockIdentifier);
                if (url != null) {
                    String lower = url.toLowerCase();
                    if (lower.startsWith("http:") || lower.startsWith("https:") || lower.startsWith("about:")) {
                        return false;
                    }
                }
                return true;
            }`;

function applyMediaHook(text) {
  if (text.includes(MEDIA_MARKER)) {
    console.log('[vidorax] WebView media network hook already present');
    return text;
  }

  const anchor =
    'public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {\n' +
    '        final String url = request.getUrl().toString();\n' +
    '        return this.shouldOverrideUrlLoading(view, url);\n' +
    '    }';

  if (!text.includes(anchor)) {
    console.warn('[vidorax] Could not locate shouldOverrideUrlLoading anchor — skip media hook');
    return text;
  }

  const next = text.replace(anchor, `${anchor}\n${HOOK}`);
  console.log('[vidorax] Applied WebView media network observation hook');
  return next;
}

function applyTimeoutContainment(text) {
  if (text.includes(TIMEOUT_MARKER)) {
    console.log('[vidorax] WebView custom-scheme timeout containment already present');
    return text;
  }

  if (!text.includes(TIMEOUT_ALLOW)) {
    console.warn('[vidorax] Could not locate shouldOverrideUrlLoading timeout allow — skip containment');
    return text;
  }

  let next = text.replace(TIMEOUT_ALLOW, TIMEOUT_CONTAINED);
  if (next.includes(INTERRUPT_ALLOW)) {
    next = next.replace(INTERRUPT_ALLOW, INTERRUPT_CONTAINED);
  }
  console.log('[vidorax] Applied WebView custom-scheme timeout containment');
  return next;
}

function main() {
  if (!fs.existsSync(target)) {
    console.warn('[vidorax] react-native-webview RNCWebViewClient.java not found — skip hook');
    return;
  }

  const original = fs.readFileSync(target, 'utf8');
  const next = applyTimeoutContainment(applyMediaHook(original));
  if (next !== original) {
    fs.writeFileSync(target, next);
  }
}

main();
