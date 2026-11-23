import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import { createStore } from '@/store/shared/create-store';

/**
 * P10 Screenshot (#675): the native frame export (library/ThumbnailExport.kt `saveFrame`, library/FrameExport.kt).
 * `frame` is expo-video's VideoThumbnail, passed by reference. Null on builds without it: then Screenshot is hidden.
 */
export type FramePort = {
  saveFrameToGallery(frame: object, title: string): Promise<string>;
  shareFrame(frame: object, title: string): Promise<void>;
};

let frameOverride: FramePort | null | undefined;
let kindsOverride: readonly string[] | undefined;

export function getFramePort(): FramePort | null {
  if (frameOverride !== undefined) {
    return frameOverride;
  }
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<Record<keyof FramePort, unknown>>;
  return typeof media.saveFrameToGallery === 'function' && typeof media.shareFrame === 'function'
    ? (media as unknown as FramePort)
    : null;
}

/** The edit kinds the native editor runs (`getEditKinds`); [] on builds without the list (no Compress there). */
export function nativeEditKinds(): readonly string[] {
  if (kindsOverride !== undefined) {
    return kindsOverride;
  }
  if (!isVidoraMediaAvailable()) {
    return [];
  }
  try {
    const media = getVidoraMedia();
    const kinds = typeof media.getEditKinds === 'function' ? media.getEditKinds() : [];
    return Array.isArray(kinds) ? kinds : [];
  } catch {
    return [];
  }
}

/** `undefined` restores the real module. */
export function setPlayerToolsPortForTests(frame: FramePort | null | undefined, kinds?: readonly string[]): void {
  frameOverride = frame;
  kindsOverride = kinds;
}

/**
 * The library item whose edit the Player started (memory only), so the Player keeps that video paused while it runs
 * and shows its progress; null when the running edit (if any) came from elsewhere (Download details, Live convert).
 */
export const usePlayerEditOrigin = createStore<{ sourceId: string | null }>()(() => ({ sourceId: null }));

export function setPlayerEditOrigin(sourceId: string | null): void {
  usePlayerEditOrigin.setState({ sourceId });
}

/** Clears the origin when it is still this item's (a newer edit's origin is kept). */
export function clearPlayerEditOrigin(sourceId: string): void {
  if (usePlayerEditOrigin.getState().sourceId === sourceId) {
    usePlayerEditOrigin.setState({ sourceId: null });
  }
}
