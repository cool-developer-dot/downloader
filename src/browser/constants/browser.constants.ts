/** Internal home surface — not a remote page. */
export const BROWSER_HOMEPAGE = 'vidorax://home' as const;

/** Blank document kept in the WebView while the home surface is visible. */
export const BROWSER_WEBVIEW_BLANK = 'about:blank' as const;

/** Search endpoint used when the address bar input is not a navigable URL. */
export const BROWSER_SEARCH_BASE_URL = 'https://www.google.com/search' as const;

/** App identifier — not appended to WebView HTTP User-Agent (site compatibility). */
export const BROWSER_USER_AGENT_TOKEN = 'VidoraXBrowser/1.0' as const;

/** Chrome-like progress bar thickness in density-independent pixels. */
export const BROWSER_PROGRESS_HEIGHT = 2.5 as const;

/** Progress value treated as fully complete before fade-out. */
export const BROWSER_PROGRESS_COMPLETE = 1 as const;

/** Minimum progress reported while a load is active (avoids a zero-width flicker). */
export const BROWSER_PROGRESS_MIN_VISIBLE = 0.02 as const;

/** Delay before fading the progress bar after completion. */
export const BROWSER_PROGRESS_FADE_DELAY_MS = 180 as const;

/** Progress / overlay fade duration. */
export const BROWSER_PROGRESS_FADE_DURATION_MS = 220 as const;

/** Address-bar focus glow / border transition. */
export const BROWSER_OMNIBOX_FOCUS_DURATION_MS = 180 as const;

/** Minimum touch target for browser chrome controls (pt). */
export const BROWSER_TOUCH_TARGET = 44 as const;

/** Address bar height. */
export const BROWSER_ADDRESS_BAR_HEIGHT = 44 as const;

/** Toolbar height excluding safe-area inset (compact 48–56dp strip). */
export const BROWSER_TOOLBAR_HEIGHT = 48 as const;

/** Schemes the engine is allowed to navigate in-place. */
export const BROWSER_ALLOWED_SCHEMES = ['http:', 'https:', 'about:'] as const;

/** Dangerous or unsupported schemes — never navigate. */
export const BROWSER_BLOCKED_SCHEMES = [
  'javascript:',
  'data:',
  'file:',
  'blob:',
  'ws:',
  'wss:',
  'ftp:',
  'intent:',
  'content:',
  'view-source:',
] as const;

/** Schemes handed off to the OS (mailto, tel, intent, etc.). */
export const BROWSER_EXTERNAL_SCHEMES = [
  'mailto:',
  'tel:',
  'sms:',
] as const;

/**
 * Social native-app awakening schemes — silently blocked inside VidoraX.
 * These are NOT errors — websites emit them to prompt the native app install/launch.
 * VidoraX keeps the user inside the browser and must never forward these to Linking.
 */
export const BROWSER_SOCIAL_NATIVE_APP_SCHEMES = [
  'snssdk1233:',
  'snssdk1340:',
  'snssdk:',
  'musically:',
  'tiktok:',
  'aweme:',
  'sslocal:',
  'bytedance:',
  'android-app:',
  'instagram:',
  'fb:',
  'fbapi:',
  'fb-messenger:',
  'snapchat:',
  'twitter:',
  'twitterkit:',
  'x:',
  'youtube:',
  'vnd.youtube:',
] as const;

/**
 * ByteDance/TikTok registers many numeric snssdk{id}: schemes (not only 1233/1340).
 * Unlisted ids must still classify as native-app awakening.
 */
const SNSSDK_SCHEME = /^snssdk\d*:/i;

export function isSocialNativeAppScheme(url: string): boolean {
  const lower = url.trim().toLowerCase();
  if (!lower) {
    return false;
  }
  if (SNSSDK_SCHEME.test(lower) || lower.startsWith('snssdk:')) {
    return true;
  }
  return (BROWSER_SOCIAL_NATIVE_APP_SCHEMES as readonly string[]).some((scheme) =>
    lower.startsWith(scheme),
  );
}

/** Patterns that must never be treated as navigable URLs. */
export const BROWSER_INVALID_INPUT_PATTERNS = [
  /^\.+$/,
  /^\?+$/,
  /^%+$/,
  /^:\/{0,3}$/,
  /^https?:$/i,
  /^https?:\/$/i,
] as const;
