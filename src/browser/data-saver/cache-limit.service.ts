import { useCallback, useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { getMmkvInstance } from '@/storage/mmkv';
import { useSettingsStore } from '@/store/settings';

import { shouldClearCache } from './cache-limit';
import { cacheLimitBytes, normalizeCacheLimit } from './data-saver-settings';

/**
 * B18 #192 — the cache limit: once per app start, after the browser has shown and the app is idle (the default is
 * Off, so normally nothing runs), the WebView cache is measured and cleared when it is over the limit
 * (`shouldClearCache`). "Clear cache now" in Browser settings clears it at once. Cookies, site data and history stay.
 */

const FLOOR_KEY = 'vidorax.cacheLimitFloor.v1';
const START_DELAY_MS = 10_000;

let checkedThisStart = false;

function api() {
  return isVidoraWebAvailable() ? getVidoraWeb() : null;
}

export async function webViewCacheSize(): Promise<number | null> {
  try {
    const size = await api()?.getWebViewCacheSize?.();
    return typeof size === 'number' && Number.isFinite(size) ? size : null;
  } catch {
    return null;
  }
}

/** Clears now; resolves the size afterwards (null when it couldn't be read). */
export async function clearWebViewCacheNow(): Promise<number | null> {
  try {
    await api()?.clearWebViewCache?.();
  } catch {
    // reported by the size below
  }
  const after = await webViewCacheSize();
  try {
    if (after != null) getMmkvInstance()?.set(FLOOR_KEY, String(after));
  } catch {
    // ignore
  }
  return after;
}

/** The start check (once per app start, after the browser shows; idle). */
export function scheduleCacheLimitCheck(): () => void {
  if (checkedThisStart) return () => undefined;
  let cancelled = false;
  const timer = setTimeout(() => {
    void InteractionManager.runAfterInteractions(async () => {
      if (cancelled || checkedThisStart) return;
      checkedThisStart = true;
      const limit = cacheLimitBytes(normalizeCacheLimit(useSettingsStore.getState().cacheLimitMb));
      if (limit <= 0) return;
      const size = await webViewCacheSize();
      if (size == null) return;
      let floor = 0;
      try {
        floor = Number(getMmkvInstance()?.getString(FLOOR_KEY) ?? 0) || 0;
      } catch {
        floor = 0;
      }
      if (shouldClearCache(size, limit, floor)) await clearWebViewCacheNow();
    });
  }, START_DELAY_MS);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

/** Browser settings: the cache size (read when shown) and "Clear cache now". */
export function useWebViewCacheSize(): { size: number | null; clearing: boolean; clear: () => Promise<void> } {
  const [size, setSize] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void webViewCacheSize().then((value) => {
      if (!cancelled) setSize(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const clear = useCallback(async () => {
    setClearing(true);
    const after = await clearWebViewCacheNow();
    setSize(after);
    setClearing(false);
  }, []);
  return { size, clearing, clear };
}
