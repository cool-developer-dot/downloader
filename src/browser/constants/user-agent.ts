import { Platform } from 'react-native';

export type BrowserUserAgentMode = 'mobile' | 'desktop';

export type BrowserUserAgentOptions = {
  desktop?: boolean;
  baseUserAgent?: string | null;
  /**
   * When true, append a product token. Default false — major sites (TikTok)
   * reject or stall on custom embedded-browser tokens in the HTTP UA.
   */
  includeBrandToken?: boolean;
};

/**
 * Desktop override UA — used only when the user explicitly enables Desktop Site
 * (or a platform adapter prefers desktop for a content page).
 * No product branding token: network UA must stay site-compatible.
 */
const DESKTOP_USER_AGENTS = {
  ios: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15`,
  android: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
  default: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
} as const;

/**
 * Optional branded mobile fallback when a caller needs an explicit string
 * (e.g. download request context). Prefer omitting WebView `userAgent` so
 * Android uses the stock system WebView UA (matches device Chrome major).
 */
const MOBILE_USER_AGENTS = {
  ios: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1`,
  android: `Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36`,
  default: `Mozilla/5.0 (Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
} as const;

/** @deprecated Kept for download fixtures only — not applied to WebView HTTP UA. */
export const BROWSER_USER_AGENT_BRAND_TOKEN = 'VidoraXBrowser/1.0' as const;

/**
 * Builds an explicit user-agent string.
 *
 * Mobile browsing should prefer the stock Android WebView UA (do not pass
 * `userAgent` to WebView) so Client Hints and UA version stay consistent.
 * This helper remains for Desktop override + download request context.
 */
export function buildBrowserUserAgent(options?: BrowserUserAgentOptions): string {
  const desktop = options?.desktop ?? false;

  const fallback = desktop
    ? Platform.select(DESKTOP_USER_AGENTS) ?? DESKTOP_USER_AGENTS.default
    : Platform.select(MOBILE_USER_AGENTS) ?? MOBILE_USER_AGENTS.default;

  const base =
    options?.baseUserAgent && options.baseUserAgent.trim().length > 0
      ? options.baseUserAgent.trim()
      : fallback;

  if (!options?.includeBrandToken) {
    return base;
  }

  if (base.includes(BROWSER_USER_AGENT_BRAND_TOKEN)) {
    return base;
  }

  return `${base} ${BROWSER_USER_AGENT_BRAND_TOKEN}`.trim();
}

export function browserUserAgentMode(desktop: boolean): BrowserUserAgentMode {
  return desktop ? 'desktop' : 'mobile';
}

/**
 * WebView prop policy (single source of truth for BrowserWebView):
 * - mobile → undefined (stock system WebView UA)
 * - desktop → explicit desktop-compatible UA without brand token
 */
export function resolveWebViewUserAgent(desktop: boolean): string | undefined {
  if (!desktop) {
    return undefined;
  }
  return buildBrowserUserAgent({ desktop: true });
}

/**
 * Canonical per-tab UA resolver — all WebView hosts must use this.
 * Mobile omits `userAgent` so Android stock WebView UA + Client Hints stay aligned.
 */
export function resolveWebViewUserAgentForTab(input: {
  desktopMode: boolean;
}): string | undefined {
  return resolveWebViewUserAgent(input.desktopMode);
}
