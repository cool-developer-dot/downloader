import { getVidoraWeb, isVidoraWebAvailable, type CapturedKeyEvent } from '@modules/vidorax-web';

/**
 * B6 #240 / B21 — the app's one key channel. Features ask for keys here (Volume keys scroll pages, keyboard
 * shortcuts later); this tells the native side (`VidoraWeb.setKeyCapture`) the union of what is asked, listens to
 * `onCapturedKey` only while something is asked (the native side takes no key while nothing listens), and hands each
 * captured key to the subscribers.
 */

type KeyListener = (event: CapturedKeyEvent) => void;

let volumeKeys = false;
const combosByOwner = new Map<string, readonly string[]>();
const listeners = new Set<KeyListener>();
let subscription: { remove(): void } | null = null;

function dispatch(event: CapturedKeyEvent): void {
  if (!event || typeof event.key !== 'string') return;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // ignore
    }
  }
}

function sync(): void {
  if (!isVidoraWebAvailable()) return;
  try {
    const native = getVidoraWeb();
    const combos = [...new Set([...combosByOwner.values()].flat().map((c) => c.toLowerCase()))];
    const wanted = volumeKeys || combos.length > 0;
    if (wanted && !subscription) {
      subscription = native.addListener('onCapturedKey', dispatch);
    }
    native.setKeyCapture?.(volumeKeys, combos);
    if (!wanted && subscription) {
      subscription.remove();
      subscription = null;
    }
  } catch {
    // Older native build: keys keep their normal job.
  }
}

export const keyCapture = {
  setVolumeKeys(enabled: boolean): void {
    if (volumeKeys === enabled) return;
    volumeKeys = enabled;
    sync();
  },

  /** B21: the shortcut combos one feature (`owner`) wants; an empty list releases them. */
  setCombos(owner: string, combos: readonly string[]): void {
    if (combos.length === 0) combosByOwner.delete(owner);
    else combosByOwner.set(owner, combos);
    sync();
  },

  subscribe(listener: KeyListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
