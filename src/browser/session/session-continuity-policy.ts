/**
 * Phase 6A — session continuity policy (Android WebView).
 *
 * THE WEBSITE OWNS AUTHENTICATION. VidoraX does not create a cookie jar,
 * session DB, or credential store. Android CookieManager is authoritative.
 */

import { browserWebViewConfiguration } from '@/browser/webview/webview-configuration';

/**
 * Android react-native-webview 13.x: `sharedCookiesEnabled` is an iOS/macOS
 * prop (WKWebView HTTPCookieStorage). On Android it is a documented no-op;
 * all WebViews already share process-wide `CookieManager.getInstance()`.
 *
 * We keep the prop `true` for cross-platform config honesty and static audits,
 * but Android session sharing does NOT depend on it.
 */
export const ANDROID_SHARED_COOKIES_PROP_IS_NOOP = true as const;

/**
 * Third-party cookies remain enabled so legitimate SSO / auth CDN embeds that
 * Android WebView still supports can complete. This is not an auth bypass —
 * SameSite / domain scoping still apply. Privacy trade-off is intentional for
 * Phase 6A login continuity; do not flip globally without a privacy phase.
 */
export const PHASE_6A_THIRD_PARTY_COOKIE_POLICY = 'accept_for_webview' as const;

/**
 * Never pass `incognito` to browser WebViews on Android.
 * RN WebView's setIncognito(true) calls CookieManager.removeAllCookies() for
 * the entire process — destroying every tab's legitimate sessions.
 */
export const BROWSER_WEBVIEW_INCOGNITO_ENABLED = false as const;

/** DOM / website storage stays in the WebView; VidoraX does not inspect it. */
export const PHASE_6A_DOM_STORAGE_ENABLED =
  browserWebViewConfiguration.domStorageEnabled;

export const phase6aSessionContinuityPolicy = {
  platform: 'android' as const,
  cookieAuthority: 'android_webview_cookie_manager' as const,
  customCookieDatabase: false,
  customSessionDatabase: false,
  persistRawCookiesToMmkv: false,
  persistRawCookiesToZustand: false,
  persistRawCookiesToAsyncStorage: false,
  persistRawCookiesToSqlite: false,
  cookiePolling: false,
  authPolling: false,
  credentialExtraction: false,
  documentCookieExtraction: false,
  thirdPartyCookiePolicy: PHASE_6A_THIRD_PARTY_COOKIE_POLICY,
  thirdPartyCookiesEnabled: browserWebViewConfiguration.thirdPartyCookiesEnabled,
  sharedCookiesEnabledProp: browserWebViewConfiguration.sharedCookiesEnabled,
  androidSharedCookiesPropIsNoop: ANDROID_SHARED_COOKIES_PROP_IS_NOOP,
  domStorageEnabled: PHASE_6A_DOM_STORAGE_ENABLED,
  incognitoEnabled: BROWSER_WEBVIEW_INCOGNITO_ENABLED,
  popupStrategy: 'same_webview_https' as const,
  phase6bAuthenticatedDownloader: false,
} as const;

export type Phase6aSessionContinuityPolicy =
  typeof phase6aSessionContinuityPolicy;
