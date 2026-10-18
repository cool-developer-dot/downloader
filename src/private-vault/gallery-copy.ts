/**
 * "Also remove the Gallery copy" (H21): offered in Move to Private when the video has a Gallery copy, off by default.
 * Only after the move succeeded is the copy removed, by native `removeGalleryCopy` — which deletes nothing but the
 * copy VidoraX itself recorded making, in its own gallery folders, and uses Android's own delete dialog where Android
 * requires it. That dialog is a system screen VidoraX opened, so it runs inside `withExternalUi` (Private does not
 * lock while it is up). A failed or declined removal never undoes the move.
 */

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import type { TranslationKey } from '@/localization/types';

import { withExternalUi } from './external-ui';

export type GalleryRemovalOutcome = 'removed' | 'gone' | 'not_ours' | 'declined' | 'failed';

export type GalleryCopyPort = {
  removeGalleryCopy(uri: string): Promise<unknown>;
};

let override: GalleryCopyPort | null | undefined;

/** Null on builds without the native function: the option is then not offered. */
export function getGalleryCopyPort(): GalleryCopyPort | null {
  if (override !== undefined) {
    return override;
  }
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<GalleryCopyPort>;
  return typeof media.removeGalleryCopy === 'function' ? (media as GalleryCopyPort) : null;
}

/** `undefined` restores the real module. */
export function setGalleryCopyPortForTests(port: GalleryCopyPort | null | undefined): void {
  override = port;
}

const OUTCOMES: readonly GalleryRemovalOutcome[] = ['removed', 'gone', 'not_ours', 'declined', 'failed'];

export function normalizeRemovalOutcome(raw: unknown): GalleryRemovalOutcome {
  return OUTCOMES.includes(raw as GalleryRemovalOutcome) ? (raw as GalleryRemovalOutcome) : 'failed';
}

/** Pure: whether the option is shown — a Gallery copy to remove, and a build that can. */
export function canOfferGalleryRemoval(galleryUri: string | null | undefined, port: GalleryCopyPort | null): boolean {
  return Boolean(galleryUri) && port !== null;
}

/** Pure: what is said after the move. */
export function galleryRemovalMessageKey(outcome: GalleryRemovalOutcome): TranslationKey {
  switch (outcome) {
    case 'removed':
    case 'gone':
      return 'privateVault.galleryCopyRemoved';
    case 'declined':
      return 'privateVault.galleryCopyKept';
    default:
      return 'privateVault.galleryCopyNotRemoved';
  }
}

/** Removes the Gallery copy of a video that was just moved. Never throws. */
export async function removeGalleryCopyAfterMove(
  galleryUri: string,
  port: GalleryCopyPort | null = getGalleryCopyPort(),
): Promise<GalleryRemovalOutcome> {
  if (!port || !galleryUri) {
    return 'failed';
  }
  try {
    return normalizeRemovalOutcome(await withExternalUi(() => port.removeGalleryCopy(galleryUri)));
  } catch {
    return 'failed';
  }
}
