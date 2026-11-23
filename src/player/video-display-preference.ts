/**
 * P2: the Player's display choices and where they are kept.
 *
 * - Fit (#564 / #565 / #566): remembered per video, across launches (the last 500 videos with a non-default fit).
 * - Mirror / Flip (#573): for the video playing now only; another video starts unmirrored.
 * - Notch area (#576) and the info overlay (#721): one app-wide choice each, remembered.
 *
 * `use…` hooks are for screens; the `set…` functions save and update every screen at once.
 */

import { useMemo } from 'react';

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvGetObject, mmkvSetBoolean, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import {
  fitFor,
  isMirrorMode,
  normalizeVideoFit,
  readRememberedFits,
  rememberFit,
  type MirrorMode,
  type RememberedFits,
  type VideoFit,
} from './video-display';

type VideoDisplayState = {
  fits: RememberedFits;
  /** The mirror mode and the video it was chosen for. */
  mirror: { mediaId: string | null; mode: MirrorMode };
  fillCutout: boolean;
  infoOverlay: boolean;
};

function readFits(): RememberedFits {
  try {
    return readRememberedFits(mmkvGetObject<unknown>(mmkvKeys.playerVideoFits));
  } catch {
    // Damaged or unavailable storage must not stop the Player.
    return [];
  }
}

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    return mmkvGetBoolean(key) ?? fallback;
  } catch {
    return fallback;
  }
}

const useVideoDisplayStore = createStore<VideoDisplayState>()(() => ({
  fits: readFits(),
  mirror: { mediaId: null, mode: 'none' },
  // Default: the picture keeps clear of the camera cutout, so nothing of it is hidden.
  fillCutout: readBoolean(mmkvKeys.playerFillCutout, false),
  infoOverlay: readBoolean(mmkvKeys.playerInfoOverlay, false),
}));

export type VideoDisplay = {
  fit: VideoFit;
  mirror: MirrorMode;
  fillCutout: boolean;
  infoOverlay: boolean;
};

/** The display choices for this video (fit and mirror follow the video; the rest are app-wide). */
export function useVideoDisplay(mediaId: string | null | undefined): VideoDisplay {
  const fits = useVideoDisplayStore((state) => state.fits);
  const mirrorMediaId = useVideoDisplayStore((state) => state.mirror.mediaId);
  const mirrorMode = useVideoDisplayStore((state) => state.mirror.mode);
  const fillCutout = useVideoDisplayStore((state) => state.fillCutout);
  const infoOverlay = useVideoDisplayStore((state) => state.infoOverlay);
  return useMemo(
    () => ({
      fit: fitFor(fits, mediaId),
      mirror: mediaId && mirrorMediaId === mediaId ? mirrorMode : 'none',
      fillCutout,
      infoOverlay,
    }),
    [fillCutout, fits, infoOverlay, mediaId, mirrorMediaId, mirrorMode],
  );
}

export function getVideoFit(mediaId: string | null | undefined): VideoFit {
  return fitFor(useVideoDisplayStore.getState().fits, mediaId);
}

export function setVideoFit(mediaId: string | null | undefined, fit: VideoFit): void {
  if (!mediaId) {
    return;
  }
  const fits = rememberFit(useVideoDisplayStore.getState().fits, mediaId, normalizeVideoFit(fit));
  try {
    mmkvSetObject(mmkvKeys.playerVideoFits, fits);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useVideoDisplayStore.setState({ fits });
}

export function setVideoMirror(mediaId: string | null | undefined, mode: MirrorMode): void {
  useVideoDisplayStore.setState({ mirror: { mediaId: mediaId ?? null, mode: isMirrorMode(mode) ? mode : 'none' } });
}

export function setFillCutout(on: boolean): void {
  try {
    mmkvSetBoolean(mmkvKeys.playerFillCutout, on);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useVideoDisplayStore.setState({ fillCutout: on });
}

export function setInfoOverlay(on: boolean): void {
  try {
    mmkvSetBoolean(mmkvKeys.playerInfoOverlay, on);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useVideoDisplayStore.setState({ infoOverlay: on });
}
