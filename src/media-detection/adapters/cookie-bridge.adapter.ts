import { Platform, NativeModules } from 'react-native';

type CookieBridgeModule = {
  getCookiesForUrl?: (url: string) => Promise<string | null>;
  hasCookiesForUrl?: (url: string) => Promise<boolean>;
};

const bridge = NativeModules.VidoraCookieBridge as CookieBridgeModule | undefined;

/**
 * Reads same-session cookies from Android WebView cookie jar.
 * Values are never logged — use only for outbound download/analyze requests.
 */
export async function getSessionCookiesForUrl(url: string): Promise<string | null> {
  if (Platform.OS !== 'android' || !bridge?.getCookiesForUrl) {
    return null;
  }
  try {
    const cookies = await bridge.getCookiesForUrl(url);
    return cookies?.trim() ? cookies.trim() : null;
  } catch {
    return null;
  }
}

export async function hasSessionCookiesForUrl(url: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !bridge?.hasCookiesForUrl) {
    return false;
  }
  try {
    return Boolean(await bridge.hasCookiesForUrl(url));
  } catch {
    return false;
  }
}
