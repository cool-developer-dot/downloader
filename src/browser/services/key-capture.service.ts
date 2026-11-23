import { getVidoraWeb, isVidoraWebAvailable, type CapturedKeyEvent } from '@modules/vidorax-web';

import { routeCapturedKey, type KeyOwnerRequest } from './key-capture-routing';

/**
 * B6 #240 / B21 — the app's one key channel. Features ask for keys here (Volume keys scroll pages, keyboard
 * shortcuts, the Player's volume and remote keys); this tells the native side (`VidoraWeb.setKeyCapture`) the union of
 * what is asked, listens to `onCapturedKey` only while something is asked (the native side takes no key while nothing
 * listens), and hands each captured key to the listeners of the feature that asked for it (Faran's P15: an owner per
 * feature, so the Player's keys never reach the Browser's listeners and the other way round).
 *
 * Volume keys go to one owner: the one that asked for them most recently. A combo goes to every owner that asked for
 * it. A listener subscribed without an owner hears every captured key (the behaviour before owners).
 */

type KeyListener = (event: CapturedKeyEvent) => void;

/** The owner `setVolumeKeys` stands for (B6's page scrolling). */
const BROWSER_VOLUME_OWNER = 'browser.volumeKeyScroll';

const requests = new Map<string, KeyOwnerRequest>();
let sequence = 0;
const listeners = new Set<{ listener: KeyListener; owner: string | null }>();
let subscription: { remove(): void } | null = null;

function dispatch(event: CapturedKeyEvent): void {
  if (!event || typeof event.key !== 'string') return;
  const owners = routeCapturedKey(event.key, requests);
  for (const entry of [...listeners]) {
    if (entry.owner != null && !owners.has(entry.owner)) continue;
    try {
      entry.listener(event);
    } catch {
      // ignore
    }
  }
}

function sync(): void {
  if (!isVidoraWebAvailable()) return;
  try {
    const native = getVidoraWeb();
    const all = [...requests.values()];
    const volumeKeys = all.some((request) => request.volumeKeys);
    const combos = [...new Set(all.flatMap((request) => request.combos).map((c) => c.toLowerCase()))];
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

function update(owner: string, change: { volumeKeys?: boolean; combos?: readonly string[] }): void {
  const previous = requests.get(owner) ?? { volumeKeys: false, combos: [], since: 0 };
  const volumeKeys = change.volumeKeys ?? previous.volumeKeys;
  const combos = change.combos ?? previous.combos;
  const sameCombos = previous.combos.length === combos.length && previous.combos.every((c, i) => c === combos[i]);
  if (previous.volumeKeys === volumeKeys && sameCombos && requests.has(owner)) return;
  if (!volumeKeys && combos.length === 0) {
    if (!requests.delete(owner)) return;
  } else {
    const since = volumeKeys && !previous.volumeKeys ? ++sequence : previous.since;
    requests.set(owner, { volumeKeys, combos, since });
  }
  sync();
}

export const keyCapture = {
  /** B6: Volume Up / Down for the Browser's page scrolling. */
  setVolumeKeys(enabled: boolean): void {
    update(BROWSER_VOLUME_OWNER, { volumeKeys: enabled });
  },

  /** Volume Up / Down for one feature (`owner`); the most recent owner to ask gets them. */
  setVolumeKeysFor(owner: string, enabled: boolean): void {
    update(owner, { volumeKeys: enabled });
  },

  /** B21: the shortcut combos one feature (`owner`) wants; an empty list releases them. */
  setCombos(owner: string, combos: readonly string[]): void {
    update(owner, { combos: [...combos] });
  },

  /**
   * Hears the keys `owner` asked for (`setVolumeKeys` is owned by `browser.volumeKeyScroll`); without an owner, every
   * captured key.
   */
  subscribe(listener: KeyListener, owner?: string): () => void {
    const entry = { listener, owner: owner ?? null };
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  },

  /** The owner `setVolumeKeys` stands for, for its listener. */
  BROWSER_VOLUME_OWNER,
};
