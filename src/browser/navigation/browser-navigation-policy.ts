/**
 * Central website-originated navigation classifier.
 * Pure: no Linking, no WebView, no store mutation.
 *
 * react-native-webview 13.16.1 WebViewShared.tsx:
 * if URL origin fails originWhitelist → Linking.canOpenURL BEFORE our callback.
 * Classifier-owned schemes MUST appear on originWhitelist so we can return false.
 */

import {
  BROWSER_ALLOWED_SCHEMES,
  BROWSER_BLOCKED_SCHEMES,
  BROWSER_EXTERNAL_SCHEMES,
  BROWSER_HOMEPAGE,
  BROWSER_SOCIAL_NATIVE_APP_SCHEMES,
  isSocialNativeAppScheme,
} from '@/browser/constants/browser.constants';

import {
  isIntentScheme,
  resolveAndroidIntentUri,
  type IntentResolution,
} from './intent-uri-resolver';

export type BrowserNavigationDecisionKind =
  | 'ALLOW_BLANK'
  | 'INTERNAL_WEB'
  | 'BLOCK_NATIVE_APP'
  | 'BLOCK_MARKET'
  | 'BLOCK_UNKNOWN_SCHEME'
  | 'BLOCK_DANGEROUS'
  | 'BLOCK_HOME_INTERCEPT'
  | 'SAFE_SYSTEM_ACTION'
  | 'INTENT_WEB_FALLBACK'
  | 'INTENT_BLOCK';

export type BrowserNavigationDecision = {
  kind: BrowserNavigationDecisionKind;
  /** True only for in-WebView document loads (http/https/about:blank). */
  shouldLoadInWebView: boolean;
  /** True only for explicit mailto/tel/sms (never social/market/intent). */
  invokeLinking: boolean;
  /** HTTPS fallback to load inside VidoraX (intent). */
  internalUrl?: string;
  intentResolution?: IntentResolution;
  reason: string;
};

export const BROWSER_MARKET_SCHEMES = ['market:', 'play:'] as const;

export const BROWSER_SAFE_SYSTEM_SCHEMES = ['mailto:', 'tel:', 'sms:'] as const;

/** Packages that indicate a social native-app intent. */
const SOCIAL_NATIVE_PACKAGES = [
  'com.zhiliaoapp.musically',
  'com.ss.android.ugc.trill',
  'com.ss.android.ugc.aweme',
  'com.instagram.android',
  'com.facebook.katana',
  'com.facebook.orca',
  'com.facebook.lite',
  'com.snapchat.android',
  'com.twitter.android',
  'com.twitter.android.lite',
  'com.google.android.youtube',
  'com.google.android.apps.youtube.music',
] as const;

function isBrowserHomeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed === BROWSER_HOMEPAGE ||
    trimmed === 'vidorax://home/' ||
    trimmed === 'about:vidorax-home'
  );
}

function extractScheme(url: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z\d+\-.]*):/.exec(url.trim());
  return match ? `${match[1].toLowerCase()}:` : null;
}

export function isMarketScheme(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return (BROWSER_MARKET_SCHEMES as readonly string[]).some((s) =>
    lower.startsWith(s),
  );
}

export function isSafeSystemScheme(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return (BROWSER_SAFE_SYSTEM_SCHEMES as readonly string[]).some((s) =>
    lower.startsWith(s),
  );
}

export { isSocialNativeAppScheme };

export function isSocialNativePackage(packageName: string | null | undefined): boolean {
  if (!packageName) {
    return false;
  }
  const lower = packageName.toLowerCase();
  if (lower.startsWith('com.zhiliaoapp.') || lower.startsWith('com.ss.android.ugc.')) {
    return true;
  }
  return SOCIAL_NATIVE_PACKAGES.some((p) => lower === p || lower.startsWith(`${p}.`));
}

export function isPlayStoreOrMarketWebUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    return (
      host === 'play.google.com' ||
      host.endsWith('.play.google.com') ||
      host === 'market.android.com'
    );
  } catch {
    return false;
  }
}

function isHttpOrHttps(url: string): boolean {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Mirror of react-native-webview 13.16.1 WebViewShared extractOrigin.
 */
export function extractRnWebViewOrigin(url: string): string {
  const result = /^[A-Za-z][A-Za-z0-9+\-.]+:(\/\/)?[^/]*/.exec(url);
  return result === null ? '' : result[0];
}

function originWhitelistToRegex(originWhitelist: string): string {
  return `^${originWhitelist.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/\\\*/g, '.*')}`;
}

export function compileRnOriginWhitelist(
  originWhitelist: readonly string[],
): readonly string[] {
  return ['about:blank', ...originWhitelist].map(originWhitelistToRegex);
}

export function passesRnOriginWhitelist(
  originWhitelist: readonly string[],
  url: string,
): boolean {
  const compiled = compileRnOriginWhitelist(originWhitelist);
  const origin = extractRnWebViewOrigin(url);
  return compiled.some((x) => new RegExp(x).test(origin));
}

/**
 * URLs that fail this set would hit Linking.canOpenURL in WebViewShared
 * BEFORE onShouldStartLoadWithRequest.
 */
export function wouldRnWebViewInvokeLinking(
  originWhitelist: readonly string[],
  url: string,
): boolean {
  if (!url || url === 'about:blank') {
    return false;
  }
  return !passesRnOriginWhitelist(originWhitelist, url);
}

function schemeWhitelistEntries(schemeWithColon: string): string[] {
  const name = schemeWithColon.replace(/:$/, '').toLowerCase();
  return [`${name}://*`, `${name}:*`];
}

/**
 * originWhitelist that routes classifiable schemes into VidoraX's callback.
 * Never includes a bare `*`.
 */
export function buildBrowserOriginWhitelist(): readonly string[] {
  const entries = new Set<string>(['http://*', 'https://*']);
  const extraSchemes = [
    ...BROWSER_SOCIAL_NATIVE_APP_SCHEMES,
    ...BROWSER_MARKET_SCHEMES,
    ...BROWSER_SAFE_SYSTEM_SCHEMES,
    ...BROWSER_BLOCKED_SCHEMES,
    ...BROWSER_EXTERNAL_SCHEMES,
    'intent:',
    'snssdk*:',
    'geo:',
    'maps:',
    'itms-apps:',
    'googlechrome:',
    'googlechromes:',
  ];
  for (const scheme of extraSchemes) {
    for (const entry of schemeWhitelistEntries(scheme)) {
      entries.add(entry);
    }
  }
  return Object.freeze([...entries]);
}

function classifyIntent(url: string): BrowserNavigationDecision {
  const resolution = resolveAndroidIntentUri(url);
  if (resolution.type === 'WEB_FALLBACK' && isHttpOrHttps(resolution.url)) {
    if (isPlayStoreOrMarketWebUrl(resolution.url)) {
      return {
        kind: 'BLOCK_MARKET',
        shouldLoadInWebView: false,
        invokeLinking: false,
        intentResolution: resolution,
        reason: 'intent_play_store_fallback_contained',
      };
    }
    return {
      kind: 'INTENT_WEB_FALLBACK',
      shouldLoadInWebView: false,
      invokeLinking: false,
      internalUrl: resolution.url,
      intentResolution: resolution,
      reason: 'intent_https_fallback',
    };
  }
  if (resolution.type === 'EXTERNAL_APP') {
    if (
      isSocialNativePackage(resolution.packageName) ||
      (resolution.intentUri && isSocialNativeAppScheme(resolution.intentUri))
    ) {
      return {
        kind: 'BLOCK_NATIVE_APP',
        shouldLoadInWebView: false,
        invokeLinking: false,
        intentResolution: resolution,
        reason: 'intent_social_native_blocked',
      };
    }
    return {
      kind: 'INTENT_BLOCK',
      shouldLoadInWebView: false,
      invokeLinking: false,
      intentResolution: resolution,
      reason: 'intent_external_app_contained',
    };
  }
  return {
    kind: 'INTENT_BLOCK',
    shouldLoadInWebView: false,
    invokeLinking: false,
    intentResolution: resolution,
    reason: `intent_${'reason' in resolution ? resolution.reason : 'blocked'}`,
  };
}

/**
 * Authoritative policy for website-originated navigations (main frame, iframe, popup).
 */
export function classifyBrowserNavigation(
  url: string | null | undefined,
): BrowserNavigationDecision {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed || trimmed === 'about:blank') {
    return {
      kind: 'ALLOW_BLANK',
      shouldLoadInWebView: true,
      invokeLinking: false,
      reason: 'blank_document',
    };
  }

  if (isBrowserHomeUrl(trimmed)) {
    return {
      kind: 'BLOCK_HOME_INTERCEPT',
      shouldLoadInWebView: false,
      invokeLinking: false,
      reason: 'home_url_intercept',
    };
  }

  if (isSocialNativeAppScheme(trimmed)) {
    return {
      kind: 'BLOCK_NATIVE_APP',
      shouldLoadInWebView: false,
      invokeLinking: false,
      reason: 'social_native_app_scheme',
    };
  }

  if (isMarketScheme(trimmed)) {
    return {
      kind: 'BLOCK_MARKET',
      shouldLoadInWebView: false,
      invokeLinking: false,
      reason: 'market_scheme_contained',
    };
  }

  if (isIntentScheme(trimmed)) {
    return classifyIntent(trimmed);
  }

  const scheme = extractScheme(trimmed);
  if (scheme && (BROWSER_BLOCKED_SCHEMES as readonly string[]).includes(scheme)) {
    return {
      kind: 'BLOCK_DANGEROUS',
      shouldLoadInWebView: false,
      invokeLinking: false,
      reason: 'blocked_scheme',
    };
  }

  if (isSafeSystemScheme(trimmed)) {
    return {
      kind: 'SAFE_SYSTEM_ACTION',
      shouldLoadInWebView: false,
      invokeLinking: true,
      reason: 'explicit_system_scheme',
    };
  }

  if (isHttpOrHttps(trimmed) || (scheme && (BROWSER_ALLOWED_SCHEMES as readonly string[]).includes(scheme))) {
    return {
      kind: 'INTERNAL_WEB',
      shouldLoadInWebView: true,
      invokeLinking: false,
      reason: 'http_https',
    };
  }

  return {
    kind: 'BLOCK_UNKNOWN_SCHEME',
    shouldLoadInWebView: false,
    invokeLinking: false,
    reason: 'unknown_custom_scheme',
  };
}

export function isZeroSideEffectBlock(kind: BrowserNavigationDecisionKind): boolean {
  return (
    kind === 'BLOCK_NATIVE_APP' ||
    kind === 'BLOCK_MARKET' ||
    kind === 'BLOCK_UNKNOWN_SCHEME' ||
    kind === 'BLOCK_DANGEROUS' ||
    kind === 'INTENT_BLOCK' ||
    kind === 'BLOCK_HOME_INTERCEPT'
  );
}
