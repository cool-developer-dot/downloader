/**
 * Clipboard Monitor (#291), off by default. Only when the setting is on and VidoraX comes back to the foreground is
 * the clipboard read — never in the background, never on a timer. A new allowed link (not offered before) shows a
 * small "Download from copied link?" banner; accepting opens it through the pasted-link path. Only a hash of the
 * last offered link is stored; the link itself stays in memory for the banner and is dropped with it.
 */

import * as Clipboard from 'expo-clipboard';
import { AppState } from 'react-native';

import { getMmkvInstance } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';
import { useSettingsStore } from '@/store/settings';

import { clipboardOffer } from './link-intake';
import { openLinkLikePaste } from './open-link-like-paste';

const LAST_HASH_KEY = 'vidorax.clipboardMonitor.lastHash';
/** Android only lets the focused app read the clipboard: wait for the window to take focus. */
const READ_DELAY_MS = 700;

type BannerState = { url: string | null; host: string | null };

export const useClipboardBannerStore = createStore<BannerState>(() => ({ url: null, host: null }));

let attached = false;
let readTimer: ReturnType<typeof setTimeout> | null = null;

function readLastHash(): string | null {
  try {
    return getMmkvInstance()?.getString(LAST_HASH_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLastHash(hash: string): void {
  try {
    getMmkvInstance()?.set(LAST_HASH_KEY, hash);
  } catch {
    // Not remembered: the same link may be offered once more.
  }
}

async function checkClipboard(): Promise<void> {
  if (AppState.currentState !== 'active' || !useSettingsStore.getState().clipboardMonitor) {
    return;
  }
  let text: string | null = null;
  try {
    if (!(await Clipboard.hasStringAsync())) {
      return;
    }
    // Still in front? The read happens only while VidoraX is.
    if (AppState.currentState !== 'active') {
      return;
    }
    text = await Clipboard.getStringAsync();
  } catch {
    return;
  }
  const offer = clipboardOffer(text, readLastHash());
  if (!offer) {
    return;
  }
  writeLastHash(offer.hash);
  let host: string | null = null;
  try {
    host = new URL(offer.url).hostname.replace(/^www\./, '');
  } catch {
    host = null;
  }
  useClipboardBannerStore.setState({ url: offer.url, host });
}

export function acceptClipboardBanner(): void {
  const { url } = useClipboardBannerStore.getState();
  useClipboardBannerStore.setState({ url: null, host: null });
  openLinkLikePaste(url);
}

export function dismissClipboardBanner(): void {
  useClipboardBannerStore.setState({ url: null, host: null });
}

/** Idempotent. Listens for VidoraX returning to the foreground. */
export function ensureClipboardLinkMonitor(): void {
  if (attached) {
    return;
  }
  attached = true;
  AppState.addEventListener('change', (state) => {
    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }
    if (state !== 'active') {
      // Leaving the app drops a banner that was not answered.
      dismissClipboardBanner();
      return;
    }
    if (!useSettingsStore.getState().clipboardMonitor) {
      return;
    }
    readTimer = setTimeout(() => {
      readTimer = null;
      void checkClipboard();
    }, READ_DELAY_MS);
  });
}
