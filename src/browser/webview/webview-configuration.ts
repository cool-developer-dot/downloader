/**
 * Single source of truth for Android browser WebView compatibility props.
 * Values here are applied by BrowserWebView — do not duplicate ad hoc.
 *
 * Viewport / overview (Android `scalesPageToFit`):
 * - Mobile: false → useWideViewPort/loadWithOverviewMode off (device-width layouts)
 * - Desktop: true → wide viewport + overview scaling (Request Desktop Site–like)
 * Applied per-tab from appliedDesktopMode — never global.
 *
 * Phase 6A cookie / session continuity (Android):
 * - Cookie authority = process-wide `android.webkit.CookieManager` (shared by all tab WebViews).
 * - Do NOT remount/incognito/clear cookies on tab switch, Home, park, or tab close.
 * - `sharedCookiesEnabled` is kept true for config honesty but is an iOS/macOS prop
 *   (no-op on Android RN WebView 13.x). Android sharing does not depend on it.
 * - `thirdPartyCookiesEnabled: true` preserves legitimate SSO/auth-embed flows.
 * - Never pass WebView `incognito` — RN Android setIncognito clears the global jar.
 * - Never build an app-owned cookie/session database for third-party websites.
 */

import { buildBrowserOriginWhitelist } from '@/browser/navigation/browser-navigation-policy';

/** Android-only VidoraX browser — platform constant for static audits. */
export const BROWSER_WEBVIEW_PLATFORM = 'android' as const;

/**
 * Built so react-native-webview 13.16.1 WebViewShared does NOT call
 * Linking.canOpenURL for classifiable custom schemes. Those URLs must
 * pass originWhitelist, then onShouldStartLoadWithRequest returns false.
 * Never use a bare `*`.
 */
export const BROWSER_WEBVIEW_ORIGIN_WHITELIST = buildBrowserOriginWhitelist();

/** Android WebSettings cache mode — default browsing uses platform cache. */
export const BROWSER_WEBVIEW_CACHE_MODE_DEFAULT = 'LOAD_DEFAULT' as const;

/** One-shot reload after UA change bypasses cache without disabling cache globally. */
export const BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD = 'LOAD_NO_CACHE' as const;

export type BrowserWebViewCacheMode =
  | typeof BROWSER_WEBVIEW_CACHE_MODE_DEFAULT
  | typeof BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD;

/**
 * Mixed content: HTTPS main documents must not load active insecure subresources.
 * Security takes precedence over broken legacy sites (Phase 2A audit).
 */
export const BROWSER_MIXED_CONTENT_MODE = 'never' as const;

/**
 * Hard rule: BrowserWebView must never set `incognito={true}`.
 * Exported for Phase 6A static verification.
 */
export const BROWSER_WEBVIEW_INCOGNITO_PROP_FORBIDDEN = true as const;

export const browserWebViewConfiguration = {
  javaScriptEnabled: true,
  domStorageEnabled: true,
  /**
   * iOS/macOS shared HTTPCookieStorage flag. Android: no-op; CookieManager
   * already shares across WebViews in-process.
   */
  sharedCookiesEnabled: true,
  /** Android CookieManager.setAcceptThirdPartyCookies(view, true). */
  thirdPartyCookiesEnabled: true,
  /** Must remain false — never wire RN WebView incognito on Android. */
  incognito: false as const,
  cacheEnabled: true,
  mixedContentMode: BROWSER_MIXED_CONTENT_MODE,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  geolocationEnabled: false,
  allowsBackForwardNavigationGestures: true,
  allowsInlineMediaPlayback: true,
  mediaPlaybackRequiresUserAction: true,
  /** Required on Android for window.open / target=_blank dispatch to onOpenWindow. */
  setSupportMultipleWindows: true,
  javaScriptCanOpenWindowsAutomatically: true,
  startInLoadingState: false,
  /**
   * Do not append branding to the system UA. Custom applicationName breaks
   * TikTok and similar sites that fingerprint embedded WebViews.
   * Desktop override uses the explicit `userAgent` prop instead.
   */
  applicationNameForUserAgent: undefined as string | undefined,
  originWhitelist: BROWSER_WEBVIEW_ORIGIN_WHITELIST,
  platform: BROWSER_WEBVIEW_PLATFORM,
  /** Pinch-zoom available; on-screen +/- chrome hidden. */
  setBuiltInZoomControls: true,
  setDisplayZoomControls: false,
} as const;

/** Mobile Site: stock layout — no wide/overview desktop viewport leftovers. */
export function resolveScalesPageToFit(desktopMode: boolean): boolean {
  return desktopMode;
}

/** @internal Exported for static verification scripts. */
export const browserWebViewConfigurationContract = browserWebViewConfiguration;
