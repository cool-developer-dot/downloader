import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { useSettingsStore } from '@/store/settings';

import { browserSaverOn } from './browser-savers';
import {
  NEXT_PAGE_PREFETCH_SCRIPT,
  normalizePreloadPages,
  preloadAllowed,
  type PreloadNetwork,
} from './preload-policy';

/**
 * B6 #55 — applies Preload pages: a DNS lookup for the address bar's top suggestion, and a prefetch of a page's
 * same-site next page after it loads. Both only while `preloadAllowed` (setting, network, savers).
 */

let network: PreloadNetwork = { connected: true, type: 'unknown', expensive: false };
let watching = false;

function fromNetInfo(state: NetInfoState): PreloadNetwork {
  const details = state.details as { isConnectionExpensive?: boolean } | null;
  return {
    connected: state.isConnected !== false,
    type: String(state.type ?? 'unknown').toLowerCase(),
    expensive: details?.isConnectionExpensive === true,
  };
}

function watchNetwork(): void {
  if (watching) return;
  watching = true;
  try {
    NetInfo.addEventListener((state) => {
      network = fromNetInfo(state);
    });
    void NetInfo.fetch().then((state) => {
      network = fromNetInfo(state);
    });
  } catch {
    // Without NetInfo nothing is preloaded on Wi-Fi only.
  }
}

export const pagePreload = {
  allowed(): boolean {
    watchNetwork();
    const setting = normalizePreloadPages(useSettingsStore.getState().preloadPages);
    return preloadAllowed(setting, network, browserSaverOn());
  },

  /** The host of the address bar's top suggestion. */
  prefetchHost(host: string | null): void {
    if (!host || !pagePreload.allowed() || !isVidoraWebAvailable()) return;
    try {
      getVidoraWeb().prefetchDns?.(host);
    } catch {
      // Older native build.
    }
  },

  /** After the page in front loaded: prefetch its next page, if it names one. */
  afterPageLoad(inject: (script: string) => void): void {
    if (!pagePreload.allowed()) return;
    try {
      inject(NEXT_PAGE_PREFETCH_SCRIPT);
    } catch {
      // ignore
    }
  },
};
