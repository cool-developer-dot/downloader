/**
 * Native side of "Open with VidoraX": the VidoraMedia module reads the file intent and hands JavaScript a token.
 * Imported by the app shell and the player — not by Node tests (they use `createIncomingMediaQueue`).
 */

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import type { IncomingMediaSource } from '@modules/vidorax-media/src/VidoraMedia.types';

import { playerLog } from './diagnostics';
import {
  createIncomingMediaQueue,
  isIncomingMediaToken,
  saveOutcomeFrom,
  type SaveIncomingOutcome,
} from './external-media';

export type { SaveIncomingOutcome } from './external-media';

/** The file waiting for the app shell (and App Lock) before the player opens it. */
export const incomingMediaQueue = createIncomingMediaQueue();

let attached = false;

/**
 * Idempotent. Reads the file the app was launched with, then keeps listening for files opened while it runs. A
 * build without the module (or without these functions) simply has no incoming files.
 */
export function ensureIncomingMediaHandling(): void {
  if (attached || !isVidoraMediaAvailable()) {
    return;
  }
  attached = true;
  const media = getVidoraMedia();
  try {
    const launched = incomingMediaQueue.capture(media.consumeIncomingMedia?.() ?? null);
    playerLog('player.incoming', { step: launched ? 'launch_file' : 'no_launch_file' });
  } catch {
    // No intent to read.
  }
  try {
    media.addListener('onIncomingMedia', (event) => {
      playerLog('player.incoming', { step: 'new_intent_file', kind: event?.kind });
      incomingMediaQueue.capture(event);
    });
  } catch {
    // Older module build without the event: the launch file still works.
  }
}

/** The playable source for the player; null when the token is unknown to this process. */
export function getIncomingMediaSource(token: string): IncomingMediaSource | null {
  if (!isIncomingMediaToken(token) || !isVidoraMediaAvailable()) {
    return null;
  }
  try {
    return getVidoraMedia().getIncomingMediaSource?.(token) ?? null;
  } catch {
    return null;
  }
}

/** "Save to VidoraX": copies the incoming file into the library. Never throws. */
export async function saveIncomingMedia(token: string): Promise<SaveIncomingOutcome> {
  if (!isIncomingMediaToken(token) || !isVidoraMediaAvailable()) {
    return { kind: 'unavailable' };
  }
  const media = getVidoraMedia();
  if (typeof media.importIncomingMedia !== 'function') {
    return { kind: 'failed' };
  }
  try {
    return saveOutcomeFrom(await media.importIncomingMedia(token), null);
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : null;
    return saveOutcomeFrom(null, code);
  }
}

/** Opens the incoming file in another app; resolves with the rejection code, or null when the chooser opened. */
export async function openIncomingWithOtherApp(token: string): Promise<string | null> {
  if (!isIncomingMediaToken(token) || !isVidoraMediaAvailable()) {
    return 'ERR_NOT_FOUND';
  }
  try {
    await getVidoraMedia().openIncomingWith?.(token);
    return null;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return typeof code === 'string' ? code : 'ERR_UNKNOWN';
  }
}
