import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import type { GifRequest, GifResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import { nativeEditKinds } from './player-tools-port';

/**
 * P12 Create GIF (#676): the native GIF export (library/GifExport.kt via `startGifExport`, run as the editor's one
 * edit) and its Share. Null on builds without it: then Create GIF is hidden.
 */
export type GifPort = {
  startGifExport(request: GifRequest): Promise<GifResult>;
  shareGif(shareName: string): Promise<void>;
};

let gifOverride: GifPort | null | undefined;

export function getGifPort(): GifPort | null {
  if (gifOverride !== undefined) {
    return gifOverride;
  }
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<Record<keyof GifPort, unknown>>;
  return typeof media.startGifExport === 'function' && typeof media.shareGif === 'function'
    ? (media as unknown as GifPort)
    : null;
}

/** `undefined` restores the real module. */
export function setGifPortForTests(port: GifPort | null | undefined): void {
  gifOverride = port;
}

/** P12: what this build can do — Create GIF (`startGifExport`), Merge and Change speed (`getEditKinds`). */
export function exportExtrasInBuild(): { gif: boolean; merge: boolean; speed: boolean } {
  const kinds = nativeEditKinds();
  return { gif: getGifPort() != null, merge: kinds.includes('merge'), speed: kinds.includes('speed') };
}
